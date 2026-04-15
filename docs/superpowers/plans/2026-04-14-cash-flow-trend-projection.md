# Cash Flow Trend Projection — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add trend-based spending projection to Monize's cash flow forecast, blending scheduled transactions with historical category averages for unscheduled discretionary spending.

**Architecture:** New backend `SpendingTrendsService` computes per-category monthly averages, deducts scheduled transaction equivalents, and returns the residual "trend fill." Frontend extends `buildForecast()` to accept trend data as a daily balance drip, with a toggle on the chart between "Scheduled" and "Projected" modes. A user preference controls the lookback period.

**Tech Stack:** NestJS (backend), Next.js + React + Recharts (frontend), PostgreSQL, TypeORM

**Spec:** `docs/superpowers/specs/2026-04-14-cash-flow-trend-projection-design.md`

---

## File Map

### New Files
| File | Responsibility |
|------|---------------|
| `database/migrations/052_forecast_lookback_months.sql` | Add preference column |
| `backend/src/built-in-reports/spending-trends.service.ts` | Core trend aggregation + deduction logic |
| `backend/src/built-in-reports/spending-trends.service.spec.ts` | Unit tests |
| `backend/src/built-in-reports/dto/spending-trends-query.dto.ts` | Query param validation |
| `backend/src/built-in-reports/dto/spending-trends.dto.ts` | Response types |

### Modified Files
| File | Change |
|------|--------|
| `backend/src/built-in-reports/dto/index.ts` | Export new DTOs |
| `backend/src/built-in-reports/built-in-reports.module.ts` | Register SpendingTrendsService |
| `backend/src/built-in-reports/built-in-reports.service.ts` | Delegate getSpendingTrends() |
| `backend/src/built-in-reports/built-in-reports.controller.ts` | New endpoint |
| `backend/src/users/entities/user-preference.entity.ts` | New column |
| `backend/src/users/dto/update-preferences.dto.ts` | New field |
| `backend/src/users/users.service.ts` | Handle new field |
| `frontend/src/types/auth.ts` | Add forecastLookbackMonths |
| `frontend/src/types/built-in-reports.ts` | Add SpendingTrendsResponse |
| `frontend/src/lib/built-in-reports.ts` | Add getSpendingTrends() |
| `frontend/src/lib/forecast.ts` | TrendData type, extend buildForecast() |
| `frontend/src/components/bills/CashFlowForecastChart.tsx` | Toggle, tooltip, trend prop |
| `frontend/src/app/bills/page.tsx` | Fetch trends, pass to chart |
| `frontend/src/components/settings/PreferencesSection.tsx` | Lookback dropdown |

---

### Task 1: Database Migration

**Files:**
- Create: `database/migrations/052_forecast_lookback_months.sql`

- [ ] **Step 1: Create migration file**

```sql
-- 052_forecast_lookback_months.sql
-- Add forecast lookback months preference for cash flow trend projection
ALTER TABLE user_preferences
  ADD COLUMN IF NOT EXISTS forecast_lookback_months SMALLINT DEFAULT 3;
```

- [ ] **Step 2: Run migration**

Run: `cd /home/zach/Gentoo_Dev/monize && psql -U monize -d monize -f database/migrations/052_forecast_lookback_months.sql`
Expected: `ALTER TABLE` with no errors.

- [ ] **Step 3: Verify column exists**

Run: `psql -U monize -d monize -c "\d user_preferences" | grep forecast`
Expected: `forecast_lookback_months | smallint | | | 3`

- [ ] **Step 4: Commit**

```bash
git add database/migrations/052_forecast_lookback_months.sql
git commit -m "feat: add forecast_lookback_months preference column"
```

---

### Task 2: Backend User Preference Support

**Files:**
- Modify: `backend/src/users/entities/user-preference.entity.ts:78` (before `@CreateDateColumn`)
- Modify: `backend/src/users/dto/update-preferences.dto.ts:142` (before closing brace)
- Modify: `backend/src/users/users.service.ts:105-193` (getPreferences + updatePreferences)

- [ ] **Step 1: Add column to entity**

In `backend/src/users/entities/user-preference.entity.ts`, add before the `@CreateDateColumn` (after `preferredExchanges` at line 78):

```typescript
  @Column({ name: "forecast_lookback_months", type: "smallint", default: 3 })
  forecastLookbackMonths: number;
```

- [ ] **Step 2: Add field to UpdatePreferencesDto**

In `backend/src/users/dto/update-preferences.dto.ts`, add before the closing brace (after `preferredExchanges` at line 142). Import `IsInt` if not already imported:

```typescript
  @ApiPropertyOptional({
    description: "Number of months of spending history for cash flow trend projection",
    example: 3,
  })
  @IsOptional()
  @IsInt()
  @IsIn([1, 2, 3, 6, 9, 12])
  forecastLookbackMonths?: number;
```

- [ ] **Step 3: Add default in getPreferences()**

In `backend/src/users/users.service.ts`, inside `getPreferences()` (around line 122, after the other defaults), add:

```typescript
      preferences.forecastLookbackMonths = 3;
```

- [ ] **Step 4: Add handler in updatePreferences()**

In `backend/src/users/users.service.ts`, inside `updatePreferences()` (around line 189, after the last `if` block), add:

```typescript
    if (dto.forecastLookbackMonths !== undefined) {
      preferences.forecastLookbackMonths = dto.forecastLookbackMonths;
    }
```

- [ ] **Step 5: Verify backend compiles**

Run: `cd /home/zach/Gentoo_Dev/monize/backend && npx tsc --noEmit`
Expected: No errors.

- [ ] **Step 6: Commit**

```bash
git add backend/src/users/entities/user-preference.entity.ts \
       backend/src/users/dto/update-preferences.dto.ts \
       backend/src/users/users.service.ts
git commit -m "feat: add forecastLookbackMonths user preference"
```

---

### Task 3: Backend DTOs for Spending Trends

**Files:**
- Create: `backend/src/built-in-reports/dto/spending-trends-query.dto.ts`
- Create: `backend/src/built-in-reports/dto/spending-trends.dto.ts`
- Modify: `backend/src/built-in-reports/dto/index.ts`

- [ ] **Step 1: Create query DTO**

```typescript
// backend/src/built-in-reports/dto/spending-trends-query.dto.ts
import { ApiPropertyOptional } from "@nestjs/swagger";
import { IsOptional, IsInt, IsIn, IsString } from "class-validator";
import { Transform } from "class-transformer";

export class SpendingTrendsQueryDto {
  @ApiPropertyOptional({
    description: "Number of months to look back for spending averages",
    example: 3,
    default: 3,
  })
  @IsOptional()
  @Transform(({ value }) => parseInt(value, 10))
  @IsInt()
  @IsIn([1, 2, 3, 6, 9, 12])
  lookbackMonths?: number = 3;

  @ApiPropertyOptional({
    description: "Account ID to scope trends to, or 'all' for all accounts",
    example: "all",
    default: "all",
  })
  @IsOptional()
  @IsString()
  accountId?: string = "all";
}
```

- [ ] **Step 2: Create response DTO**

```typescript
// backend/src/built-in-reports/dto/spending-trends.dto.ts
import { ApiProperty } from "@nestjs/swagger";

export class SpendingTrendItem {
  @ApiProperty() categoryId: string | null;
  @ApiProperty() categoryName: string;
  @ApiProperty() monthlyAverage: number;
  @ApiProperty() scheduledMonthly: number;
  @ApiProperty() trendFill: number;
  @ApiProperty() dailyFill: number;
}

export class SpendingTrendsResponse {
  @ApiProperty({ type: [SpendingTrendItem] })
  trends: SpendingTrendItem[];

  @ApiProperty() totalMonthlyFill: number;
  @ApiProperty() totalDailyFill: number;
  @ApiProperty() lookbackMonths: number;
  @ApiProperty() monthsUsed: number;
  @ApiProperty() currencyCode: string;
}
```

- [ ] **Step 3: Export from index**

In `backend/src/built-in-reports/dto/index.ts`, add:

```typescript
export { SpendingTrendsQueryDto } from "./spending-trends-query.dto";
export { SpendingTrendsResponse, SpendingTrendItem } from "./spending-trends.dto";
```

- [ ] **Step 4: Verify compilation**

Run: `cd /home/zach/Gentoo_Dev/monize/backend && npx tsc --noEmit`
Expected: No errors.

- [ ] **Step 5: Commit**

```bash
git add backend/src/built-in-reports/dto/spending-trends-query.dto.ts \
       backend/src/built-in-reports/dto/spending-trends.dto.ts \
       backend/src/built-in-reports/dto/index.ts
git commit -m "feat: add DTOs for spending trends endpoint"
```

---

### Task 4: SpendingTrendsService — Core Logic

**Files:**
- Create: `backend/src/built-in-reports/spending-trends.service.ts`

This is the largest task — the core business logic.

- [ ] **Step 1: Create the service**

