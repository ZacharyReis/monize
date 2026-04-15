# Cash Flow Trend — Payee+Amount Exclusion Fix

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix the cash flow projection double-counting by replacing category-based subtraction with payee+exact-amount exclusion, eliminating ~$133/day of phantom trend drip from loans, insurance, and car payments.

**Architecture:** Single-file backend change to `spending-trends.service.ts`. The historical spending query gets a CTE-based anti-join that excludes parent transactions matching scheduled payee+amount+currency triples. Category subtraction is narrowed to a fallback for unsplit, categorized, payee-less scheduled transactions only. `accountId` is parameterized to fix a pre-existing SQL injection risk.

**Tech Stack:** NestJS, TypeORM raw queries (PostgreSQL), TypeScript

**Spec:** `docs/superpowers/specs/2026-04-15-trend-payee-exclusion-fix.md`

---

### Task 1: Capture baseline API response

Before changing any code, record the current spending-trends output for comparison.

**Files:**
- None modified

- [ ] **Step 1: Start the backend (if not running)**

```bash
cd /home/zach/Gentoo_Dev/monize/backend && npm run start:dev &
```

Wait for "Nest application successfully started" in output.

- [ ] **Step 2: Capture baseline response**

```bash
curl -s 'http://localhost:3001/built-in-reports/spending-trends?lookbackMonths=3&accountId=all' \
  -H 'Authorization: Bearer <token>' | jq '.' > /tmp/trend-baseline-before.json
```

Note: Get a valid JWT from the running frontend session (browser dev tools → Network → any API call → copy Authorization header).

- [ ] **Step 3: Record key metrics**

```bash
cat /tmp/trend-baseline-before.json | jq '{totalDailyFill, totalMonthlyFill, trendCount: (.trends | length), topCategories: [.trends[:5] | .[] | {categoryName, dailyFill}]}'
```

Expected: `totalDailyFill` around $329, categories include Loan, Car Payment, Insurance.

---

### Task 2: Parameterize accountId (security fix)

Fix the SQL injection risk by replacing string interpolation with query parameters. This must happen first since every subsequent SQL change depends on the new parameter style.

**Files:**
- Modify: `backend/src/built-in-reports/spending-trends.service.ts`

- [ ] **Step 1: Replace the accountFilter string interpolation**

In `spending-trends.service.ts`, replace the `accountFilter` construction and its usage across all three queries. The current code at line 70-71:

```typescript
    const accountFilter =
      accountId !== "all" ? `AND t.account_id = '${accountId}'` : "";
```

Replace the method from the `// Build account filter` comment through the end of the method (before `private toMonthlyEquivalent`) with a version that uses parameterized queries. Change the full `getSpendingTrends` method body to:

