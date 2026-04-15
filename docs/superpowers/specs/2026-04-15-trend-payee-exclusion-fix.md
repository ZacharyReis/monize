# Cash Flow Trend Fix — Payee+Amount Exclusion

**Date:** 2026-04-15
**Status:** Approved (revised after Codex review)
**Branch:** `manor/baseline-v1.8.36`
**Parent spec:** `2026-04-14-cash-flow-trend-projection-design.md`

## Problem

The trend calculation double-counts spending already represented by scheduled transactions, inflating the cash flow projection by ~$3,400/month and projecting a -$19K balance over 90 days.

**Root cause:** The category-based subtraction (`trendFill = monthlyAvg - scheduledMonthly`, joined on `category_id`) fails when:

1. **Split mismatch:** Scheduled transactions use splits (e.g., mortgage splits into "Loan Interest" category + principal transfer), but historical bank imports categorize the same payment as a flat "Loan" or "Car Payment" — different category IDs, subtraction never fires.
2. **Null categories:** Some scheduled transactions have no `categoryId` set (e.g., AllState Insurance), so their monthly equivalent lands under `null` while historical transactions are properly categorized.

**Affected scheduled transactions (confirmed via data investigation):**

| Scheduled Transaction | Monthly Amount | Scheduled categoryId | Historical categoryName |
|---|---|---|---|
| Mortgage Payment | $2,443.65 | null (split: Loan Interest + transfers) | Loan |
| Loan Payment - Ford | $623.01 | null (split: Loan Interest + transfer) | Car Payment |
| AllState Insurance | $560.61 | null | Insurance |
| Loan Payment - Mitsubishi | $373.95 | null (split: Loan Interest + transfer) | Car Payment |
| **Total phantom drip** | **$4,001/month (~$133/day)** | | |

## Solution

Replace category-based subtraction with payee+exact-amount exclusion as the primary mechanism. Keep category subtraction as a narrow fallback for **unsplit, categorized** scheduled transactions without a payee.

### Algorithm

**Step 1 — Build exclusion set:**
Collect `(payee_id, ROUND(ABS(total_amount)::numeric, 2), currency_code)` triples from all active, non-transfer, recurring scheduled transactions that have a `payeeId` and `amount < 0` (expenses only).
- For split transactions (`is_split = true`), use the **parent's total amount** — this matches how bank imports post (flat, not split).
- For unsplit transactions, use `ABS(st.amount)`.
- Exclude `frequency = 'ONCE'` and exhausted/ended schedules.
- Filter to expenses only (`st.amount < 0`) to avoid suppressing real spending if a payee has both income and expense scheduled.

**Step 2 — Exclude matched historical transactions at parent level:**
Anti-join on the **parent transaction** before expanding splits. Use a CTE or subquery approach:
1. First, identify parent transaction IDs to exclude: `SELECT t.id FROM transactions t WHERE EXISTS (match in exclusion set on t.payee_id, ROUND(ABS(t.amount)::numeric, 2), account currency)`.
2. Then, in the main historical query, add `AND t.id NOT IN (excluded_ids)` so the entire parent transaction (including all its splits) is removed.

This ensures:
- Flat bank imports match on parent `t.amount` directly.
- If a historical transaction was manually split, the entire parent is still excluded because `t.amount` (the parent total) matches the scheduled total.
- No partial split removal — the exclusion is always at the parent transaction level.

**Step 3 — Compute monthly averages:**
Group remaining (unmatched) transactions by category. Monthly average = `SUM(ABS(amount)) / monthsUsed`. Same as current logic.

**Step 4 — Category fallback (narrowed):**
For scheduled transactions where `payeeId IS NULL` AND `is_split = false` AND `category_id IS NOT NULL`, keep the existing category subtraction:
- Query their monthly equivalents per category (using `toMonthlyEquivalent()`).
- `trendFill = max(0, monthlyAvg - fallbackScheduledMonthly)` per category.

Payee-less split transactions are **not eligible** for fallback — category subtraction fails for the same split-mismatch reason this spec exists to fix. These are effectively invisible to the trend (their historical spending stays in), which is the safer failure mode. Users should assign payees to scheduled bills for best results.

For categories with no fallback subtraction needed, `trendFill = monthlyAvg` directly.

**Step 5 — Output:**
Same response shape (`SpendingTrendsResponse`). `dailyFill = trendFill / 30`. No frontend changes required.

### Matching Rules

- **Exact amount match** — no tolerance, but compare via `ROUND(ABS(amount)::numeric, 2)` to avoid scale-4 precision mismatches between scheduled and historical amounts.
- **Payee ID match** — not name match. Both `Transaction` and `ScheduledTransaction` have `payeeId` fields referencing the same payees table. This is a reliable join.
- **Currency-aware** — include account `currency_code` in the matching key to prevent cross-currency false matches when `accountId=all`.
- **Expenses only** — exclusion set filtered to `st.amount < 0` to prevent income scheduled transactions from suppressing expense trend.
- **Parent-level exclusion** — removes the entire parent transaction and all its splits. No split-level matching.
- **Unbounded per payee** — all matching historical rows for a payee+amount are excluded, not just the expected number of occurrences. This is acceptable: if the same payee charges the exact same amount for both scheduled and discretionary purposes, it's rare enough to be a documented limitation rather than a design constraint.