```typescript
// backend/src/built-in-reports/spending-trends.service.ts
import { Injectable, Logger } from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { Repository } from "typeorm";
import { Transaction } from "../transactions/entities/transaction.entity";
import { Account } from "../accounts/entities/account.entity";
import { Category } from "../categories/entities/category.entity";
import { ScheduledTransaction } from "../scheduled-transactions/entities/scheduled-transaction.entity";
import { ScheduledTransactionSplit } from "../scheduled-transactions/entities/scheduled-transaction-split.entity";
import { UserPreference } from "../users/entities/user-preference.entity";
import { ReportCurrencyService } from "./report-currency.service";
import { SpendingTrendsResponse, SpendingTrendItem } from "./dto/spending-trends.dto";

interface CategorySpendRow {
  category_id: string | null;
  total: string;
}

interface ScheduledRow {
  category_id: string | null;
  frequency: string;
  amount: string;
}

@Injectable()
export class SpendingTrendsService {
  private readonly logger = new Logger(SpendingTrendsService.name);

  constructor(
    @InjectRepository(Transaction)
    private readonly transactionsRepo: Repository<Transaction>,
    @InjectRepository(Account)
    private readonly accountsRepo: Repository<Account>,
    @InjectRepository(Category)
    private readonly categoriesRepo: Repository<Category>,
    @InjectRepository(ScheduledTransaction)
    private readonly scheduledRepo: Repository<ScheduledTransaction>,
    @InjectRepository(ScheduledTransactionSplit)
    private readonly scheduledSplitRepo: Repository<ScheduledTransactionSplit>,
    @InjectRepository(UserPreference)
    private readonly prefsRepo: Repository<UserPreference>,
    private readonly currencyService: ReportCurrencyService,
  ) {}

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
    const endDate = new Date(currentMonthStart.getTime() - 1).toISOString().split("T")[0]; // last day of prev month

    // Count completed months in window
    const monthsUsed = lookbackMonths;

    // Build account filter
    const accountFilter = accountId !== "all"
      ? `AND t.account_id = '${accountId}'`
      : "";

    // Step 1: Historical monthly average per category
    const historicalRows: CategorySpendRow[] = await this.transactionsRepo.query(
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
        ${accountFilter}
      GROUP BY COALESCE(ts.category_id, t.category_id)`,
      [userId, startDate, endDate],
    );

    // Build historical map: categoryId -> monthly average
    const historicalMap = new Map<string | null, number>();
    for (const row of historicalRows) {
      const catId = row.category_id;
      const monthlyAvg = parseFloat(row.total) / monthsUsed;
      historicalMap.set(catId, monthlyAvg);
    }

    // Step 2: Scheduled monthly equivalent per category
    // Get unsplit scheduled transactions
    const scheduledUnsplitRows: ScheduledRow[] = await this.transactionsRepo.query(
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
        AND (st.occurrences_remaining IS NULL OR st.occurrences_remaining > 0)
        AND (st.end_date IS NULL OR st.end_date >= CURRENT_DATE)
        AND a.account_type != 'INVESTMENT'
        AND a.is_closed = false
        ${accountFilter.replace(/t\.account_id/g, "st.account_id")}`,
      [userId],
    );

    // Get split scheduled transactions
    const scheduledSplitRows: ScheduledRow[] = await this.transactionsRepo.query(
      `SELECT
        sts.category_id,
        st.frequency,
        sts.amount
      FROM scheduled_transactions st
      JOIN scheduled_transaction_splits sts ON sts.scheduled_transaction_id = st.id
      LEFT JOIN accounts a ON a.id = st.account_id
      WHERE st.user_id = $1
        AND st.is_active = true
        AND st.is_split = true
        AND st.is_transfer = false
        AND st.frequency != 'ONCE'
        AND (st.occurrences_remaining IS NULL OR st.occurrences_remaining > 0)
        AND (st.end_date IS NULL OR st.end_date >= CURRENT_DATE)
        AND a.account_type != 'INVESTMENT'
        AND a.is_closed = false
        AND (sts.transfer_account_id IS NULL)
        ${accountFilter.replace(/t\.account_id/g, "st.account_id")}`,
      [userId],
    );

    // Build scheduled map: categoryId -> monthly equivalent (absolute)
    const scheduledMap = new Map<string | null, number>();
    const allScheduledRows = [...scheduledUnsplitRows, ...scheduledSplitRows];

    for (const row of allScheduledRows) {
      const catId = row.category_id;
      const amount = Math.abs(parseFloat(row.amount));
      const monthly = this.toMonthlyEquivalent(amount, row.frequency);
      scheduledMap.set(catId, (scheduledMap.get(catId) || 0) + monthly);
    }

    // Step 3: Compute trend fill per category
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

  private toMonthlyEquivalent(amount: number, frequency: string): number {
    switch (frequency) {
      case "DAILY": return amount * 365 / 12;
      case "WEEKLY": return amount * 52 / 12;
      case "BIWEEKLY": return amount * 26 / 12;
      case "EVERY4WEEKS": return amount * 13 / 12;
      case "SEMIMONTHLY": return amount * 2;
      case "MONTHLY": return amount;
      case "QUARTERLY": return amount / 3;
      case "YEARLY": return amount / 12;
      default: return 0;
    }
  }

  private async getCategoryNames(userId: string): Promise<Map<string | null, string>> {
    const categories = await this.categoriesRepo.find({ where: { userId } });
    const map = new Map<string | null, string>();
    for (const cat of categories) {
      map.set(cat.id, cat.name);
    }
    map.set(null, "Uncategorized");
    return map;
  }
}
```

- [ ] **Step 2: Verify compilation**

Run: `cd /home/zach/Gentoo_Dev/monize/backend && npx tsc --noEmit`
Expected: No errors. If ScheduledTransaction or ScheduledTransactionSplit imports fail, check the exact import paths and entity exports.

- [ ] **Step 3: Commit**

```bash
git add backend/src/built-in-reports/spending-trends.service.ts
git commit -m "feat: add SpendingTrendsService with trend aggregation and deduction logic"
```

---

### Task 5: SpendingTrendsService — Unit Tests

**Files:**
- Create: `backend/src/built-in-reports/spending-trends.service.spec.ts`

- [ ] **Step 1: Write tests**

```typescript
// backend/src/built-in-reports/spending-trends.service.spec.ts
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
        { provide: getRepositoryToken(Transaction), useValue: transactionsRepo },
        { provide: getRepositoryToken(Account), useValue: { find: jest.fn() } },
        { provide: getRepositoryToken(Category), useValue: categoriesRepo },
        { provide: getRepositoryToken(ScheduledTransaction), useValue: { find: jest.fn() } },
        { provide: getRepositoryToken(ScheduledTransactionSplit), useValue: { find: jest.fn() } },
        {
          provide: getRepositoryToken(UserPreference),
          useValue: { findOne: jest.fn().mockResolvedValue({ defaultCurrency: "USD" }) },
        },
        { provide: ReportCurrencyService, useValue: {} },
      ],
    }).compile();

    service = module.get(SpendingTrendsService);
  });

  it("returns empty trends when no historical spending", async () => {
    const result = await service.getSpendingTrends(mockUserId, 3, "all");
    expect(result.trends).toEqual([]);
    expect(result.totalMonthlyFill).toBe(0);
    expect(result.totalDailyFill).toBe(0);
    expect(result.monthsUsed).toBe(3);
    expect(result.currencyCode).toBe("USD");
  });

  it("returns full trend fill when no scheduled transactions match", async () => {
    // First query: historical spending (Food category, $1500 total over 3 months)
    // Second query: unsplit scheduled (none)
    // Third query: split scheduled (none)
    transactionsRepo.query
      .mockResolvedValueOnce([{ category_id: "cat-food", total: "4500.00" }])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([]);

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

  it("deducts scheduled equivalent from historical average", async () => {
    // Historical: Loan category, $7500 total over 3 months = $2500/mo avg
    // Scheduled: monthly $2443.65
    transactionsRepo.query
      .mockResolvedValueOnce([{ category_id: "cat-loan", total: "7500.00" }])
      .mockResolvedValueOnce([{ category_id: "cat-loan", frequency: "MONTHLY", amount: "-2443.65" }])
      .mockResolvedValueOnce([]);

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

  it("returns zero trend fill when scheduled covers historical", async () => {
    // Historical: $2400/mo, Scheduled: $2443.65/mo — fully covered
    transactionsRepo.query
      .mockResolvedValueOnce([{ category_id: "cat-loan", total: "7200.00" }])
      .mockResolvedValueOnce([{ category_id: "cat-loan", frequency: "MONTHLY", amount: "-2443.65" }])
      .mockResolvedValueOnce([]);

    categoriesRepo.find.mockResolvedValue([
      { id: "cat-loan", userId: mockUserId, name: "Loan" },
    ]);

    const result = await service.getSpendingTrends(mockUserId, 3, "all");
    expect(result.trends).toHaveLength(0);
    expect(result.totalMonthlyFill).toBe(0);
  });

  it("handles weekly scheduled frequency conversion correctly", async () => {
    // Historical: $7000 over 3 months = $2333.33/mo
    // Scheduled: weekly $400 = $400 * 52/12 = $1733.33/mo
    // trendFill = 2333.33 - 1733.33 = 600
    transactionsRepo.query
      .mockResolvedValueOnce([{ category_id: "cat-income", total: "7000.00" }])
      .mockResolvedValueOnce([{ category_id: "cat-income", frequency: "WEEKLY", amount: "-400.00" }])
      .mockResolvedValueOnce([]);

    categoriesRepo.find.mockResolvedValue([
      { id: "cat-income", userId: mockUserId, name: "Income" },
    ]);

    const result = await service.getSpendingTrends(mockUserId, 3, "all");
    expect(result.trends).toHaveLength(1);
    expect(result.trends[0].trendFill).toBeCloseTo(600, 0);
  });

  it("handles uncategorized transactions", async () => {
    transactionsRepo.query
      .mockResolvedValueOnce([{ category_id: null, total: "900.00" }])
      .mockResolvedValueOnce([])
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
      .mockResolvedValueOnce([])
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
});
```

- [ ] **Step 2: Run tests**

Run: `cd /home/zach/Gentoo_Dev/monize/backend && npx jest --testPathPattern=spending-trends.service.spec --no-coverage`
Expected: All tests pass.

- [ ] **Step 3: Commit**

```bash
git add backend/src/built-in-reports/spending-trends.service.spec.ts
git commit -m "test: add unit tests for SpendingTrendsService"
```

---

### Task 6: Backend Wiring — Module, Service Delegation, Controller

**Files:**
- Modify: `backend/src/built-in-reports/built-in-reports.module.ts`
- Modify: `backend/src/built-in-reports/built-in-reports.service.ts`
- Modify: `backend/src/built-in-reports/built-in-reports.controller.ts`

- [ ] **Step 1: Register in module**

In `backend/src/built-in-reports/built-in-reports.module.ts`, add to imports at top:

```typescript
import { ScheduledTransaction } from "../scheduled-transactions/entities/scheduled-transaction.entity";
import { ScheduledTransactionSplit } from "../scheduled-transactions/entities/scheduled-transaction-split.entity";
```

Add `ScheduledTransaction` and `ScheduledTransactionSplit` to the `TypeOrmModule.forFeature([...])` array.

Add `SpendingTrendsService` to the `providers` array:

```typescript
import { SpendingTrendsService } from "./spending-trends.service";
```

- [ ] **Step 2: Add delegation method to BuiltInReportsService**

In `backend/src/built-in-reports/built-in-reports.service.ts`, add to constructor injection:

```typescript
    private spendingTrends: SpendingTrendsService,
```

Add import at top:

```typescript
import { SpendingTrendsService } from "./spending-trends.service";
import { SpendingTrendsResponse } from "./dto";
```

Add delegation method at the end of the class:

```typescript
  getSpendingTrends(userId: string, lookbackMonths: number, accountId: string): Promise<SpendingTrendsResponse> {
    return this.spendingTrends.getSpendingTrends(userId, lookbackMonths, accountId);
  }
```

- [ ] **Step 3: Add controller endpoint**

In `backend/src/built-in-reports/built-in-reports.controller.ts`, add imports:

```typescript
import { SpendingTrendsQueryDto, SpendingTrendsResponse } from "./dto";
```

Add endpoint (at the end of the class, before the closing brace):

```typescript
  @Get("spending-trends")
  @ApiOperation({ summary: "Get spending trend projections for cash flow forecast" })
  @ApiResponse({ status: 200, type: SpendingTrendsResponse })
  getSpendingTrends(
    @Request() req,
    @Query() query: SpendingTrendsQueryDto,
  ): Promise<SpendingTrendsResponse> {
    return this.reportsService.getSpendingTrends(
      req.user.id,
      query.lookbackMonths ?? 3,
      query.accountId ?? "all",
    );
  }
```

- [ ] **Step 4: Verify compilation**

Run: `cd /home/zach/Gentoo_Dev/monize/backend && npx tsc --noEmit`
Expected: No errors.

- [ ] **Step 5: Verify existing tests still pass**

Run: `cd /home/zach/Gentoo_Dev/monize/backend && npx jest --testPathPattern=built-in-reports --no-coverage`
Expected: All existing tests pass.

- [ ] **Step 6: Commit**

```bash
git add backend/src/built-in-reports/built-in-reports.module.ts \
       backend/src/built-in-reports/built-in-reports.service.ts \
       backend/src/built-in-reports/built-in-reports.controller.ts
git commit -m "feat: wire spending trends endpoint into built-in-reports"
```

---

### Task 7: Frontend Types

**Files:**
- Modify: `frontend/src/types/auth.ts:78-98` (UserPreferences) and `:136-152` (UpdatePreferencesData)
- Modify: `frontend/src/types/built-in-reports.ts` (append)

- [ ] **Step 1: Add to UserPreferences**

In `frontend/src/types/auth.ts`, inside the `UserPreferences` interface (before `createdAt` at line 96), add:

```typescript
  forecastLookbackMonths: number;
```

- [ ] **Step 2: Add to UpdatePreferencesData**

In `frontend/src/types/auth.ts`, inside the `UpdatePreferencesData` interface (before the closing brace at line 152), add:

```typescript
  forecastLookbackMonths?: number;
```

- [ ] **Step 3: Add SpendingTrendsResponse**

In `frontend/src/types/built-in-reports.ts`, append at the end of the file:

```typescript

// Cash Flow Trend Projection
export interface SpendingTrendItem {
  categoryId: string | null;
  categoryName: string;
  monthlyAverage: number;
  scheduledMonthly: number;
  trendFill: number;
  dailyFill: number;
}

export interface SpendingTrendsResponse {
  trends: SpendingTrendItem[];
  totalMonthlyFill: number;
  totalDailyFill: number;
  lookbackMonths: number;
  monthsUsed: number;
  currencyCode: string;
}
```

- [ ] **Step 4: Verify frontend compiles**

Run: `cd /home/zach/Gentoo_Dev/monize/frontend && npx tsc --noEmit`
Expected: No errors.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/types/auth.ts \
       frontend/src/types/built-in-reports.ts
git commit -m "feat: add frontend types for spending trends and lookback preference"
```

---

### Task 8: Frontend API Layer

**Files:**
- Modify: `frontend/src/lib/built-in-reports.ts` (append method)

- [ ] **Step 1: Add getSpendingTrends to builtInReportsApi**

In `frontend/src/lib/built-in-reports.ts`, add the import for the new type at the top:

```typescript
import { ..., SpendingTrendsResponse } from '@/types/built-in-reports';
```

Add the method inside the `builtInReportsApi` object (before the closing `};`):

```typescript
  getSpendingTrends: async (
    params: { lookbackMonths?: number; accountId?: string },
  ): Promise<SpendingTrendsResponse> => {
    const response = await apiClient.get<SpendingTrendsResponse>(
      '/built-in-reports/spending-trends',
      { params },
    );
    return response.data;
  },