```typescript
  async getSpendingTrends(
    userId: string,
    lookbackMonths: number,
    accountId: string,
  ): Promise<SpendingTrendsResponse> {
    // Resolve currency
    const prefs = await this.prefsRepo.findOne({ where: { userId } });
    const currencyCode = prefs?.defaultCurrency || "USD";

    // Determine completed calendar months in lookback window
    const now = new Date();
    const currentMonthStart = new Date(now.getFullYear(), now.getMonth(), 1);
    const windowStart = new Date(currentMonthStart);
    windowStart.setMonth(windowStart.getMonth() - lookbackMonths);
    const startDate = windowStart.toISOString().split("T")[0];
    const endDate = new Date(currentMonthStart.getTime() - 1)
      .toISOString()
      .split("T")[0]; // last day of prev month

    // Count completed months in window
    const monthsUsed = lookbackMonths;

    // Build parameterized account filter
    const accountCondition =
      accountId !== "all" ? "AND t.account_id = $4" : "";
    const scheduledAccountCondition =
      accountId !== "all" ? "AND st.account_id = $2" : "";

    // Base params for historical query: [userId, startDate, endDate, accountId?]
    const histParams: (string | number)[] = [userId, startDate, endDate];
    if (accountId !== "all") histParams.push(accountId);

    // Base params for scheduled queries: [userId, accountId?]
    const schedParams: (string | number)[] = [userId];
    if (accountId !== "all") schedParams.push(accountId);

    // Step 1+2: Historical monthly average per category
    // with NOT EXISTS anti-join excluding parent transactions that match
    // a scheduled expense by (payee_id, rounded abs amount).
    // The NOT EXISTS runs against t.payee_id and t.amount (parent level),
    // so the entire parent transaction (including all splits) is excluded.
    const historicalRows: CategorySpendRow[] =
      await this.transactionsRepo.query(
        `SELECT
          COALESCE(ts.category_id, t.category_id) as category_id,
          SUM(ABS(COALESCE(ts.amount, t.amount))) as total
        FROM transactions t
        LEFT JOIN transaction_splits ts ON ts.transaction_id = t.id
        LEFT JOIN accounts a ON a.id = t.account_id
        WHERE t.user_id = $1
          AND t.transaction_date >= $2
          AND t.transaction_date <= $3
          AND COALESCE(ts.amount, t.amount) < 0
          AND t.is_transfer = false
          AND (t.status IS NULL OR t.status != 'VOID')
          AND t.parent_transaction_id IS NULL
          AND a.account_type != 'INVESTMENT'
          AND a.is_closed = false
          AND (ts.transfer_account_id IS NULL OR ts.id IS NULL)
          ${accountCondition}
          AND NOT EXISTS (
            SELECT 1 FROM scheduled_transactions st
            LEFT JOIN accounts sa ON sa.id = st.account_id
            WHERE st.payee_id = t.payee_id
              AND ROUND(ABS(st.amount)::numeric, 2) = ROUND(ABS(t.amount)::numeric, 2)
              AND st.currency_code = t.currency_code
              AND st.user_id = t.user_id
              AND st.is_active = true
              AND st.is_transfer = false
              AND st.frequency != 'ONCE'
              AND st.amount < 0
              AND (st.occurrences_remaining IS NULL OR st.occurrences_remaining > 0)
              AND (st.end_date IS NULL OR st.end_date >= CURRENT_DATE)
              AND sa.account_type != 'INVESTMENT'
              AND sa.is_closed = false
          )
        GROUP BY COALESCE(ts.category_id, t.category_id)`,
        histParams,
      );

    // Build historical map: categoryId -> monthly average
    const historicalMap = new Map<string | null, number>();
    for (const row of historicalRows) {
      const catId = row.category_id;
      const monthlyAvg = parseFloat(row.total) / monthsUsed;
      historicalMap.set(catId, monthlyAvg);
    }

    // Step 3: Category fallback — scheduled monthly equivalent per category
    // NARROWED: only unsplit scheduled transactions with a real category and no payee
    const scheduledUnsplitRows: ScheduledRow[] =
      await this.transactionsRepo.query(
        `SELECT
          st.category_id,
          st.frequency,
          st.amount
        FROM scheduled_transactions st
        LEFT JOIN accounts a ON a.id = st.account_id
        WHERE st.user_id = $1
          AND st.is_active = true
          AND st.is_split = false
          AND st.is_transfer = false
          AND st.frequency != 'ONCE'
          AND st.payee_id IS NULL
          AND st.category_id IS NOT NULL
          AND st.amount < 0
          AND (st.occurrences_remaining IS NULL OR st.occurrences_remaining > 0)
          AND (st.end_date IS NULL OR st.end_date >= CURRENT_DATE)
          AND a.account_type != 'INVESTMENT'
          AND a.is_closed = false
          ${scheduledAccountCondition}`,
        schedParams,
      );

    // No split fallback — payee-less splits are not eligible (same mismatch problem)

    // Build scheduled map: categoryId -> monthly equivalent (absolute)
    const scheduledMap = new Map<string | null, number>();
    for (const row of scheduledUnsplitRows) {
      const catId = row.category_id;
      const amount = Math.abs(parseFloat(row.amount));
      const monthly = this.toMonthlyEquivalent(amount, row.frequency);
      scheduledMap.set(catId, (scheduledMap.get(catId) || 0) + monthly);
    }

    // Step 4: Compute trend fill per category
    const categoryNames = await this.getCategoryNames(userId);
    const trends: SpendingTrendItem[] = [];

    for (const [catId, monthlyAvg] of historicalMap) {
      const scheduledMonthly = scheduledMap.get(catId) || 0;
      const trendFill = Math.max(0, monthlyAvg - scheduledMonthly);

      if (trendFill > 0.01) {
        trends.push({
          categoryId: catId,
          categoryName: categoryNames.get(catId) || "Uncategorized",
          monthlyAverage: Math.round(monthlyAvg * 100) / 100,
          scheduledMonthly: Math.round(scheduledMonthly * 100) / 100,
          trendFill: Math.round(trendFill * 100) / 100,
          dailyFill: Math.round((trendFill / 30) * 100) / 100,
        });
      }
    }

    // Sort by trendFill descending
    trends.sort((a, b) => b.trendFill - a.trendFill);

    const totalMonthlyFill = trends.reduce((sum, t) => sum + t.trendFill, 0);
    const totalDailyFill = Math.round((totalMonthlyFill / 30) * 100) / 100;

    return {
      trends,
      totalMonthlyFill: Math.round(totalMonthlyFill * 100) / 100,
      totalDailyFill,
      lookbackMonths,
      monthsUsed,
      currencyCode,
    };
  }
```

