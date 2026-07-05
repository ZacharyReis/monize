# Cash-flow Projection One-Time Exclusion — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stop the cash-flow forecast from projecting one-time charges (e.g. debt-settlement payoffs) forward as recurring, via an authoritative per-transaction tri-state flag plus a payee-recurrence default heuristic.

**Architecture:** A nullable `exclude_from_projection` column on `transactions` (NULL=defer to heuristic, TRUE=one-time, FALSE=force-recurring) is honored by `SpendingTrendsService` before any statistical gate. The default heuristic gains a payee-recurrence gate (a payee appearing in only one calendar month across a ≥6-month window, ≥$100, is suggested one-time), which fixes the diagnosed "all null-category rows pool into one bucket" defect. The flag is set from a tri-state control on `TransactionForm` and from a new confirm/override list in the cash-flow view that surfaces the previously-invisible `excludedOutliers`.

**Tech Stack:** NestJS + TypeORM + PostgreSQL (backend, jest); Next.js + React Hook Form + zod + Tailwind (frontend, jest + testing-library); raw-SQL sequential migrations under `database/migrations/`.

## Global Constraints

- Migration is raw SQL, next sequential number **`093`**, in `database/migrations/`.
- Signal is a **nullable tri-state**: `NULL` = defer to heuristic, `TRUE` = one-time (exclude), `FALSE` = force recurring (skip all heuristics).
- Flag lives on the **parent** transaction (`transactions.exclude_from_projection`); the forecast override targets `t.id` (parent), never a split id.
- Constants: `ONE_TIME_EXPENSE_MIN_AMOUNT = 100` (existing), new `PAYEE_RECURRENCE_MIN_MONTHS = 6`.
- Reason strings (plain strings, no enum): `marked_one_time` (flag TRUE), `single_payee_occurrence` (payee gate), plus existing `single_historical_occurrence`, `amount_outlier`.
- Write path reuses `PATCH /transactions/:id` — **no new endpoint**. The service must only write the column when the DTO key is present (`"excludeFromProjection" in updateData`), so `NULL` is distinguishable from "field absent".
- i18n: new English keys go in `en/transactions.json` (namespace `transactions`) and `en/bills.json` (namespace `bills`); run `npm run i18n:pseudo` after adding keys. **Locale parity across the other 20 locales is deferred to T-568** (matches the T-555 precedent) — `npm run i18n:check` / the parity test will flag the new keys until then; this is accepted.
- Deploy is bare-metal via `./scripts/rebuild.sh` (migrate + build + restart). Migration `093` is `ALTER TABLE ... ADD COLUMN`, so it does not create a new table and the T-555 table-ownership issue does not recur.
- This changes live money-forecast math: after implementation, the branch goes through **Wren adversarial review → plan-review gate → live verification** before deploy.

**Branch:** `t-550-one-time-projection-exclusion` (already created; spec at `docs/superpowers/specs/2026-07-05-cash-flow-projection-one-time-exclusion-design.md`).

**Test commands:**
- Backend unit: `cd backend && npx jest src/built-in-reports/spending-trends.service.spec.ts`
- Backend DTO: `cd backend && npx jest src/transactions/dto`
- Frontend unit: `cd frontend && npm test -- <path>`

---

## File Structure

**Backend:**
- Create `database/migrations/093_transaction_exclude_from_projection.sql` — schema.
- Modify `backend/src/transactions/entities/transaction.entity.ts` — entity column.
- Modify `backend/src/built-in-reports/spending-trends.service.ts` — query SELECT, interfaces, parse, tri-state precedence, payee-recurrence gate.
- Modify `backend/src/built-in-reports/dto/spending-trends.dto.ts` — `transactionId` on `SpendingTrendOutlier`.
- Modify `backend/src/built-in-reports/spending-trends.service.spec.ts` — helper + new tests.
- Modify `backend/src/transactions/dto/create-transaction.dto.ts` — DTO field (inherited by Update via `PartialType`).
- Modify `backend/src/transactions/transactions.service.ts` — whitelist block in `update()`.
- Create `backend/src/transactions/dto/update-transaction.dto.spec.ts` — DTO validation test.

**Frontend:**
- Create `frontend/src/lib/projection-intent.ts` — pure string↔`boolean|null` mapping.
- Create `frontend/src/lib/projection-intent.test.ts` — its test.
- Modify `frontend/src/types/transaction.ts` — `excludeFromProjection` on `Transaction` + create/update payload types.
- Modify `frontend/src/components/transactions/TransactionForm.tsx` — schema, init, tri-state control.
- Modify `frontend/src/types/built-in-reports.ts` — `transactionId` on `SpendingTrendOutlier`.
- Create `frontend/src/components/bills/OneTimeExclusionsList.tsx` — the confirm/override list.
- Create `frontend/src/components/bills/OneTimeExclusionsList.test.tsx` — its test.
- Modify `frontend/src/app/bills/page.tsx` — thread `excludedOutliers` + render the list.
- Modify `frontend/src/i18n/messages/en/transactions.json` and `frontend/src/i18n/messages/en/bills.json` — keys.

---

## Task 1: Schema — migration 093 + entity column

**Files:**
- Create: `database/migrations/093_transaction_exclude_from_projection.sql`
- Modify: `backend/src/transactions/entities/transaction.entity.ts` (near the `is_transfer` column, ~line 171)

**Interfaces:**
- Produces: `transactions.exclude_from_projection BOOLEAN NULL`; entity field `excludeFromProjection: boolean | null`.

