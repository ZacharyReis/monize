# Cash Flow Trend Projection

**Date:** 2026-04-14
**Status:** Approved (revised after Codex review)
**Branch:** `manor/baseline-v1.8.36`

## Problem

Monize's cash flow forecast on the Bills page projects balances using only scheduled transactions. Categories without scheduled entries (groceries, dining, gas, etc.) are invisible to the projection, producing an unrealistically optimistic forecast. MS Money solved this with trend-based projection from historical spending — Monize needs the same capability.

## Approach

**Option C — Blended projection:** A single projected line where scheduled transactions replace trend data for categories that have them, and historical trend averages fill in for everything else. Expenses only — income stays scheduled. Unscheduled discretionary spending is spread evenly across each day.

## Design

### 1. Backend: Spending Trends Endpoint

**New service:** `SpendingTrendsService` in `backend/src/built-in-reports/`, exposed through `BuiltInReportsService.getSpendingTrends()` (follows existing delegation pattern).

**Method:** `getSpendingTrends(userId: string, lookbackMonths: number, accountId: string | 'all')`

**Logic:**

1. Query historical expenses from `transactions` table over the lookback window
   - Filters: `amount < 0`, `status != VOID`, `isTransfer = false`, `parentTransactionId IS NULL`
   - **Account scoping:** filter to `accountId` when not `'all'`; always exclude closed accounts, investment/brokerage accounts, and transfer splits (match chart's forecast scope)
   - **Split handling:** use `COALESCE(ts.amount, t.amount)` and `COALESCE(ts.category_id, t.category_id)` to flatten split transactions — same pattern as `spending-reports.service.ts`
   - Group by category, compute monthly average per category
   - **Averaging window:** use only **completed calendar months** in the lookback. Include zero-spend months in the denominator (prevents over-projection of one-off categories). Current partial month is excluded. Return `monthsUsed` count.
2. Query active `scheduled_transactions` for this user (same account scope), compute monthly equivalent per category:
   - WEEKLY: `amount * 52 / 12`
   - BIWEEKLY: `amount * 26 / 12`
   - EVERY4WEEKS: `amount * 13 / 12`
   - SEMIMONTHLY: `amount * 2`
   - MONTHLY: `amount * 1`
   - QUARTERLY: `amount / 3`
   - YEARLY: `amount / 12`
   - DAILY: `amount * 365 / 12`
   - ONCE: excluded (not recurring)
   - **Finite schedules:** exclude schedules where `occurrencesRemaining = 0` or `endDate` is in the past
   - **Scheduled splits:** flatten via `scheduled_transaction_splits` table (same pattern as historical)
3. For each category: `trendFill = max(0, |historicalMonthlyAvg| - |scheduledMonthlyEquivalent|)` (absolute values — both amounts are negative since they're expenses; we compare magnitudes)
4. Return only categories where `trendFill > 0`

**Response shape:**

```typescript
interface SpendingTrendsResponse {
  trends: Array<{
    categoryId: string | null;
    categoryName: string;
    monthlyAverage: number;      // positive magnitude
    scheduledMonthly: number;    // positive magnitude
    trendFill: number;           // positive — magnitude of unscheduled spending
    dailyFill: number;           // trendFill / 30, positive
  }>;
  totalMonthlyFill: number;      // sum of all trendFill, positive
  totalDailyFill: number;        // totalMonthlyFill / 30, positive
  lookbackMonths: number;        // requested lookback
  monthsUsed: number;            // actual completed months in window
  currencyCode: string;          // currency of the amounts (derived from account scope)
}
```

**Endpoint:** `GET /built-in-reports/spending-trends?lookbackMonths=3&accountId=all`

**Query validation:** `SpendingTrendsQueryDto` with `@IsIn([1, 2, 3, 6, 9, 12])` for `lookbackMonths` (with `@Transform` for numeric coercion and default), `@IsOptional()` `accountId` defaulting to `'all'`.

Registered in `built-in-reports.controller.ts` alongside existing report endpoints. Delegated through `BuiltInReportsService`.

### 2. Backend: User Setting

**New column on `user_preferences`:**

| Column | Type | Default | Validation |
|--------|------|---------|------------|
| `forecast_lookback_months` | SMALLINT | `3` | `@IsIn([1, 2, 3, 6, 9, 12])` |

**Migration:** `ALTER TABLE user_preferences ADD COLUMN IF NOT EXISTS forecast_lookback_months SMALLINT DEFAULT 3;`

**Files modified:**
- `user-preference.entity.ts` — add `@Column()`
- `update-preferences.dto.ts` — add field with `@IsOptional()`, `@IsIn()`
- `users.service.ts` — add default in `getPreferences()`, handle in `updatePreferences()`

### 3. Frontend: Forecast Library

**File:** `frontend/src/lib/forecast.ts`

**New type:**

```typescript
export interface TrendData {
  trends: Array<{
    categoryName: string;
    dailyFill: number;
  }>;
  totalDailyFill: number;
}
```

**Extended `ForecastTransaction`:**

```typescript
export interface ForecastTransaction {
  name: string;
  amount: number;
  scheduledTransactionId: string;
  isTrend?: boolean;           // NEW — distinguishes trend from scheduled
}
```

**Extended `buildForecast()` signature:**

```typescript
export function buildForecast(
  accounts: Account[],
  transactions: ScheduledTransaction[],
  period: ForecastPeriod,
  accountId: string | 'all',
  futureTransactions?: FutureTransaction[],
  convertAmount?: (amount: number, currencyCode: string) => number,
  trendData?: TrendData,        // NEW
): ForecastDataPoint[]
```

**Behavior when `trendData` is provided:**

- For each day in the forecast period, subtract `totalDailyFill` from the running balance (applied as part of balance calculation, NOT as a forced transaction entry)
- On **emitted data points only** (days that pass the granularity check or have scheduled transactions), add an aggregated trend tooltip item:
  - `name: "Projected spending"`
  - `amount: -(dailyFill * daysSinceLastPoint)` (accumulated since last emitted point)
  - `scheduledTransactionId: "trend"`
  - `isTrend: true`
- **Trend-only days do NOT force data point emission** — respects existing granularity (daily for 7D/30D, every 3 days for 90D, weekly for 6M/1Y)
- **Trend items excluded from scheduled transaction count** in the chart subtitle
- When `trendData` is omitted or undefined, behavior is identical to current — no breaking change

### 4. Frontend: Chart & Page Changes

**File:** `frontend/src/components/bills/CashFlowForecastChart.tsx`

**New toggle:** Two-option pill next to the existing period selector:

```
[ Scheduled | Projected ]
```

- Persisted to `localStorage` key `cashFlowForecast.mode`
- Default: `"scheduled"` (current behavior preserved)
- When `"projected"`: passes `trendData` to `buildForecast()`
- **Transaction count subtitle:** exclude `isTrend` entries — only count real scheduled transactions

**New prop:**

```typescript
interface CashFlowForecastChartProps {
  scheduledTransactions: ScheduledTransaction[];
  accounts: Account[];
  futureTransactions?: FutureTransaction[];
  trendData?: TrendData;       // NEW
  isLoading: boolean;
}
```

**Tooltip enhancement:**

- Scheduled transactions: normal green (income) / red (expense) styling
- Trend transactions (`isTrend: true`): amber/orange text, prefixed with `~` to signal estimate
- Example: `~$50.53  Projected spending`

**File:** `frontend/src/app/bills/page.tsx`

**Additional fetch — isolated from main data loading:**

```typescript
// Fetched separately so trend failure doesn't break Scheduled mode
const trendData = await builtInReportsApi
  .getSpendingTrends({
    lookbackMonths: preferences.forecastLookbackMonths ?? 3,
    accountId: selectedAccountId,
  })
  .catch(() => undefined);
```

Passes result to `CashFlowForecastChart` as `trendData` prop. If the fetch fails, chart falls back to Scheduled mode gracefully.

### 5. Frontend: Settings UI

**File:** `frontend/src/components/settings/PreferencesSection.tsx`

**New subsection:** "Cash Flow Forecast" — positioned after existing format/locale controls.

**Control:** Dropdown labeled "Trend lookback period"

**Options:** 1 month, 2 months, 3 months (default), 6 months, 9 months, 12 months

**Help text:** "Number of months of spending history used to project unscheduled expenses in the cash flow forecast."

**Files also modified:**
- `frontend/src/types/auth.ts` — add `forecastLookbackMonths` to `UserPreferences` and `UpdatePreferencesData`

### 6. Frontend: API Layer

**Extend existing:** `frontend/src/lib/built-in-reports.ts` — add `getSpendingTrends()` method to `builtInReportsApi` object (follows existing pattern, no separate API file).

**Extend existing:** `frontend/src/types/built-in-reports.ts` — add `SpendingTrendsResponse` type.

```typescript
// In builtInReportsApi:
getSpendingTrends: async (params: { lookbackMonths?: number; accountId?: string }) => {
  const response = await apiClient.get<SpendingTrendsResponse>(
    '/built-in-reports/spending-trends',
    { params },
  );
  return response.data;
},
```

## Data Flow

```
bills/page.tsx
  ├── scheduledTransactionsApi.getAll()
  ├── categoriesApi.getAll()
  ├── accountsApi.getAll()
  ├── transactionsApi.getAll({ startDate: tomorrow })
  └── builtInReportsApi.getSpendingTrends(...)   ← NEW (isolated, .catch fallback)
          │
          ▼
CashFlowForecastChart
  Toggle: [Scheduled | Projected]
          │
          ▼
forecast.ts: buildForecast(..., trendData?)
  1. Start with account.currentBalance
  2. Layer scheduled transaction occurrences on exact dates
  3. If trendData: subtract daily trend fill from running balance
     - Only add trend tooltip item on emitted data points
     - Accumulate since last point for correct tooltip amount
  4. Produce ForecastDataPoint[] with running balance
```

## Files Changed

| File | Change |
|------|--------|
| `backend/src/built-in-reports/spending-trends.service.ts` | **New** — trend aggregation + deduction logic |
| `backend/src/built-in-reports/dto/spending-trends-query.dto.ts` | **New** — query param validation |
| `backend/src/built-in-reports/built-in-reports.service.ts` | Modified — delegate to SpendingTrendsService |
| `backend/src/built-in-reports/built-in-reports.module.ts` | Modified — register new service |
| `backend/src/built-in-reports/built-in-reports.controller.ts` | Modified — new endpoint |
| `backend/src/users/entities/user-preference.entity.ts` | Modified — new column |
| `backend/src/users/dto/update-preferences.dto.ts` | Modified — new field |
| `backend/src/users/users.service.ts` | Modified — new field handling |
| `database/migrations/` | **New** — add `forecast_lookback_months` column |
| `frontend/src/lib/forecast.ts` | Modified — `TrendData` type, extended `buildForecast()` |
| `frontend/src/lib/built-in-reports.ts` | Modified — add `getSpendingTrends()` method |
| `frontend/src/types/built-in-reports.ts` | Modified — add `SpendingTrendsResponse` type |
| `frontend/src/components/bills/CashFlowForecastChart.tsx` | Modified — toggle, tooltip, trend prop, exclude trend from count |
| `frontend/src/app/bills/page.tsx` | Modified — fetch trends (isolated), pass to chart |
| `frontend/src/components/settings/PreferencesSection.tsx` | Modified — lookback dropdown |
| `frontend/src/types/auth.ts` | Modified — `forecastLookbackMonths` field |

## What's NOT Touched

- Scheduled transactions system
- Existing forecast behavior in "Scheduled" mode
- Anomaly detection
- AI insights
- Budget system
- MCP tools

## Constraints

- Data available: Jan 1, 2026 through present (~3.5 months). The 3-month default lookback is appropriate for current data volume.
- The feature is additive — "Scheduled" mode is the default and behaves identically to current behavior.
- No cron jobs or cache tables — the aggregation query runs on-demand and is fast at this data scale.

## Codex Review

**Session:** 2026-04-14
**Findings:** 2 HIGH, 4 MEDIUM, 3 LOW — all incorporated above.

| # | Severity | Finding | Resolution |
|---|----------|---------|------------|
| 1 | HIGH | Endpoint was global/currency-blind but chart is account-scoped | Added `accountId` param, account scoping, `currencyCode` in response |
| 2 | HIGH | Split transactions not handled in deduction formula | Added COALESCE split flattening for both historical and scheduled queries |
| 3 | MEDIUM | Daily synthetic transactions would force 365 data points in year view | Changed to balance drip + accumulated tooltip on emitted points only |
| 4 | MEDIUM | Partial month averaging undefined | Specified completed calendar months only, zero-spend included in denominator |
| 5 | MEDIUM | Scheduled deduction ignored finite schedules | Added exclusion for exhausted/ended schedules |
| 6 | MEDIUM | No account eligibility rules defined | Added closed/investment/transfer exclusions matching chart scope |
| 7 | LOW | Pattern drift with separate API file | Changed to extend existing `builtInReportsApi` and types |
| 8 | LOW | Query param lacked its own DTO | Added `SpendingTrendsQueryDto` |
| 9 | LOW | Trend fetch failure could break Bills page | Isolated fetch with `.catch(() => undefined)` fallback |