- [ ] **Step 2: Verify the backend compiles**

```bash
cd /home/zach/Gentoo_Dev/monize/backend && npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 3: Commit**

```bash
cd /home/zach/Gentoo_Dev/monize
git add backend/src/built-in-reports/spending-trends.service.ts
git commit -m "fix(trends): payee+amount exclusion replaces category subtraction

Replace category-based scheduled deduction with payee+exact-amount
anti-join at parent transaction level. Narrows category fallback to
unsplit/categorized/payee-less only. Parameterizes accountId (security).

Fixes: phantom ~\$133/day drip from Loan, Car Payment, Insurance
categories whose scheduled transactions had split/null category
mismatches with flat historical bank imports."
```

---

### Task 3: Update unit tests

The existing tests mock `transactionsRepo.query` calls in a specific order. The new code uses two queries (down from three): the historical query (with inline `NOT EXISTS` for payee+amount exclusion) and the unsplit payee-less fallback query. The split scheduled query is removed entirely.

**Files:**
- Modify: `backend/src/built-in-reports/spending-trends.service.spec.ts`

- [ ] **Step 1: Update the test file**

The new query call order is:
1. Historical query (with `NOT EXISTS` payee+amount exclusion baked in) — returns `Array<{ category_id, total }>`
2. Unsplit scheduled fallback query (payee-less, unsplit, categorized, expenses only) — returns `Array<{ category_id, frequency, amount }>`

Replace the entire test file content with:

```typescript
import { Test, TestingModule } from "@nestjs/testing";
import { getRepositoryToken } from "@nestjs/typeorm";
import { SpendingTrendsService } from "./spending-trends.service";
import { ReportCurrencyService } from "./report-currency.service";
import { Transaction } from "../transactions/entities/transaction.entity";
import { Account } from "../accounts/entities/account.entity";
import { Category } from "../categories/entities/category.entity";
import { ScheduledTransaction } from "../scheduled-transactions/entities/scheduled-transaction.entity";
import { ScheduledTransactionSplit } from "../scheduled-transactions/entities/scheduled-transaction-split.entity";
import { UserPreference } from "../users/entities/user-preference.entity";