- [ ] **Step 1: Write the migration**

Create `database/migrations/093_transaction_exclude_from_projection.sql`:

```sql
-- 093_transaction_exclude_from_projection.sql
-- Cash-flow projection recurrence intent (t-550). Tri-state:
--   NULL  = defer to the statistical heuristic (default / today's behavior)
--   TRUE  = user marked one-time; never project forward
--   FALSE = user marked recurring; always project (override an aggressive guess)
ALTER TABLE transactions
    ADD COLUMN IF NOT EXISTS exclude_from_projection BOOLEAN NULL;
```

- [ ] **Step 2: Add the entity column**

In `transaction.entity.ts`, immediately after the `isTransfer` column block (~line 172), add:

```ts
  @Column({
    name: "exclude_from_projection",
    type: "boolean",
    nullable: true,
  })
  excludeFromProjection: boolean | null;
```

- [ ] **Step 3: Apply the migration to the dev DB and build**

Run: `cd backend && psql "$DATABASE_URL" -f ../database/migrations/093_transaction_exclude_from_projection.sql && npm run build`
Expected: migration applies (`ALTER TABLE`), build succeeds with no TypeScript errors.

(If `DATABASE_URL` is not set in the shell, the deploy path `./scripts/rebuild.sh` applies migrations; for local test the column must exist in the dev DB.)

- [ ] **Step 4: Commit**

```bash
git add database/migrations/093_transaction_exclude_from_projection.sql backend/src/transactions/entities/transaction.entity.ts
git commit -m "feat(t-550): add transactions.exclude_from_projection tri-state column"
```

---

## Task 2: Query selects the flag + parent transaction id; outliers carry transactionId

**Files:**
- Modify: `backend/src/built-in-reports/spending-trends.service.ts`
- Modify: `backend/src/built-in-reports/dto/spending-trends.dto.ts`
- Modify: `backend/src/built-in-reports/spending-trends.service.spec.ts`

**Interfaces:**
- Consumes: entity column from Task 1.
- Produces: `HistoricalSpendRow` gains `exclude_from_projection: boolean | null` and `transaction_id: string`; `ParsedHistoricalSpend` gains `excludeFromProjection: boolean | null` and `transactionId: string`; `SpendingTrendOutlier` gains `transactionId: string`.

- [ ] **Step 1: Update the test helper and write failing tests**

In `spending-trends.service.spec.ts`, replace the `hist` helper (lines ~20-31) with:

```ts
  const hist = (
    categoryId: string | null,
    amount: number,
    date = "2026-03-20",
    payeeName: string | null = "Payee",
    excludeFromProjection: boolean | null = null,
  ) => {
    const seq = rowSeq++;
    return {
      row_id: `row-${seq}`,
      transaction_id: `txn-${seq}`,
      transaction_date: date,
      category_id: categoryId,
      amount: amount.toFixed(2),
      payee_name: payeeName,
      exclude_from_projection: excludeFromProjection,
    };
  };
```

Add these tests at the end of the `describe` block:

```ts
  it("historical SQL selects the flag and parent transaction id", async () => {
    transactionsRepo.query.mockResolvedValueOnce([]).mockResolvedValueOnce([]);
    await service.getSpendingTrends(mockUserId, 3, "all");
    const sql = transactionsRepo.query.mock.calls[0][0] as string;
    expect(sql).toContain("t.exclude_from_projection");
    expect(sql).toContain("as transaction_id");
  });

  it("outliers carry the parent transactionId", async () => {
    transactionsRepo.query
      .mockResolvedValueOnce([hist("cat-travel", 1200, "2026-03-10", "Hotel")])
      .mockResolvedValueOnce([]);
    categoriesRepo.find.mockResolvedValue([
      { id: "cat-travel", userId: mockUserId, name: "Travel" },
    ]);
    const result = await service.getSpendingTrends(mockUserId, 3, "all");
    expect(result.excludedOutliers[0].transactionId).toMatch(/^txn-/);
  });
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd backend && npx jest src/built-in-reports/spending-trends.service.spec.ts -t "transaction id"`
Expected: FAIL — SQL lacks the new columns; `transactionId` is undefined on the outlier.

- [ ] **Step 3: Implement — SELECT, interfaces, parse, DTO**

In `spending-trends.service.ts`, in the historical query SELECT (lines ~120-125), add two selected columns after the `amount` line:

```ts
          ABS(COALESCE(ts.amount, t.amount)) as amount,
          COALESCE(p.name, t.payee_name, t.description) as payee_name,
          t.id::text as transaction_id,
          t.exclude_from_projection as exclude_from_projection
```

Extend `HistoricalSpendRow` (lines ~18-24):

```ts
interface HistoricalSpendRow {
  row_id: string;
  transaction_date: string | Date;
  category_id: string | null;
  amount: string;
  payee_name: string | null;
  transaction_id: string;
  exclude_from_projection: boolean | null;
}
```

Extend `ParsedHistoricalSpend` (lines ~32-38):

```ts
interface ParsedHistoricalSpend {
  id: string;
  date: string;
  categoryId: string | null;
  amount: number;
  payeeName: string | null;
  transactionId: string;
  excludeFromProjection: boolean | null;
}
```

Update `parseHistoricalRows` (lines ~270-282) to map the new fields:

```ts
      .map((row) => ({
        id: row.row_id,
        date: this.formatDateKey(this.toLocalDate(row.transaction_date)),
        categoryId: row.category_id,
        amount: Math.abs(parseFloat(row.amount)),
        payeeName: row.payee_name,
        transactionId: row.transaction_id,
        excludeFromProjection: row.exclude_from_projection ?? null,
      }))
```

In `filterHistoricalRows`, where the outlier is pushed (lines ~309-316), add `transactionId`:

```ts
          excludedOutliers.push({
            date: row.date,
            categoryId,
            categoryName: categoryNames.get(categoryId) || "Uncategorized",
            amount: this.roundMoney(row.amount),
            payeeName: row.payeeName,
            reason,
            transactionId: row.transactionId,
          });
```

In `dto/spending-trends.dto.ts`, add to `SpendingTrendOutlier`:

```ts
  @ApiProperty() transactionId: string;
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd backend && npx jest src/built-in-reports/spending-trends.service.spec.ts`
Expected: PASS — all existing tests still green (missing flag parses to `null`), new tests pass.

- [ ] **Step 5: Commit**

```bash
git add backend/src/built-in-reports/spending-trends.service.ts backend/src/built-in-reports/dto/spending-trends.dto.ts backend/src/built-in-reports/spending-trends.service.spec.ts
git commit -m "feat(t-550): select exclude_from_projection + parent txn id into trends; outliers carry transactionId"
```

---

## Task 3: Tri-state flag precedence in filtering

**Files:**
- Modify: `backend/src/built-in-reports/spending-trends.service.ts`
- Modify: `backend/src/built-in-reports/spending-trends.service.spec.ts`

**Interfaces:**
- Consumes: `ParsedHistoricalSpend.excludeFromProjection` from Task 2.
- Produces: flag `true` → `marked_one_time`; `false` → force-included; `null` → heuristics run.

- [ ] **Step 1: Write failing tests**

Add to `spending-trends.service.spec.ts`:

```ts
  it("excludes a transaction flagged one-time (exclude_from_projection = true)", async () => {
    transactionsRepo.query
      .mockResolvedValueOnce([
        hist("cat-food", 1500, "2026-01-20", "Store", null),
        hist("cat-food", 1500, "2026-02-20", "Store", null),
        hist("cat-food", 5000, "2026-03-20", "Settlement", true),
      ])
      .mockResolvedValueOnce([]);
    categoriesRepo.find.mockResolvedValue([
      { id: "cat-food", userId: mockUserId, name: "Food" },
    ]);
    const result = await service.getSpendingTrends(mockUserId, 3, "all");
    const flagged = result.excludedOutliers.find(
      (o) => o.reason === "marked_one_time",
    );
    expect(flagged?.amount).toBe(5000);
    expect(result.trends[0].monthlyAverage).toBe(1000); // (1500+1500)/3
  });

  it("force-includes a recurring-flagged charge the heuristic would drop (false)", async () => {
    transactionsRepo.query
      .mockResolvedValueOnce([
        hist("cat-x", 200, "2026-01-20", "A", null),
        hist("cat-x", 200, "2026-02-20", "A", null),
        hist("cat-x", 200, "2026-03-05", "A", null),
        hist("cat-x", 5000, "2026-03-20", "BigButRecurring", false),
      ])
      .mockResolvedValueOnce([]);
    categoriesRepo.find.mockResolvedValue([
      { id: "cat-x", userId: mockUserId, name: "X" },
    ]);
    const result = await service.getSpendingTrends(mockUserId, 3, "all");
    expect(result.excludedOutliers).toHaveLength(0);
    expect(result.trends[0].monthlyAverage).toBeCloseTo((600 + 5000) / 3, 2);
  });

  it("defers to the heuristic when the flag is null", async () => {
    transactionsRepo.query
      .mockResolvedValueOnce([hist("cat-travel", 1200, "2026-03-10", "Hotel", null)])
      .mockResolvedValueOnce([]);
    categoriesRepo.find.mockResolvedValue([
      { id: "cat-travel", userId: mockUserId, name: "Travel" },
    ]);
    const result = await service.getSpendingTrends(mockUserId, 3, "all");
    expect(result.excludedOutliers[0].reason).toBe("single_historical_occurrence");
  });
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd backend && npx jest src/built-in-reports/spending-trends.service.spec.ts -t "flagged"`
Expected: FAIL — the flag is ignored; the $5000 flagged row is averaged in / excluded by the heuristic regardless of the flag.

- [ ] **Step 3: Implement the precedence**

In `filterHistoricalRows`, replace the per-row loop body (lines ~305-320) so the flag is resolved before the heuristic:

```ts
    for (const [categoryId, categoryRows] of grouped) {
      const included: ParsedHistoricalSpend[] = [];
      for (const row of categoryRows) {
        let reason: string | null;
        if (row.excludeFromProjection === true) {
          reason = "marked_one_time";
        } else if (row.excludeFromProjection === false) {
          reason = null; // force include: skip all heuristics
        } else {
          reason = this.getOutlierReason(row, categoryRows);
        }
        if (reason) {
          excludedOutliers.push({
            date: row.date,
            categoryId,
            categoryName: categoryNames.get(categoryId) || "Uncategorized",
            amount: this.roundMoney(row.amount),
            payeeName: row.payeeName,
            reason,
            transactionId: row.transactionId,
          });
        } else {
          included.push(row);
        }
      }

      if (included.length > 0) {
        includedRowsByCategory.set(categoryId, included);
      }
    }
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd backend && npx jest src/built-in-reports/spending-trends.service.spec.ts`
Expected: PASS — all tests green.

