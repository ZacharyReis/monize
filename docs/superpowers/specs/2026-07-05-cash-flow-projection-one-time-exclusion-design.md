# Cash-flow projection: one-time exclusion signal (T-550)

**Date:** 2026-07-05
**Status:** Design — approved, pending spec review
**Branch:** `t-550-one-time-projection-exclusion`
**Repo:** monize (`backend` + `frontend`)

## Problem

The cash-flow trend projection extrapolates **one-time charges** forward as if
they recur. Concrete case: one-time **debt-settlement payments** inflate the
projected monthly fill in the Cash Flow forecast.

Zach's key observation, confirmed correct: **categorizing them would not fix
it.** A category carries no "won't recur" signal — moving a payoff into a named
category just relocates it to a different averaging bucket.

## Root cause (verified live, `spending-trends.service.ts`, v1.11.3 line refs)

`getOutlierReason()` (line ~331) is the **only** one-time filter. It is purely
statistical and per-category, with two escape gates:

1. `single_historical_occurrence` — the *entire category bucket* has exactly one
   row, ≥ `ONE_TIME_EXPENSE_MIN_AMOUNT` ($100).
2. `amount_outlier` — a row ≥ 2.5–4× the bucket **median** and ≥ $100 delta
   (IQR high-fence for ≥4 rows).

Historical rows use `COALESCE(ts.category_id, t.category_id)` (line ~123), so
**every null-category row pools into one "Uncategorized" bucket** (key `null`).
Therefore:

- Gate 1 never fires (Uncategorized is never a single row).
- Gate 2 is defeated by clustering — 2+ payoffs raise the bucket's own median
  and mask each other.

Survivors fold into `total / monthsUsed` (line ~209) and are projected forward
as recurring `trendFill`. The same failure applies to any **sparse real
category** a payoff is mis-filed into, not only Uncategorized.

## Design decisions (approved)

| # | Decision | Choice |
|---|----------|--------|
| 1 | Scope | **A + B** — the authoritative flag *and* a smarter default heuristic |
| 2 | Signal model | **Nullable tri-state** `exclude_from_projection` (NULL / TRUE / FALSE) |
| 3 | Heuristic (B) | **B2** — payee-recurrence across all categories |
| 4 | UX surface | **TransactionForm tri-state control** + **forecast (a)**: confirm/override the guesses. Forecast (b) — flagging a projected charge — deferred. |

The core thesis: the statistical filter is a *guess* at recurrence intent. The
fix makes that signal a **fact** (the flag), and makes the default *guess*
better (B2) by measuring recurrence directly.

## Architecture

### 1. Data model — migration `093` + entity

New column on `transactions`, nullable, default NULL:

```sql
-- 093_transaction_exclude_from_projection.sql
-- Cash-flow projection recurrence intent (t-550). Tri-state:
--   NULL  = defer to the statistical heuristic (default / today's behavior)
--   TRUE  = user marked one-time; never project forward
--   FALSE = user marked recurring; always project (override an aggressive guess)
ALTER TABLE transactions
    ADD COLUMN IF NOT EXISTS exclude_from_projection BOOLEAN NULL;
```

No index: the column rides along the existing historical query and is evaluated
in JS. It is not a query predicate at the SQL level (the tri-state precedence is
resolved in `filterHistoricalRows`, alongside the heuristic).

Entity (`transaction.entity.ts`), following the `is_transfer` / `is_split`
precedent but nullable:

```ts
@Column({ name: "exclude_from_projection", type: "boolean", nullable: true })
excludeFromProjection: boolean | null;
```

### 2. A — how the flag is honored (query + filter precedence)

The historical query (`getSpendingTrends`) additionally selects, per row:

- `t.exclude_from_projection` — the tri-state flag.
- `t.id AS transaction_id` — the **parent** transaction id (distinct from the
  existing `row_id = COALESCE(ts.id, t.id)`, which may be a *split* id). Needed
  so the forecast override targets the row that owns the flag.

Carried through `HistoricalSpendRow → ParsedHistoricalSpend` as
`excludeFromProjection: boolean | null` and `transactionId: string`.

In `filterHistoricalRows`, the flag is resolved **before** any heuristic:

| Flag | Result | Reason string |
|------|--------|---------------|
| `true` | excluded | `marked_one_time` |
| `false` | included (all heuristics skipped) | — |
| `null` | run heuristics (single_historical_occurrence → **single_payee_occurrence** → amount_outlier) | as computed |

Because the filter reads the current DB, the fix is **retroactive**: flagging an
existing payoff corrects the forecast on next load. **No backfill.**

Splits: the flag is parent-level (`t.exclude_from_projection`). Excluding the
parent removes the whole parent (and all its splits) from history, consistent
with the query's existing `t.parent_transaction_id IS NULL` parent-level shape.

### 3. B2 — payee-recurrence heuristic

Measures recurrence **directly** (does this payee appear across multiple
months?) instead of amount-outlier-ness (a proxy). This fixes both the
Uncategorized pool and sparse-real-category cases, because it groups by payee,
not category.

**Precompute once** in `filterHistoricalRows`, over all parsed rows:

```ts
// payee (normalized) -> set of distinct YYYY-MM it appears in
const payeeMonths = new Map<string, Set<string>>();
for (const row of rows) {
  if (!row.payeeName) continue;              // null/empty payee: not eligible
  const key = row.payeeName.trim().toLocaleLowerCase();
  const months = payeeMonths.get(key) ?? new Set<string>();
  months.add(row.date.slice(0, 7));
  payeeMonths.set(key, months);
}
const oneTimePayeeKeys = new Set(
  [...payeeMonths].filter(([, months]) => months.size === 1).map(([k]) => k),
);
```

`payeeName` here is the query's `COALESCE(p.name, t.payee_name, t.description)`
(line ~125) — the same value used for outlier display — so payee grouping falls
back to the description when no payee is set.

**Gate** (evaluated only when flag is NULL, after `single_historical_occurrence`
and before `amount_outlier`), fires `single_payee_occurrence` when **all** hold:

- `monthsUsed >= PAYEE_RECURRENCE_MIN_MONTHS` (= **6**) — enough history to
  judge non-recurrence; in shorter windows the gate is disabled.
- `row.payeeName` is non-empty.
- `oneTimePayeeKeys.has(normalize(row.payeeName))` — payee appears in exactly one
  calendar month across the window.
- `row.amount >= ONE_TIME_EXPENSE_MIN_AMOUNT` ($100).

Rows whose payee matches an **active scheduled transaction** are already removed
from `historicalRows` by the existing `NOT EXISTS` anti-join (lines ~141–158), so
scheduled annual/recurring charges are inherently protected from this gate.

The existing `amount_outlier` gate (one abnormally large charge in a
genuinely-recurring category) is **preserved unchanged** and runs after the
payee gate.

**Known false positives (accepted; overridable via FALSE):**

- A genuinely *annual* charge with **no** scheduled transaction looks one-time in
  a ≤12-month window → flagged. Mitigation: model it as a scheduled txn, or set
  the tri-state to Recurring (FALSE).
- A **brand-new recurring** payee that has only appeared in the most recent month
  → flagged until it recurs. Self-corrects next month (distinct-months ≥ 2 stops
  the gate); overridable meanwhile.

### 4. UX — TransactionForm + forecast (a)

**TransactionForm** (`frontend/src/components/transactions/TransactionForm.tsx`):
a tri-state segmented control beside the existing status field —
**Auto / One-time / Recurring** → `null / true / false`. Zod schema gains
`excludeFromProjection: z.boolean().nullable().default(null)`; the value is
included in the create/update payload.

**Cash Flow forecast — (a) confirm/override the guesses:**
`excludedOutliers` is returned by the API today but **rendered nowhere**. Surface
it as a small "Treated as one-time (not projected)" list in the cash-flow view,
each entry carrying its new `transactionId` and `reason`:

- **Confirm** → PATCH `excludeFromProjection = true` (pins it excluded
  regardless of future heuristic changes).
- **Rescue / "this recurs"** → PATCH `excludeFromProjection = false` (forces it
  back into the projection).

Reason strings need i18n keys (the list is new): `marked_one_time`,
`single_payee_occurrence`, `single_historical_occurrence`, `amount_outlier`.
Locale parity is tracked separately (see T-568).