describe("SpendingTrendsService", () => {
  let service: SpendingTrendsService;
  let transactionsRepo: Record<string, jest.Mock>;
  let categoriesRepo: Record<string, jest.Mock>;

  const mockUserId = "user-1";

  beforeEach(async () => {
    transactionsRepo = { query: jest.fn().mockResolvedValue([]) };
    categoriesRepo = { find: jest.fn().mockResolvedValue([]) };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        SpendingTrendsService,
        {
          provide: getRepositoryToken(Transaction),
          useValue: transactionsRepo,
        },
        {
          provide: getRepositoryToken(Account),
          useValue: { find: jest.fn() },
        },
        {
          provide: getRepositoryToken(Category),
          useValue: categoriesRepo,
        },
        {
          provide: getRepositoryToken(ScheduledTransaction),
          useValue: { find: jest.fn() },
        },
        {
          provide: getRepositoryToken(ScheduledTransactionSplit),
          useValue: { find: jest.fn() },
        },
        {
          provide: getRepositoryToken(UserPreference),
          useValue: {
            findOne: jest
              .fn()
              .mockResolvedValue({ defaultCurrency: "USD" }),
          },
        },
        { provide: ReportCurrencyService, useValue: {} },
      ],
    }).compile();

    service = module.get(SpendingTrendsService);
  });

  // Query call order:
  // 1. Historical spending (with NOT EXISTS payee+amount exclusion baked in)
  // 2. Unsplit scheduled fallback (category subtraction for payee-less)

  it("returns empty trends when no historical spending", async () => {
    transactionsRepo.query
      .mockResolvedValueOnce([])   // historical (with exclusion)
      .mockResolvedValueOnce([]);  // fallback scheduled

    const result = await service.getSpendingTrends(mockUserId, 3, "all");
    expect(result.trends).toEqual([]);
    expect(result.totalMonthlyFill).toBe(0);
    expect(result.totalDailyFill).toBe(0);
    expect(result.monthsUsed).toBe(3);
    expect(result.currencyCode).toBe("USD");
  });

  it("returns full trend fill for discretionary categories (no scheduled match)", async () => {
    // Historical: Food category, $4500 total over 3 months
    // NOT EXISTS finds no matching scheduled, so Food stays in result
    // No fallback scheduled either
    transactionsRepo.query
      .mockResolvedValueOnce([{ category_id: "cat-food", total: "4500.00" }])
      .mockResolvedValueOnce([]);  // fallback: none

    categoriesRepo.find.mockResolvedValue([
      { id: "cat-food", userId: mockUserId, name: "Food" },
    ]);

    const result = await service.getSpendingTrends(mockUserId, 3, "all");
    expect(result.trends).toHaveLength(1);
    expect(result.trends[0].categoryName).toBe("Food");
    expect(result.trends[0].monthlyAverage).toBe(1500);
    expect(result.trends[0].scheduledMonthly).toBe(0);
    expect(result.trends[0].trendFill).toBe(1500);
    expect(result.trends[0].dailyFill).toBe(50);
  });

  it("excludes categories fully covered by payee+amount match", async () => {
    // NOT EXISTS in historical query already excluded Loan transactions
    // (matched by payee_id + amount against scheduled_transactions).
    // Only Food remains in historical result.
    transactionsRepo.query
      .mockResolvedValueOnce([{ category_id: "cat-food", total: "900.00" }])
      .mockResolvedValueOnce([]);

    categoriesRepo.find.mockResolvedValue([
      { id: "cat-food", userId: mockUserId, name: "Food" },
    ]);

    const result = await service.getSpendingTrends(mockUserId, 3, "all");
    expect(result.trends).toHaveLength(1);
    expect(result.trends[0].categoryName).toBe("Food");
    expect(result.trends[0].monthlyAverage).toBe(300);
  });

  it("applies category fallback for payee-less unsplit scheduled transactions", async () => {
    // Historical has $7500 in Loan over 3 months (not excluded because
    // the historical payee doesn't match any scheduled payee+amount)
    // Fallback: unsplit scheduled monthly $2443.65 in Loan category
    // trendFill = 2500 - 2443.65 = 56.35
    transactionsRepo.query
      .mockResolvedValueOnce([{ category_id: "cat-loan", total: "7500.00" }])
      .mockResolvedValueOnce([
        { category_id: "cat-loan", frequency: "MONTHLY", amount: "-2443.65" },
      ]);

    categoriesRepo.find.mockResolvedValue([
      { id: "cat-loan", userId: mockUserId, name: "Loan" },
    ]);

    const result = await service.getSpendingTrends(mockUserId, 3, "all");
    expect(result.trends).toHaveLength(1);
    expect(result.trends[0].categoryName).toBe("Loan");
    expect(result.trends[0].monthlyAverage).toBe(2500);
    expect(result.trends[0].scheduledMonthly).toBe(2443.65);
    expect(result.trends[0].trendFill).toBe(56.35);
  });

  it("returns zero trend fill when fallback scheduled covers historical", async () => {
    transactionsRepo.query
      .mockResolvedValueOnce([{ category_id: "cat-loan", total: "7200.00" }])
      .mockResolvedValueOnce([
        { category_id: "cat-loan", frequency: "MONTHLY", amount: "-2443.65" },
      ]);

    categoriesRepo.find.mockResolvedValue([
      { id: "cat-loan", userId: mockUserId, name: "Loan" },
    ]);

    const result = await service.getSpendingTrends(mockUserId, 3, "all");
    expect(result.trends).toHaveLength(0);
    expect(result.totalMonthlyFill).toBe(0);
  });

  it("handles weekly scheduled frequency conversion correctly", async () => {
    // Historical: $7000 over 3 months = $2333.33/mo
    // Fallback scheduled: weekly $400 = $400 * 52/12 = $1733.33/mo
    // trendFill = 2333.33 - 1733.33 = 600
    transactionsRepo.query
      .mockResolvedValueOnce([{ category_id: "cat-misc", total: "7000.00" }])
      .mockResolvedValueOnce([
        { category_id: "cat-misc", frequency: "WEEKLY", amount: "-400.00" },
      ]);

    categoriesRepo.find.mockResolvedValue([
      { id: "cat-misc", userId: mockUserId, name: "Misc" },
    ]);

    const result = await service.getSpendingTrends(mockUserId, 3, "all");
    expect(result.trends).toHaveLength(1);
    expect(result.trends[0].trendFill).toBeCloseTo(600, 0);
  });

  it("handles uncategorized transactions", async () => {
    transactionsRepo.query
      .mockResolvedValueOnce([{ category_id: null, total: "900.00" }])
      .mockResolvedValueOnce([]);

    categoriesRepo.find.mockResolvedValue([]);

    const result = await service.getSpendingTrends(mockUserId, 3, "all");
    expect(result.trends).toHaveLength(1);
    expect(result.trends[0].categoryName).toBe("Uncategorized");
    expect(result.trends[0].categoryId).toBeNull();
    expect(result.trends[0].monthlyAverage).toBe(300);
  });

  it("sorts trends by trendFill descending", async () => {
    transactionsRepo.query
      .mockResolvedValueOnce([
        { category_id: "cat-a", total: "300.00" },
        { category_id: "cat-b", total: "900.00" },
        { category_id: "cat-c", total: "600.00" },
      ])
      .mockResolvedValueOnce([]);

    categoriesRepo.find.mockResolvedValue([
      { id: "cat-a", userId: mockUserId, name: "A" },
      { id: "cat-b", userId: mockUserId, name: "B" },
      { id: "cat-c", userId: mockUserId, name: "C" },
    ]);

    const result = await service.getSpendingTrends(mockUserId, 3, "all");
    expect(result.trends[0].categoryName).toBe("B");
    expect(result.trends[1].categoryName).toBe("C");
    expect(result.trends[2].categoryName).toBe("A");
  });

  it("historical SQL includes NOT EXISTS with required predicates", async () => {
    transactionsRepo.query
      .mockResolvedValueOnce([])   // historical
      .mockResolvedValueOnce([]);  // fallback

    await service.getSpendingTrends(mockUserId, 3, "all");

    // First query is the historical query — verify it has the NOT EXISTS clause
    const historicalSql = transactionsRepo.query.mock.calls[0][0] as string;
    expect(historicalSql).toContain("NOT EXISTS");
    expect(historicalSql).toContain("st.payee_id = t.payee_id");
    expect(historicalSql).toContain("ROUND(ABS(st.amount)::numeric, 2) = ROUND(ABS(t.amount)::numeric, 2)");
    expect(historicalSql).toContain("st.currency_code = t.currency_code");
    expect(historicalSql).toContain("st.amount < 0");
    expect(historicalSql).toContain("st.is_active = true");
    expect(historicalSql).toContain("st.frequency != 'ONCE'");

    // Fallback query should narrow to payee-less, unsplit, categorized, expenses
    const fallbackSql = transactionsRepo.query.mock.calls[1][0] as string;
    expect(fallbackSql).toContain("st.payee_id IS NULL");
    expect(fallbackSql).toContain("st.is_split = false");
    expect(fallbackSql).toContain("st.category_id IS NOT NULL");
    expect(fallbackSql).toContain("st.amount < 0");

    // Should only be 2 queries total (no split scheduled query)
    expect(transactionsRepo.query).toHaveBeenCalledTimes(2);
  });

  it("historical SQL uses parameterized accountId when scoped", async () => {
    transactionsRepo.query
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([]);

    await service.getSpendingTrends(mockUserId, 3, "acct-123");

    const historicalSql = transactionsRepo.query.mock.calls[0][0] as string;
    const historicalParams = transactionsRepo.query.mock.calls[0][1] as string[];

    // accountId should be parameterized, not interpolated
    expect(historicalSql).toContain("t.account_id = $4");
    expect(historicalSql).not.toContain("'acct-123'");
    expect(historicalParams).toContain("acct-123");
  });
});
```

- [ ] **Step 2: Run the tests**

```bash
cd /home/zach/Gentoo_Dev/monize/backend && npx jest --testPathPattern='spending-trends.service.spec' --verbose
```

Expected: all 10 tests pass.

- [ ] **Step 3: Commit**

```bash
cd /home/zach/Gentoo_Dev/monize
git add backend/src/built-in-reports/spending-trends.service.spec.ts
git commit -m "test(trends): update tests for payee+amount exclusion