```

- [ ] **Step 2: Verify frontend compiles**

Run: `cd /home/zach/Gentoo_Dev/monize/frontend && npx tsc --noEmit`
Expected: No errors.

- [ ] **Step 3: Commit**

```bash
git add frontend/src/lib/built-in-reports.ts
git commit -m "feat: add getSpendingTrends to built-in reports API client"
```

---

### Task 9: Frontend Forecast Library — TrendData + buildForecast Extension

**Files:**
- Modify: `frontend/src/lib/forecast.ts`

- [ ] **Step 1: Add TrendData type and extend ForecastTransaction**

In `frontend/src/lib/forecast.ts`, after the `ForecastTransaction` interface (line 19), add `isTrend` field:

```typescript
export interface ForecastTransaction {
  name: string;
  amount: number;
  scheduledTransactionId: string;
  isTrend?: boolean;
}
```

After the `FORECAST_PERIOD_LABELS` constant (line 42), add the TrendData type:

```typescript
export interface TrendData {
  trends: Array<{
    categoryName: string;
    dailyFill: number;
  }>;
  totalDailyFill: number;
}
```

- [ ] **Step 2: Extend buildForecast() signature**

In `frontend/src/lib/forecast.ts`, add `trendData` parameter to `buildForecast()` (line 233):

```typescript
export function buildForecast(
  accounts: Account[],
  transactions: ScheduledTransaction[],
  period: ForecastPeriod,
  accountId: string | 'all',
  futureTransactions: FutureTransaction[] = [],
  convertAmount?: (amount: number, currencyCode: string) => number,
  trendData?: TrendData,
): ForecastDataPoint[] {
```

- [ ] **Step 3: Add trend drip to the balance loop**

In `buildForecast()`, inside the day iteration loop (around line 340), after the line `for (const tx of dayTransactions) { currentBalance += tx.amount; }`, add trend balance adjustment:

```typescript
    // Apply trend drip to running balance (every day, regardless of granularity)
    if (trendData && trendData.totalDailyFill > 0) {
      currentBalance -= trendData.totalDailyFill;
    }
```

Then modify the data point creation section. After `const isLastDay = dayOffset === days;` and inside the `if (shouldAddPoint || ...)` block, before `dataPoints.push(...)`, add the aggregated trend tooltip item:

```typescript
    if (shouldAddPoint || dayTransactions.length > 0 || isLastDay) {
      // Add aggregated trend item on emitted points only
      const pointTransactions = [...dayTransactions];
      if (trendData && trendData.totalDailyFill > 0) {
        const daysSinceLastEmit = lastAddedTime === null
          ? 1
          : Math.max(1, Math.floor((currentTime - lastAddedTime) / (1000 * 60 * 60 * 24)));
        pointTransactions.push({
          name: 'Projected spending',
          amount: -(trendData.totalDailyFill * daysSinceLastEmit),
          scheduledTransactionId: 'trend',
          isTrend: true,
        });
      }

      dataPoints.push({
        date: dateKey,
        balance: Math.round(currentBalance * 100) / 100,
        label: formatDateLabel(currentDate),
        transactions: pointTransactions,
      });
      lastAddedTime = currentTime;
    }
```

Note: the existing `dayTransactions` reference in `dataPoints.push` must be replaced with `pointTransactions`.

- [ ] **Step 4: Verify frontend compiles**

Run: `cd /home/zach/Gentoo_Dev/monize/frontend && npx tsc --noEmit`
Expected: No errors.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/lib/forecast.ts
git commit -m "feat: extend buildForecast() with TrendData support and daily balance drip"
```

---

### Task 10: CashFlowForecastChart — Toggle and Tooltip

**Files:**
- Modify: `frontend/src/components/bills/CashFlowForecastChart.tsx`

- [ ] **Step 1: Add TrendData import and prop**

Add import at top:

```typescript
import { ..., TrendData } from '@/lib/forecast';
```

Add `trendData` to the props interface:

```typescript
interface CashFlowForecastChartProps {
  scheduledTransactions: ScheduledTransaction[];
  accounts: Account[];
  futureTransactions?: FutureTransaction[];
  trendData?: TrendData;
  isLoading: boolean;
}
```

Add to destructured props:

```typescript
export function CashFlowForecastChart({
  scheduledTransactions,
  accounts,
  futureTransactions = [],
  trendData,
  isLoading,
}: CashFlowForecastChartProps) {
```

- [ ] **Step 2: Add forecast mode state**

After the existing `STORAGE_KEY_ACCOUNT` constant (line 94), add:

```typescript
const STORAGE_KEY_MODE = 'cashFlowForecast.mode';
type ForecastMode = 'scheduled' | 'projected';

function getStoredMode(): ForecastMode {
  if (typeof window === 'undefined') return 'scheduled';
  const stored = localStorage.getItem(STORAGE_KEY_MODE);
  return stored === 'projected' ? 'projected' : 'scheduled';
}
```

Inside the component, add state:

```typescript
const [forecastMode, setForecastMode] = useState<ForecastMode>(() => getStoredMode());
```

Add effect to persist:

```typescript
useEffect(() => {
  localStorage.setItem(STORAGE_KEY_MODE, forecastMode);
}, [forecastMode]);
```

- [ ] **Step 3: Pass trendData conditionally to buildForecast**

In the `forecastData` useMemo (line 163), pass trendData only when in projected mode:

```typescript
const forecastData = useMemo(() => {
  return buildForecast(
    accounts, scheduledTransactions, selectedPeriod, selectedAccountId, futureTransactions,
    needsConversion ? convertToDefault : undefined,
    forecastMode === 'projected' ? trendData : undefined,
  );
}, [accounts, scheduledTransactions, selectedPeriod, selectedAccountId, futureTransactions, needsConversion, convertToDefault, forecastMode, trendData]);
```

- [ ] **Step 4: Update transaction count to exclude trend items**

Replace the `totalForecastedTransactions` useMemo (line 175):

```typescript
const totalForecastedTransactions = useMemo(() => {
  return forecastData.reduce((sum, dp) =>
    sum + dp.transactions.filter(t => !t.isTrend).length, 0);
}, [forecastData]);
```

- [ ] **Step 5: Add toggle control**

In the JSX, after the period selector buttons `div` (after line 230), add the mode toggle:

```tsx
{/* Forecast mode toggle */}
<div className="flex bg-gray-100 dark:bg-gray-700 rounded-lg p-1">
  {(['scheduled', 'projected'] as const).map((mode) => (
    <button
      key={mode}
      onClick={() => setForecastMode(mode)}
      disabled={mode === 'projected' && !trendData}
      className={`px-3 py-1.5 text-sm font-medium rounded-md transition-colors ${
        forecastMode === mode
          ? 'bg-white dark:bg-gray-600 text-gray-900 dark:text-gray-100 shadow-sm'
          : 'text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-gray-200'
      } ${mode === 'projected' && !trendData ? 'opacity-50 cursor-not-allowed' : ''}`}
    >
      {mode === 'scheduled' ? 'Scheduled' : 'Projected'}
    </button>
  ))}
</div>
```

- [ ] **Step 6: Update tooltip for trend items**

In the `CashFlowTooltip` component, update the transaction rendering (around line 65) to style trend items differently:

```tsx
{data.transactions.slice(0, 5).map((tx, i) => (
  <p key={i} className="text-sm text-gray-700 dark:text-gray-300">
    <span
      className={
        tx.isTrend
          ? 'text-amber-600 dark:text-amber-400'
          : tx.amount >= 0
            ? 'text-green-600 dark:text-green-400'
            : 'text-red-600 dark:text-red-400'
      }
    >
      {tx.isTrend ? '~' : ''}{formatCurrency(tx.amount)}
    </span>{' '}
    {tx.name}
  </p>
))}
```

- [ ] **Step 7: Verify frontend compiles**

Run: `cd /home/zach/Gentoo_Dev/monize/frontend && npx tsc --noEmit`
Expected: No errors.

- [ ] **Step 8: Commit**

```bash
git add frontend/src/components/bills/CashFlowForecastChart.tsx
git commit -m "feat: add Scheduled/Projected toggle and trend tooltip styling to cash flow chart"
```

---

### Task 11: Bills Page — Fetch Trends

**Files:**
- Modify: `frontend/src/app/bills/page.tsx`

- [ ] **Step 1: Add imports and state**

Add import at top:

```typescript
import { builtInReportsApi } from '@/lib/built-in-reports';
import { SpendingTrendsResponse } from '@/types/built-in-reports';
import { TrendData } from '@/lib/forecast';
import { usePreferencesStore } from '@/store/preferencesStore';
```

Add state hook inside the component:

```typescript
const [trendData, setTrendData] = useState<TrendData | undefined>(undefined);
const preferences = usePreferencesStore((s) => s.preferences);
```

- [ ] **Step 2: Add trend data fetch**

After `loadData`, add a separate `loadTrends` function:

```typescript
const loadTrends = useCallback(async () => {
  try {
    const data = await builtInReportsApi.getSpendingTrends({
      lookbackMonths: preferences?.forecastLookbackMonths ?? 3,
    });
    setTrendData({
      trends: data.trends.map(t => ({
        categoryName: t.categoryName,
        dailyFill: t.dailyFill,
      })),
      totalDailyFill: data.totalDailyFill,
    });
  } catch {
    // Trend failure is non-fatal — chart falls back to scheduled mode
    setTrendData(undefined);
  }
}, [preferences?.forecastLookbackMonths]);
```

In the existing `useEffect` that calls `loadData()`, add `loadTrends()`:

```typescript
useEffect(() => {
  loadData();
  loadTrends();
}, [loadData, loadTrends]);
```

- [ ] **Step 3: Pass trendData to CashFlowForecastChart**

Update the `<CashFlowForecastChart>` usage:

```tsx
<CashFlowForecastChart
  scheduledTransactions={scheduledTransactions}
  accounts={accounts}
  futureTransactions={futureTransactions}
  trendData={trendData}
  isLoading={isLoading}
/>
```

- [ ] **Step 4: Verify frontend compiles**

Run: `cd /home/zach/Gentoo_Dev/monize/frontend && npx tsc --noEmit`
Expected: No errors.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/app/bills/page.tsx
git commit -m "feat: fetch spending trends and pass to cash flow chart"
```

---

### Task 12: Settings UI — Lookback Period Dropdown

**Files:**
- Modify: `frontend/src/components/settings/PreferencesSection.tsx`

- [ ] **Step 1: Add state and options**

Inside the `PreferencesSection` component, add state (alongside existing preference states):

```typescript
const [forecastLookbackMonths, setForecastLookbackMonths] = useState(
  preferences?.forecastLookbackMonths ?? 3
);
```

Add options constant (outside the component or inline):

```typescript
const LOOKBACK_OPTIONS = [
  { value: '1', label: '1 month' },
  { value: '2', label: '2 months' },
  { value: '3', label: '3 months' },
  { value: '6', label: '6 months' },
  { value: '9', label: '9 months' },
  { value: '12', label: '12 months' },
];
```

- [ ] **Step 2: Add to save handler**

In the `handleUpdatePreferences` function, add `forecastLookbackMonths` to the `data` object:

```typescript
const data: UpdatePreferencesData = {
  dateFormat, numberFormat, timezone, theme, defaultCurrency,
  weekStartsOn, showCreatedAt, timeFormat,
  preferredExchanges: preferredExchanges.filter(Boolean),
  forecastLookbackMonths,
};
```

- [ ] **Step 3: Add UI control**

After the last existing preference control (time format or preferred exchanges section), add:

```tsx
{/* Cash Flow Forecast */}
<div className="mt-6 pt-6 border-t border-gray-200 dark:border-gray-700">
  <h4 className="text-sm font-medium text-gray-900 dark:text-gray-100 mb-4">
    Cash Flow Forecast
  </h4>
  <Select
    label="Trend lookback period"
    options={LOOKBACK_OPTIONS}
    value={String(forecastLookbackMonths)}
    onChange={(e) => setForecastLookbackMonths(parseInt(e.target.value, 10))}
  />
  <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
    Number of months of spending history used to project unscheduled expenses in the cash flow forecast.
  </p>
</div>
```

- [ ] **Step 4: Sync state from preferences on load**

In the `useEffect` that syncs preference state from props (look for where other states are initialized from `preferences`), add:

```typescript
setForecastLookbackMonths(preferences?.forecastLookbackMonths ?? 3);
```

- [ ] **Step 5: Verify frontend compiles**

Run: `cd /home/zach/Gentoo_Dev/monize/frontend && npx tsc --noEmit`
Expected: No errors.

- [ ] **Step 6: Commit**

```bash
git add frontend/src/components/settings/PreferencesSection.tsx
git commit -m "feat: add cash flow forecast lookback period setting"
```

---

### Task 13: Live Verification

- [ ] **Step 1: Start backend**

Run: `cd /home/zach/Gentoo_Dev/monize/backend && npm run start:dev`
Expected: NestJS starts without errors, logs show the new endpoint registered.

- [ ] **Step 2: Test endpoint directly**

Run: `curl -s http://localhost:3000/built-in-reports/spending-trends?lookbackMonths=3 -H "Authorization: Bearer <token>" | jq .`
Expected: JSON response with `trends` array, `totalMonthlyFill`, `totalDailyFill`, `monthsUsed`, `currencyCode`.

- [ ] **Step 3: Start frontend**

Run: `cd /home/zach/Gentoo_Dev/monize/frontend && npm run dev`
Expected: Next.js starts without errors.

- [ ] **Step 4: Verify Bills page**

Open browser to Bills page. Verify:
- Chart loads in "Scheduled" mode (default) — looks identical to before
- "Projected" toggle appears next to period selector
- Clicking "Projected" shows a steeper declining line (reflects trend spending)
- Tooltip shows amber `~$XX.XX Projected spending` on hover
- "Scheduled" toggle restores original behavior

- [ ] **Step 5: Verify Settings**

Open Settings page. Verify:
- "Cash Flow Forecast" subsection appears with "Trend lookback period" dropdown
- Default is "3 months"
- Changing to a different value and saving persists the change
- Returning to Bills page and toggling "Projected" uses the new lookback value

- [ ] **Step 6: Final commit if any adjustments were needed**

```bash
git add -A
git commit -m "fix: adjustments from live verification"
```