If two split rows of the same parent both appear as outliers, they share one
`transactionId`; acting on either flags the whole parent. Acceptable — the flag
is parent-level.

### 5. Write path

Extend the transaction update DTO (`update-transaction.dto.ts`) and service:

```ts
@ApiPropertyOptional({ nullable: true })
@IsOptional()
@IsBoolean()
excludeFromProjection?: boolean | null;
```

The service maps it onto the entity column. Both the TransactionForm and the
forecast override actions call the **existing** `PATCH /transactions/:id` — no new
endpoint. (`null` must be distinguishable from "field absent"; the update service
must only write the column when the key is present.)

### New / changed reason strings

| Reason | Set by | Meaning |
|--------|--------|---------|
| `marked_one_time` | flag `TRUE` | user marked one-time (new) |
| `single_payee_occurrence` | B2 heuristic | payee seen in one month, ≥$100 (new) |
| `single_historical_occurrence` | existing | category bucket had one row (unchanged) |
| `amount_outlier` | existing | statistical outlier vs bucket median (unchanged) |

## Data flow

```
transactions.exclude_from_projection (NULL|TRUE|FALSE)
        │
        ├── getSpendingTrends query  → HistoricalSpendRow{exclude_from_projection, transaction_id}
        │        │
        │        └── filterHistoricalRows
        │               ├── flag TRUE   → excludedOutliers[reason=marked_one_time]
        │               ├── flag FALSE  → included (skip heuristics)
        │               └── flag NULL   → single_historical_occurrence
        │                                 → single_payee_occurrence (B2)
        │                                 → amount_outlier
        │                                 → included
        │
        ├── excludedOutliers[]  → (NEW) forecast "treated as one-time" list
        │        └── Confirm→PATCH(true) / Rescue→PATCH(false)
        │
        └── included rows → total/monthsUsed → trendFill → projectionEvents (forecast chart)

TransactionForm tri-state control ── Auto/One-time/Recurring ──→ PATCH /transactions/:id
```

## Testing strategy

**Unit — `spending-trends.service.spec.ts`:**

- Tri-state precedence: `TRUE` → excluded as `marked_one_time`; `FALSE` →
  included even when it would otherwise be `amount_outlier`; `NULL` → heuristics
  run.
- B2 payee gate: single-month payee ≥$100 → `single_payee_occurrence`; same
  payee across 2 months → included; `monthsUsed < 6` → gate disabled; null-payee
  row → falls through to existing gates only.
- Regression: `amount_outlier` still fires for a recurring category with one
  abnormally large charge; `single_historical_occurrence` unchanged.
- `transactionId` present on every `excludedOutlier` and equals the **parent**
  transaction id even for split-sourced rows.

**Backend e2e:** `PATCH /transactions/:id { excludeFromProjection }` persists all
three states; trends response reflects the change; `null` clears an override.

**Frontend:** TransactionForm control round-trips the tri-state; forecast
excluded list renders, and Confirm/Rescue issue the correct PATCH.

**Live (mandatory):** reproduce Zach's real debt-payoff case — flag → the
inflated projection drops; set a wrongly-excluded charge to Recurring → it
returns. Verify against the running bare-metal instance.

## Rollout & review gate

- Deploy via `./scripts/rebuild.sh` (migrate + build + restart). Migration `093`
  is an `ALTER TABLE ... ADD COLUMN IF NOT EXISTS` on an existing table — no new
  table, so the T-555 table-ownership footgun (fixed in `042d3d1b`) does not
  apply here.
- Because this changes **live cash-flow forecast math** on real money data:
  **Lyra design-lens + Wren adversarial dual-review**, then the plan-review gate,
  before deploy. Live-verify after.

## Out of scope (this pass)

- **Forecast (b):** flagging a *projected* charge directly from the forecast.
  Projected events are synthesized and aggregated with no back-link to a source
  transaction; it needs per-trend contributing-row plumbing. Fast-follow.
- **Import-time auto-suggestion** of the flag (couples to the T-555 import path).
  Future.
- **Bulk-flag UI.** Future.
- **Locale parity** for the new reason strings (tracked in T-568).