Adjust mock query order: historical (with NOT EXISTS) → fallback.
Add test for payee+amount-excluded categories.
Remove split scheduled query mocks (no longer used)."
```

---

### Task 4: Live verification

**Files:**
- None modified

- [ ] **Step 1: Capture post-fix API response**

```bash
curl -s 'http://localhost:3001/built-in-reports/spending-trends?lookbackMonths=3&accountId=all' \
  -H 'Authorization: Bearer <token>' | jq '.' > /tmp/trend-baseline-after.json
```

- [ ] **Step 2: Compare key metrics**

```bash
echo "=== BEFORE ===" && cat /tmp/trend-baseline-before.json | jq '{totalDailyFill, totalMonthlyFill, trendCount: (.trends | length), topCategories: [.trends[:5] | .[] | {categoryName, dailyFill}]}'
echo "=== AFTER ===" && cat /tmp/trend-baseline-after.json | jq '{totalDailyFill, totalMonthlyFill, trendCount: (.trends | length), topCategories: [.trends[:5] | .[] | {categoryName, dailyFill}]}'
```

Expected changes:
- `totalDailyFill` drops from ~$329 to ~$30-50
- Loan, Car Payment, Insurance categories absent from trends
- Groceries, Dining Out, Supplies, etc. remain

- [ ] **Step 3: Verify specific account scoping works**

```bash
# Get the TD Checking account ID first
curl -s 'http://localhost:3001/accounts' \
  -H 'Authorization: Bearer <token>' | jq '.[] | select(.name | test("TD Checking"; "i")) | .id'