- [ ] **Step 5: Commit**

```bash
git add backend/src/built-in-reports/spending-trends.service.ts backend/src/built-in-reports/spending-trends.service.spec.ts
git commit -m "feat(t-550): honor exclude_from_projection tri-state before the heuristic"
```

---

## Task 4: B2 payee-recurrence heuristic

**Files:**
- Modify: `backend/src/built-in-reports/spending-trends.service.ts`
- Modify: `backend/src/built-in-reports/spending-trends.service.spec.ts`

**Interfaces:**
- Consumes: `ParsedHistoricalSpend.payeeName`, `monthsUsed`.
- Produces: `single_payee_occurrence` reason; `filterHistoricalRows` gains a `monthsUsed` parameter; `getOutlierReason` gains `oneTimePayeeKeys: Set<string>` and `monthsUsed: number` parameters.

- [ ] **Step 1: Write failing tests**

Add to `spending-trends.service.spec.ts`:

```ts
  it("suggests a payee seen in only one month as one-time (single_payee_occurrence)", async () => {
    // Uncategorized bucket: recurring Rent (3 months) + a one-time payoff (1 month).
    // Proves the Uncategorized-pooling fix: the payoff is caught, Rent is kept.
    transactionsRepo.query
      .mockResolvedValueOnce([
        hist(null, 1500, "2026-01-15", "Rent"),
        hist(null, 1500, "2026-02-15", "Rent"),
        hist(null, 1500, "2026-03-15", "Rent"),
        hist(null, 4200, "2026-03-20", "DebtSettlementCo"),
      ])
      .mockResolvedValueOnce([]);
    categoriesRepo.find.mockResolvedValue([]);
    const result = await service.getSpendingTrends(mockUserId, 6, "all");
    const payoff = result.excludedOutliers.find(
      (o) => o.payeeName === "DebtSettlementCo",
    );
    expect(payoff?.reason).toBe("single_payee_occurrence");
    expect(result.trends[0].monthlyAverage).toBe(750); // (1500*3)/6, payoff excluded
  });

  it("keeps a payee seen across multiple months (not one-time)", async () => {
    transactionsRepo.query
      .mockResolvedValueOnce([
        hist(null, 900, "2026-01-15", "Insurance"),
        hist(null, 900, "2026-02-15", "Insurance"),
      ])
      .mockResolvedValueOnce([]);
    categoriesRepo.find.mockResolvedValue([]);
    const result = await service.getSpendingTrends(mockUserId, 6, "all");
    expect(result.excludedOutliers).toHaveLength(0);
  });

  it("disables the payee gate for short windows (< 6 months)", async () => {
    transactionsRepo.query
      .mockResolvedValueOnce([
        hist(null, 300, "2026-02-15", "A"),
        hist(null, 300, "2026-03-10", "B"),
      ])
      .mockResolvedValueOnce([]);
    categoriesRepo.find.mockResolvedValue([]);
    const result = await service.getSpendingTrends(mockUserId, 3, "all");
    expect(
      result.excludedOutliers.find((o) => o.reason === "single_payee_occurrence"),
    ).toBeUndefined();
  });

  it("preserves amount_outlier for a recurring category with one abnormal charge", async () => {
    transactionsRepo.query
      .mockResolvedValueOnce([
        hist("cat-grocery", 200, "2026-01-10", "Market"),
        hist("cat-grocery", 210, "2026-02-10", "Market"),
        hist("cat-grocery", 190, "2026-03-05", "Market"),
        hist("cat-grocery", 205, "2026-03-12", "Market"),
        hist("cat-grocery", 1500, "2026-03-20", "Market"),
      ])
      .mockResolvedValueOnce([]);
    categoriesRepo.find.mockResolvedValue([
      { id: "cat-grocery", userId: mockUserId, name: "Grocery" },
    ]);
    const result = await service.getSpendingTrends(mockUserId, 6, "all");
    expect(
      result.excludedOutliers.find((o) => o.reason === "amount_outlier")?.amount,
    ).toBe(1500);
  });

  it("falls back to existing gates for rows with no payee", async () => {
    transactionsRepo.query
      .mockResolvedValueOnce([hist("cat-x", 1200, "2026-03-10", null)])
      .mockResolvedValueOnce([]);
    categoriesRepo.find.mockResolvedValue([
      { id: "cat-x", userId: mockUserId, name: "X" },
    ]);
    const result = await service.getSpendingTrends(mockUserId, 6, "all");
    expect(result.excludedOutliers[0].reason).toBe("single_historical_occurrence");
  });
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd backend && npx jest src/built-in-reports/spending-trends.service.spec.ts -t "single_payee_occurrence"`
Expected: FAIL — `DebtSettlementCo` is projected (folded into the Uncategorized average) instead of excluded.

- [ ] **Step 3: Implement the payee-recurrence gate**

Add the constant near the other consts (line ~52):

```ts
const PAYEE_RECURRENCE_MIN_MONTHS = 6;
```

Update the call site in `getSpendingTrends` (line ~201-202) to pass `monthsUsed`:

```ts
    const { includedRowsByCategory, excludedOutliers } =
      this.filterHistoricalRows(parsedHistoricalRows, categoryNames, monthsUsed);
```

Change `filterHistoricalRows` signature and precompute one-time payees (lines ~284-291). Add the `monthsUsed` param and the precompute before the grouping loop:

```ts
  private filterHistoricalRows(
    rows: ParsedHistoricalSpend[],
    categoryNames: Map<string | null, string>,
    monthsUsed: number,
  ): {
    includedRowsByCategory: Map<string | null, ParsedHistoricalSpend[]>;
    excludedOutliers: SpendingTrendOutlier[];
  } {
    // Payee-recurrence signal (global, across all categories): a payee that
    // appears in exactly one calendar month is a one-time candidate.
    const payeeMonths = new Map<string, Set<string>>();
    for (const row of rows) {
      if (!row.payeeName) continue;
      const key = row.payeeName.trim().toLocaleLowerCase();
      const months = payeeMonths.get(key) ?? new Set<string>();
      months.add(row.date.slice(0, 7));
      payeeMonths.set(key, months);
    }
    const oneTimePayeeKeys = new Set(
      [...payeeMonths]
        .filter(([, months]) => months.size === 1)
        .map(([key]) => key),
    );

    const grouped = new Map<string | null, ParsedHistoricalSpend[]>();
    for (const row of rows) {
      const existing = grouped.get(row.categoryId) || [];
      existing.push(row);
      grouped.set(row.categoryId, existing);
    }
```

In the per-row loop (from Task 3), change the heuristic call to pass the new context:

```ts
        } else {
          reason = this.getOutlierReason(
            row,
            categoryRows,
            oneTimePayeeKeys,
            monthsUsed,
          );
        }
```

Change `getOutlierReason` signature and insert the payee gate after the single-occurrence check (lines ~331-337):

```ts
  private getOutlierReason(
    row: ParsedHistoricalSpend,
    rows: ParsedHistoricalSpend[],
    oneTimePayeeKeys: Set<string>,
    monthsUsed: number,
  ): string | null {
    if (rows.length === 1 && row.amount >= ONE_TIME_EXPENSE_MIN_AMOUNT) {
      return "single_historical_occurrence";
    }

    // Payee-recurrence gate (independent of bucket size): a payee seen in only
    // one month across a sufficiently long window is a one-time candidate.
    if (
      monthsUsed >= PAYEE_RECURRENCE_MIN_MONTHS &&
      row.payeeName &&
      row.amount >= ONE_TIME_EXPENSE_MIN_AMOUNT &&
      oneTimePayeeKeys.has(row.payeeName.trim().toLocaleLowerCase())
    ) {
      return "single_payee_occurrence";
    }

    if (rows.length < 2) return null;
```

(The rest of `getOutlierReason` — the `amount_outlier` logic — is unchanged.)

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd backend && npx jest src/built-in-reports/spending-trends.service.spec.ts`
Expected: PASS — all tests green (existing outlier/uncategorized tests use `monthsUsed = 3 < 6`, so the payee gate stays inert for them).

- [ ] **Step 5: Commit**

```bash
git add backend/src/built-in-reports/spending-trends.service.ts backend/src/built-in-reports/spending-trends.service.spec.ts
git commit -m "feat(t-550): payee-recurrence default heuristic (single_payee_occurrence)"
```

---

## Task 5: Write path — DTO field + service whitelist block

**Files:**
- Modify: `backend/src/transactions/dto/create-transaction.dto.ts`
- Modify: `backend/src/transactions/transactions.service.ts` (in `update()`, ~line 2008)
- Create: `backend/src/transactions/dto/update-transaction.dto.spec.ts`

**Interfaces:**
- Consumes: entity column from Task 1.
- Produces: `CreateTransactionDto.excludeFromProjection?: boolean | null` (inherited by `UpdateTransactionDto` via `PartialType`); `update()` writes the column only when the key is present.

- [ ] **Step 1: Write the failing DTO test**

Create `backend/src/transactions/dto/update-transaction.dto.spec.ts`:

```ts
import { plainToInstance } from "class-transformer";
import { validate } from "class-validator";
import { UpdateTransactionDto } from "./update-transaction.dto";