## Scope

### Changes

| File | Change |
|------|--------|
| `backend/src/built-in-reports/spending-trends.service.ts` | Add payee+amount exclusion CTE; narrow scheduled equivalent queries to unsplit/categorized/payee-less only; parameterize `accountId` (security fix) |

### No changes

- Frontend (`forecast.ts`, `CashFlowForecastChart.tsx`) — same `TrendData` consumed
- API contract — same `SpendingTrendsResponse` DTO
- Other backend services
- Database schema (no migration needed)

## Expected Results

**Before fix (current):**
- Trend includes: Loan ~$163/day, Car Payment ~$33/day, Insurance ~$19/day (all phantom)
- Total daily drip: ~$329/day
- 90-day projection: $1,425 starting → -$19,164 ending

**After fix:**
- Loan, Car Payment, Insurance excluded from trend (matched by payee+amount)
- Remaining trend: Groceries, Dining Out, Supplies, Pet Care, etc. (genuinely discretionary)
- Total daily drip: estimated ~$30-50/day (based on tooltip minus phantom categories)
- 90-day projection: should remain positive or only slightly negative

## Edge Cases

| Case | Behavior |
|------|----------|
| Scheduled transaction with no `payeeId`, unsplit, with category | Falls back to category subtraction |
| Scheduled transaction with no `payeeId`, split or no category | No exclusion — historical spending stays in trend (safer failure mode) |
| Same payee, different scheduled vs discretionary amounts (e.g., Zelle $600 scheduled, Zelle $47 dinner) | Only $600 transactions excluded; $47 stays in trend |
| Multiple scheduled transactions for same payee at same amount | All matching historical rows excluded (unbounded, documented) |
| Historical transaction amount differs slightly from scheduled (e.g., variable utility bill) | NOT excluded — exact match only. Acceptable: variable bills are minor compared to fixed loans/insurance |
| Payee assigned to scheduled transaction but not to historical imports | No match found, historical spending stays in trend |
| Historical transaction manually split (e.g., mortgage split into P&I) | Excluded at parent level — `t.amount` still matches the scheduled total |
| Scheduled income with same payee+amount as an expense | NOT excluded — expense-only filter (`st.amount < 0`) prevents this |
| Multi-currency accounts with `accountId=all` | Currency included in matching key — no cross-currency false matches |
| Scheduled amount changes (override or escrow adjustment) | Old historical amount may remain in trend until it ages out of lookback window. Documented limitation. |

## Security Fix (opportunistic)

**Pre-existing issue:** `accountId` is string-interpolated into raw SQL at `spending-trends.service.ts:70`. While modifying this file, parameterize it properly using query parameter arrays instead of string interpolation and `.replace()`.

## Testing

1. Call `GET /built-in-reports/spending-trends?lookbackMonths=3&accountId=all` before and after fix
2. Verify Loan, Car Payment, Insurance categories are absent from response after fix
3. Verify Groceries, Dining Out, etc. remain with reasonable `trendFill` values
4. Verify `totalDailyFill` drops from ~$329 to ~$30-50
5. Verify cash flow chart no longer projects -$19K at 90 days
6. Verify "Scheduled" mode is unaffected
7. Test same-payee different-amount scenario (e.g., if a payee has both scheduled and discretionary charges)
8. Test with specific `accountId` to verify parameterized query works correctly

## Codex Review

**Session:** `019d8f5e-1435-70e3-9732-fb3063f82883`
**Findings:** 3 HIGH, 5 MEDIUM, 1 LOW — all incorporated above.

| # | Severity | Finding | Resolution |
|---|----------|---------|------------|
| 1 | HIGH | Payee-less fallback broken for split scheduled transactions | Narrowed fallback to unsplit+categorized only |
| 2 | HIGH | NOT EXISTS runs after split JOIN — matches per-row not parent total | Changed to parent-level anti-join before split expansion via CTE |
| 3 | MEDIUM | "Removes transactions or splits" is ambiguous | Made explicit: always parent-level exclusion |
| 4 | MEDIUM | Exclusion set doesn't filter to expenses | Added `st.amount < 0` filter |
| 5 | MEDIUM | Scale-4 precision mismatch risk | Added `ROUND(ABS(...)::numeric, 2)` |
| 6 | MEDIUM | Unbounded exclusion per payee+amount | Documented as acceptable tradeoff |
| 7 | MEDIUM | Missing currency_code in matching key | Added currency to matching triple |
| 8 | LOW | Set dedup doesn't prove correct occurrence count | Documented, acceptable with unbounded matching |
| 9 | HIGH | accountId string-interpolated into SQL (injection risk) | Added as opportunistic security fix |