# Then test with that account ID
curl -s 'http://localhost:3001/built-in-reports/spending-trends?lookbackMonths=3&accountId=<TD_CHECKING_UUID>' \
  -H 'Authorization: Bearer <token>' | jq '{totalDailyFill, trendCount: (.trends | length)}'
```

Expected: no SQL errors (confirms parameterized accountId works).

- [ ] **Step 4: Visual check in browser**

Open the Monize Bills page in the browser. Switch to "Projected" mode, 90D view, TD Checking.

Expected:
- The projection line should NOT plunge to -$19K
- Tooltip should show discretionary categories only (Groceries, Dining Out, etc.)
- Loan, Car Payment, Insurance should NOT appear in projected (amber) items
- AllState Insurance should still appear as a scheduled (white/gray) item on its due date

- [ ] **Step 5: Test Scheduled mode is unaffected**

Switch to "Scheduled" mode. Verify it looks identical to before — scheduled transactions only, no trend items.

---

## Codex Plan Review

**Session:** `019d8f69-b466-7b21-b899-9b593c6a0e0e`
**Findings:** 1 HIGH, 2 MEDIUM, 2 LOW — all incorporated above.

| # | Severity | Finding | Resolution |
|---|----------|---------|------------|
| 1 | HIGH | NOT EXISTS missing currency_code predicate | Added `AND st.currency_code = t.currency_code` |
| 2 | MEDIUM | NOT EXISTS not account-scoped when accountId != 'all' | Acceptable: same payee+amount+currency across accounts is the same bill. Cross-account exclusion is correct behavior. |
| 3 | MEDIUM | Unit tests don't assert SQL predicates | Added SQL assertion tests for NOT EXISTS predicates and parameterized accountId |
| 4 | LOW | Task 3 prose mentioned 3-call order, actual code uses 2 calls | Fixed prose to match implementation |
| 5 | LOW | Fallback query missing `st.amount < 0` | Added expense-only filter to fallback query |