describe("UpdateTransactionDto excludeFromProjection", () => {
  const run = async (value: unknown) => {
    const dto = plainToInstance(UpdateTransactionDto, {
      excludeFromProjection: value,
    });
    return validate(dto);
  };

  it("accepts true, false, and null", async () => {
    expect(await run(true)).toHaveLength(0);
    expect(await run(false)).toHaveLength(0);
    expect(await run(null)).toHaveLength(0);
  });

  it("rejects a non-boolean value", async () => {
    const errors = await run("nope");
    expect(errors.length).toBeGreaterThan(0);
    expect(errors[0].property).toBe("excludeFromProjection");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && npx jest src/transactions/dto/update-transaction.dto.spec.ts`
Expected: FAIL — the property does not exist yet, so the invalid-value case is not rejected.

- [ ] **Step 3: Add the DTO field**

In `create-transaction.dto.ts`, ensure `IsBoolean` is imported from `class-validator` (add it to the existing import if missing). Add this field after the `status` field (~line 96):

```ts
  @ApiPropertyOptional({
    description:
      "Cash-flow projection recurrence intent. null = defer to heuristic, " +
      "true = one-time (never project), false = recurring (always project).",
    nullable: true,
  })
  @IsOptional()
  @IsBoolean()
  excludeFromProjection?: boolean | null;
```

- [ ] **Step 4: Add the service whitelist block**

In `transactions.service.ts`, in the `update()` method, immediately after the `status` block (lines ~2008-2009), add:

```ts
      if ("excludeFromProjection" in updateData)
        transactionUpdateData.excludeFromProjection =
          updateData.excludeFromProjection ?? null;
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `cd backend && npx jest src/transactions/dto/update-transaction.dto.spec.ts && cd backend && npm run build`
Expected: PASS; build succeeds. (`false ?? null` evaluates to `false`, so the force-recurring state is preserved; the `"in"` guard leaves the column untouched when the key is absent.)

- [ ] **Step 6: Commit**

```bash
git add backend/src/transactions/dto/create-transaction.dto.ts backend/src/transactions/transactions.service.ts backend/src/transactions/dto/update-transaction.dto.spec.ts
git commit -m "feat(t-550): accept excludeFromProjection on create/update transaction"
```

---

## Task 6: Frontend — TransactionForm tri-state control

**Files:**
- Create: `frontend/src/lib/projection-intent.ts`
- Create: `frontend/src/lib/projection-intent.test.ts`
- Modify: `frontend/src/types/transaction.ts`
- Modify: `frontend/src/components/transactions/TransactionForm.tsx`
- Modify: `frontend/src/i18n/messages/en/transactions.json`

**Interfaces:**
- Consumes: `PATCH /transactions/:id` accepting `excludeFromProjection` (Task 5).
- Produces: `projectionToSelect(boolean|null) => 'auto'|'one_time'|'recurring'` and `selectToProjection(string) => boolean|null`; `Transaction.excludeFromProjection`.

- [ ] **Step 1: Write the failing helper test**

Create `frontend/src/lib/projection-intent.test.ts`:

```ts
import { projectionToSelect, selectToProjection } from './projection-intent';

describe('projection-intent mapping', () => {
  it('maps flag -> select value', () => {
    expect(projectionToSelect(true)).toBe('one_time');
    expect(projectionToSelect(false)).toBe('recurring');
    expect(projectionToSelect(null)).toBe('auto');
    expect(projectionToSelect(undefined)).toBe('auto');
  });

  it('maps select value -> flag', () => {
    expect(selectToProjection('one_time')).toBe(true);
    expect(selectToProjection('recurring')).toBe(false);
    expect(selectToProjection('auto')).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd frontend && npm test -- projection-intent`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the helper**

Create `frontend/src/lib/projection-intent.ts`:

```ts
export type ProjectionSelectValue = 'auto' | 'one_time' | 'recurring';

export function projectionToSelect(
  value: boolean | null | undefined,
): ProjectionSelectValue {
  if (value === true) return 'one_time';
  if (value === false) return 'recurring';
  return 'auto';
}

export function selectToProjection(value: string): boolean | null {
  if (value === 'one_time') return true;
  if (value === 'recurring') return false;
  return null;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd frontend && npm test -- projection-intent`
Expected: PASS.

- [ ] **Step 5: Wire the control into TransactionForm**

In `frontend/src/types/transaction.ts`, add to the `Transaction` interface (after `isTransfer`, ~line 76) and to the create/update payload interfaces that carry editable fields (mirror where `status?` appears, ~lines 108/147/176):

```ts
  excludeFromProjection: boolean | null;
```

(For the optional payload interfaces use `excludeFromProjection?: boolean | null;`.)

In `TransactionForm.tsx`:

1. Import the helpers near the top:

```ts
import { projectionToSelect, selectToProjection } from '@/lib/projection-intent';
```

2. Add to the zod schema (`buildTransactionSchema`, after the `status` line ~58):

```ts
    excludeFromProjection: z.boolean().nullable().default(null),
```

3. In the edit-branch `defaultValues` (after `status:` at ~line 203), add:

```ts
          excludeFromProjection: initSource.excludeFromProjection ?? null,
```

4. Add the control after the status `<Select>` block (after ~line 1107):

```tsx
      {/* Projection recurrence intent */}
      <Select
        label={t('form.fields.projection')}
        options={[
          { value: 'auto', label: t('form.projectionOptions.auto') },
          { value: 'one_time', label: t('form.projectionOptions.oneTime') },
          { value: 'recurring', label: t('form.projectionOptions.recurring') },
        ]}
        value={projectionToSelect(watch('excludeFromProjection'))}
        onChange={(e) =>
          setValue('excludeFromProjection', selectToProjection(e.target.value), {
            shouldDirty: true,
          })
        }
      />
```

(The `payload` object at ~line 820 already spreads `...data`, so `excludeFromProjection` flows to both create and update automatically. Transfers use a separate `transferData` and are excluded from projections by the query — leave them unchanged.)

5. Add i18n keys to `frontend/src/i18n/messages/en/transactions.json` — under `form.fields` add `"projection": "Projection"`, and add a sibling block to `form.statusOptions`:

```json
    "projectionOptions": {
      "auto": "Auto (detect)",
      "oneTime": "One-time (don't project)",
      "recurring": "Recurring (always project)"
    }
```

- [ ] **Step 6: Regenerate the pseudo-locale and build**

Run: `cd frontend && npm run i18n:pseudo && npm run build`
Expected: pseudo-locale regenerated; build succeeds. (`npm run i18n:check` / the parity test will flag the new `transactions` keys for the other 20 locales — expected, deferred to T-568.)

- [ ] **Step 7: Commit**

```bash
git add frontend/src/lib/projection-intent.ts frontend/src/lib/projection-intent.test.ts frontend/src/types/transaction.ts frontend/src/components/transactions/TransactionForm.tsx frontend/src/i18n/messages/en/transactions.json frontend/src/i18n/messages/xx/transactions.json
git commit -m "feat(t-550): tri-state projection control on TransactionForm"
```

---

## Task 7: Frontend — forecast one-time exclusions list

**Files:**
- Modify: `frontend/src/types/built-in-reports.ts`
- Create: `frontend/src/components/bills/OneTimeExclusionsList.tsx`
- Create: `frontend/src/components/bills/OneTimeExclusionsList.test.tsx`
- Modify: `frontend/src/app/bills/page.tsx`
- Modify: `frontend/src/i18n/messages/en/bills.json`

**Interfaces:**
- Consumes: `SpendingTrendsResponse.excludedOutliers` (each with `transactionId`, `reason`, `amount`, `payeeName`, `categoryName`); `transactionsApi.update(id, { excludeFromProjection })`.
- Produces: `<OneTimeExclusionsList outliers={...} currencyCode={...} onChanged={...} />`.

- [ ] **Step 1: Add the frontend type field**

In `frontend/src/types/built-in-reports.ts`, add to `SpendingTrendOutlier` (~line 324):

```ts
  transactionId: string;
```

- [ ] **Step 2: Write the failing component test**

Create `frontend/src/components/bills/OneTimeExclusionsList.test.tsx` (mirror the render/query style of `frontend/src/components/ui/Select.test.tsx`):

```tsx
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { OneTimeExclusionsList } from './OneTimeExclusionsList';
import { transactionsApi } from '@/lib/transactions';

jest.mock('@/lib/transactions', () => ({
  transactionsApi: { update: jest.fn().mockResolvedValue({}) },
}));

jest.mock('next-intl', () => ({
  useTranslations: () => (key: string) => key,
}));

const outlier = {
  date: '2026-03-20',
  categoryId: null,
  categoryName: 'Uncategorized',
  amount: 4200,
  payeeName: 'DebtSettlementCo',
  reason: 'single_payee_occurrence',
  transactionId: 'txn-1',
};

describe('OneTimeExclusionsList', () => {
  it('renders excluded outliers', () => {
    render(
      <OneTimeExclusionsList
        outliers={[outlier]}
        currencyCode="USD"
        onChanged={jest.fn()}
      />,
    );
    expect(screen.getByText('DebtSettlementCo')).toBeInTheDocument();
  });

  it('rescues an outlier (sets excludeFromProjection false) and refetches', async () => {
    const onChanged = jest.fn();
    render(
      <OneTimeExclusionsList
        outliers={[outlier]}
        currencyCode="USD"
        onChanged={onChanged}
      />,
    );
    fireEvent.click(screen.getByTestId('rescue-txn-1'));
    await waitFor(() =>
      expect(transactionsApi.update).toHaveBeenCalledWith('txn-1', {
        excludeFromProjection: false,
      }),
    );
    expect(onChanged).toHaveBeenCalled();
  });

  it('renders nothing when there are no outliers', () => {
    const { container } = render(
      <OneTimeExclusionsList outliers={[]} currencyCode="USD" onChanged={jest.fn()} />,
    );
    expect(container).toBeEmptyDOMElement();
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `cd frontend && npm test -- OneTimeExclusionsList`
Expected: FAIL — component module not found.

- [ ] **Step 4: Implement the component**

Create `frontend/src/components/bills/OneTimeExclusionsList.tsx`:

```tsx
'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { transactionsApi } from '@/lib/transactions';
import type { SpendingTrendOutlier } from '@/types/built-in-reports';
import { formatCurrency } from '@/lib/format';

interface OneTimeExclusionsListProps {
  outliers: SpendingTrendOutlier[];
  currencyCode: string;
  onChanged: () => void;
}

export function OneTimeExclusionsList({
  outliers,
  currencyCode,
  onChanged,
}: OneTimeExclusionsListProps) {
  const t = useTranslations('bills');
  const [pendingId, setPendingId] = useState<string | null>(null);

  if (outliers.length === 0) return null;

  const apply = async (transactionId: string, value: boolean) => {
    setPendingId(transactionId);
    try {
      await transactionsApi.update(transactionId, {
        excludeFromProjection: value,
      });
      onChanged();
    } finally {
      setPendingId(null);
    }
  };

  return (
    <div className="mt-4 rounded-lg border border-gray-200 dark:border-gray-700 p-4">
      <h3 className="text-sm font-semibold text-gray-900 dark:text-gray-100">
        {t('forecast.exclusions.title')}
      </h3>
      <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
        {t('forecast.exclusions.subtitle')}
      </p>
      <ul className="mt-3 divide-y divide-gray-100 dark:divide-gray-800">
        {outliers.map((o) => (
          <li
            key={o.transactionId}
            className="flex items-center justify-between py-2 text-sm"
          >
            <span className="text-gray-800 dark:text-gray-200">
              {o.payeeName || o.categoryName} ·{' '}
              {formatCurrency(o.amount, currencyCode)}
            </span>
            <span className="flex gap-2">
              <button
                type="button"
                data-testid={`confirm-${o.transactionId}`}
                disabled={pendingId === o.transactionId}
                onClick={() => apply(o.transactionId, true)}
                className="rounded border border-gray-300 dark:border-gray-600 px-2 py-1 text-xs"
              >
                {t('forecast.exclusions.confirm')}
              </button>
              <button
                type="button"
                data-testid={`rescue-${o.transactionId}`}
                disabled={pendingId === o.transactionId}
                onClick={() => apply(o.transactionId, false)}
                className="rounded border border-blue-500 px-2 py-1 text-xs text-blue-600 dark:text-blue-400"
              >
                {t('forecast.exclusions.rescue')}
              </button>
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}
```

(Confirm the `formatCurrency` import path against an existing bills component; if the util lives elsewhere, use that path.)

- [ ] **Step 5: Run test to verify it passes**

Run: `cd frontend && npm test -- OneTimeExclusionsList`
Expected: PASS.

- [ ] **Step 6: Thread excludedOutliers through bills/page.tsx**

In `frontend/src/app/bills/page.tsx`:

1. In `loadTrends` (line ~183-196), add `excludedOutliers` to the `setTrendData` object:

```ts
        totalDailyFill: data.totalDailyFill,
        excludedOutliers: data.excludedOutliers ?? [],
        currencyCode: data.currencyCode,
```

2. Add `excludedOutliers: SpendingTrendOutlier[]` and `currencyCode: string` to the local `trendData` state type (the type argument of the `useState`/setter for `trendData`; add the `SpendingTrendOutlier` import from `@/types/built-in-reports`).

3. Import and render the list next to the forecast chart (after the `<CashFlowForecastChart ... />` at ~line 649):

```tsx
      {trendData && (
        <OneTimeExclusionsList
          outliers={trendData.excludedOutliers}
          currencyCode={trendData.currencyCode}
          onChanged={loadTrends}
        />
      )}
```

with the import:

```ts
import { OneTimeExclusionsList } from '@/components/bills/OneTimeExclusionsList';
```

4. Add i18n keys to `frontend/src/i18n/messages/en/bills.json` under `forecast`:

```json
    "exclusions": {
      "title": "Treated as one-time",
      "subtitle": "These charges are not projected forward. Rescue any that actually recur.",
      "confirm": "One-time",
      "rescue": "Recurring"
    }
```

- [ ] **Step 7: Regenerate pseudo-locale and build**

Run: `cd frontend && npm run i18n:pseudo && npm run build`
Expected: pseudo regenerated; build succeeds. (Parity for the other 20 locales' `bills` keys deferred to T-568.)

- [ ] **Step 8: Commit**

```bash
git add frontend/src/types/built-in-reports.ts frontend/src/components/bills/OneTimeExclusionsList.tsx frontend/src/components/bills/OneTimeExclusionsList.test.tsx frontend/src/app/bills/page.tsx frontend/src/i18n/messages/en/bills.json frontend/src/i18n/messages/xx/bills.json
git commit -m "feat(t-550): surface + confirm/override one-time exclusions in the cash-flow forecast"
```

---

## Task 8: Live verification + runbook

**Files:**
- Modify: `docs/superpowers/plans/2026-07-05-cash-flow-projection-one-time-exclusion.md` (append a "Live verification" record), or a short runbook note.

**Not a TDD task** — the mandatory live-verify gate against the running bare-metal instance.

- [ ] **Step 1: Deploy the branch**

Run: `cd ~/Gentoo_Dev/monize && ./scripts/rebuild.sh`
Expected: migration `093` applied, backend + frontend rebuilt, services restarted. Confirm the column exists:
`psql "$DATABASE_URL" -c "\d transactions" | grep exclude_from_projection`

- [ ] **Step 2: Reproduce the original bug case**

Using Zach's real data (the debt-settlement payoffs), open the Cash Flow forecast. Confirm the inflated projected monthly fill is present (baseline).

- [ ] **Step 3: Verify the flag drops the projection**

In the forecast's "Treated as one-time" list (or via the transaction form set to One-time), flag a payoff. Reload. Expected: the projected fill drops by the payoff's contribution; the payoff appears in the excluded list.

- [ ] **Step 4: Verify the FALSE override rescues a charge**

Pick a charge the payee-recurrence heuristic excluded that genuinely recurs; click "Recurring". Reload. Expected: it returns to the projection.

- [ ] **Step 5: Record the result**

Append a short "Live verification — <date>" section to this plan file noting the baseline, the drop, and the rescue, with the observed numbers. Commit.

```bash
git add docs/superpowers/plans/2026-07-05-cash-flow-projection-one-time-exclusion.md
git commit -m "docs(t-550): live verification record"
```

---

## Self-Review

**Spec coverage:** migration+entity (Task 1) ✔; tri-state honored / retroactive (Tasks 2-3) ✔; B2 payee-recurrence + amount_outlier preserved (Task 4) ✔; write path / no new endpoint / null-vs-absent (Task 5) ✔; TransactionForm tri-state (Task 6) ✔; forecast (a) surface+confirm/override with transactionId (Task 7) ✔; testing + live gate (all tasks + Task 8) ✔; deferred forecast (b), import-time, bulk, locale-parity — out of scope, noted. No spec requirement left without a task.

**Type consistency:** `excludeFromProjection: boolean | null` used identically across entity, DTO, `ParsedHistoricalSpend`, frontend `Transaction`, and helpers. `transactionId: string` consistent across `HistoricalSpendRow.transaction_id` → `ParsedHistoricalSpend.transactionId` → `SpendingTrendOutlier.transactionId`. `getOutlierReason(row, rows, oneTimePayeeKeys, monthsUsed)` and `filterHistoricalRows(rows, categoryNames, monthsUsed)` signatures match their call sites. `projectionToSelect`/`selectToProjection` names consistent between helper, test, and TransactionForm.

**Placeholder scan:** no TBD/TODO; every code step shows real code. Two "confirm the path" notes (frontend `formatCurrency` import; the `trendData` state type location) are pattern-confirmations the implementer resolves against the actual file, not missing logic.
