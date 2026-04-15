# Cash Flow Trend Projection

**Date:** 2026-04-14
**Status:** Approved
**Branch:** `manor/baseline-v1.8.36`

## Problem

Monize's cash flow forecast on the Bills page projects balances using only scheduled transactions. Categories without scheduled entries (groceries, dining, gas, etc.) are invisible to the projection, producing an unrealistically optimistic forecast. MS Money solved this with trend-based projection from historical spending — Monize needs the same capability.

## Approach

**Option C — Blended projection:** A single projected line where scheduled transactions replace trend data for categories that have them, and historical trend averages fill in for everything else. Expenses only — income stays scheduled. Unscheduled discretionary spending is spread evenly across each day.

## Design

### 1. Backend: Spending Trends Endpoint

**New service:** `SpendingTrendsService` in `backend/src/built-in-reports/`

**Method:** `getSpendingTrends(userId: string, lookbackMonths: number)`

**Logic:**

1. Query historical expenses from `transactions` table over the lookback window
   - Filters: `amount < 0`, `status != VOID`, `isTransfer = false`, `parentTransactionId IS NULL`
   - Group by category, compute monthly average per category
2. Query active `scheduled_transactions` for this user, compute monthly equivalent per category:
   - WEEKLY: `amount * 52 / 12`
   - BIWEEKLY: `amount * 26 / 12`
   - EVERY4WEEKS: `amount * 13 / 12`
   - SEMIMONTHLY: `amount * 2`
   - MONTHLY: `amount * 1`
   - QUARTERLY: `amount / 3`
   - YEARLY: `amount / 12`
   - DAILY: `amount * 365 / 12`
   - ONCE: excluded (not recurring)
3. For each category: `trendFill = max(0, |historicalMonthlyAvg| - |scheduledMonthlyEquivalent|)` (absolute values — both amounts are negative since they're expenses; we compare magnitudes)
4. Return only categories where `trendFill > 0`

**Response shape:**

```typescript
interface SpendingTrendsResponse {
  trends: Array<{
    categoryId: string | null;
    categoryName: string;
    monthlyAverage: number;
    scheduledMonthly: number;
    trendFill: number;        // positive — magnitude of unscheduled spending
    dailyFill: number;       // trendFill / 30, positive
  }>;
  totalMonthlyFill: number;  // sum of all trendFill, positive
  totalDailyFill: number;    // totalMonthlyFill / 30, positive
  lookbackMonths: number;
}
```

**Endpoint:** `GET /built-in-reports/spending-trends?lookbackMonths=3`

Registered in `built-in-reports.controller.ts` alongside existing report endpoints.

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

- For each day in the forecast period, add a synthetic transaction:
  - `name: "Projected spending"`
  - `amount: -totalDailyFill` (negative, it's spending)
  - `scheduledTransactionId: "trend"`
  - `isTrend: true`
- This is applied to the running balance alongside scheduled transactions
- When `trendData` is omitted or undefined, behavior is identical to current — no breaking change

### 4. Frontend: Chart & Page Changes

**File:** `frontend/src/components/bills/CashFlowForecastChart.tsx`

**New toggle:** Two-option pill next to the period selector:

```
[ Scheduled | Projected ]
```

- Persisted to `localStorage` key `cashFlowForecast.mode`
- Default: `"scheduled"` (current behavior preserved)
- When `"projected"`: passes `trendData` to `buildForecast()`

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

**Additional fetch in `loadData()`:**

```typescript
// Added to the existing Promise.all:
spendingTrendsApi.get({ lookbackMonths: preferences.forecastLookbackMonths ?? 3 })
```

Passes result to `CashFlowForecastChart` as `trendData` prop.

### 5. Frontend: Settings UI

**File:** `frontend/src/components/settings/PreferencesSection.tsx`

**New subsection:** "Cash Flow Forecast" — positioned after existing format/locale controls.

**Control:** Dropdown labeled "Trend lookback period"

**Options:** 1 month, 2 months, 3 months (default), 6 months, 9 months, 12 months

**Help text:** "Number of months of spending history used to project unscheduled expenses in the cash flow forecast."

**Files also modified:**
- `frontend/src/types/auth.ts` — add `forecastLookbackMonths` to `UserPreferences` and `UpdatePreferencesData`

### 6. Frontend: API Layer

**New file:** `frontend/src/lib/spending-trends.ts` (or extend existing report API)

```typescript
export const spendingTrendsApi = {
  get: (params: { lookbackMonths?: number }) =>
    apiClient.get<SpendingTrendsResponse>('/built-in-reports/spending-trends', { params }),
};
```

## Data Flow

```
bills/page.tsx
  ├── scheduledTransactionsApi.getAll()
  ├── categoriesApi.getAll()
  ├── accountsApi.getAll()
  ├── transactionsApi.getAll({ startDate: tomorrow })
  └── spendingTrendsApi.get({ lookbackMonths })  ← NEW
          │
          ▼
CashFlowForecastChart
  Toggle: [Scheduled | Projected]
          │
          ▼
forecast.ts: buildForecast(..., trendData?)
  1. Start with account.currentBalance
  2. Layer scheduled transaction occurrences on exact dates
  3. If trendData: add daily trend fill (negative) to each day
  4. Produce ForecastDataPoint[] with running balance
```

## Files Changed

| File | Change |
|------|--------|
| `backend/src/built-in-reports/spending-trends.service.ts` | **New** — trend aggregation + deduction logic |
| `backend/src/built-in-reports/built-in-reports.module.ts` | Modified — register new service |
| `backend/src/built-in-reports/built-in-reports.controller.ts` | Modified — new endpoint |
| `backend/src/users/entities/user-preference.entity.ts` | Modified — new column |
| `backend/src/users/dto/update-preferences.dto.ts` | Modified — new field |
| `backend/src/users/users.service.ts` | Modified — new field handling |
| `database/migrations/` | **New** — add `forecast_lookback_months` column |
| `frontend/src/lib/forecast.ts` | Modified — `TrendData` type, extended `buildForecast()` |
| `frontend/src/lib/spending-trends.ts` | **New** — API client for spending trends |
| `frontend/src/components/bills/CashFlowForecastChart.tsx` | Modified — toggle, tooltip, trend prop |
| `frontend/src/app/bills/page.tsx` | Modified — fetch trends, pass to chart |
| `frontend/src/components/settings/PreferencesSection.tsx` | Modified — lookback dropdown |
| `frontend/src/types/auth.ts` | Modified — `forecastLookbackMonths` field |
| `frontend/src/types/spending-trends.ts` | **New** — response types |

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
