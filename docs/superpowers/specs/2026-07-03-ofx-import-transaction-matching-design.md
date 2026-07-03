# OFX/QIF/CSV Import — Transaction Matching (MS Money-style review queue)

- **Date:** 2026-07-03
- **Task:** T-235
- **Status:** Spec approved (Zach, 2026-07-03), incl. Accept + backfill for the legacy backlog → `writing-plans`
- **Author:** Alfred (zforge)
- **Repo/branch:** `monize` @ `manor/baseline-v1.11.3` (vendored fork)
- **Related:** T-550 (projection one-time exclusion — separate feature, shares the "transaction metadata" root)

## Problem

When Zach downloads OFX from his bank and imports into Monize, a transaction he had
already entered manually as `UNRECONCILED` ("pending") is **not** matched against the
bank's incoming `CLEARED` copy. The import inserts the bank version as a new row,
leaving the hand-entered row beside it as a duplicate. Zach reconciles/deletes by hand
after every import.

Confirmed scope (Zach, 2026-07-03): the pain is **hand-entered `UNRECONCILED` vs
bank `CLEARED`** — *not* bank-side pending→posted duplicates (his bank does not send
its own pending rows).

## Current code state (verified against v1.11.3, 2026-07-03)

All three claims from the original T-235 tracker (written against v1.9.2) still hold;
only line numbers drifted.

- `backend/src/import/import-regular-processor.service.ts` — `processTransaction()`
  (line ~19) does only two pre-insert match checks: `isDuplicateTransfer` (cross-account
  transfer dupes) and `matchPendingTransfer` (cross-currency transfer awaiting its other
  leg). Everything else is a straight insert at the single site (lines ~66–83). It is the
  **shared** path for OFX/QIF/CSV (`qifTx` param), so matching covers all three formats.
- Import status mapping (lines ~56–62): `void → RECONCILED → cleared → UNRECONCILED`.
  Bank OFX cleared rows therefore land as `CLEARED`.
- `backend/src/transactions/entities/transaction.entity.ts` — `TransactionStatus` enum
  is exactly `{ UNRECONCILED, CLEARED, RECONCILED, VOID }`. **No `PENDING`, no `fitid`
  field.** `reference_number` / `referenceNumber` exists (line ~105).
- `backend/src/import/ofx-parser.ts` — FITID is named in the docstring (line ~16) but
  **never extracted** into the parsed row.

## Real-data evidence (`~/Downloads/transactions.ofx`, today's download)

Three rows, bank `CommerceBank` (FID 1002), imported into the Monize account **"TD
Checking"** (nickname ≠ OFX `BANKACCTFROM`).

| Amount | FITID | Monize row (current) | Status |
|--------|-------|----------------------|--------|
| −11.04 GOOGLE CLOUD | `20260702` `0000000` **1104** `1` | `19b44e4d` payee "Google" / Manor | CLEARED |
| −59.03 DOORDASH | `20260702` `0000000` **5903** `2` | `b01a4d85` payee "DoorDash" / Dining Out | CLEARED |
| +1948.45 PAYROLL | `20260702` `00000` **194845** `3` | `f0b3c9c8` payee "STERLING NORTH A PAYROLL" | CLEARED |

**FITID = `DTPOSTED(YYYYMMDD)` + zero-padded amount-in-cents + sequence digit.** Three
consequences baked into this design:

1. **Re-import dedup is reliable** — re-downloading the same range yields identical
   FITIDs, so exact-match skip works.
2. **Payee-gating would be fatal** — the bank `NAME` is `"VISA DDA PUR AP 469216 GOOG"`;
   the reconciled row says "Google". Match on amount + date, never payee.
3. **`DTPOSTED` is date-only** (`040000.000` = midnight EDT) — window matching on
   `transaction_date` is exactly right; no intraday precision exists.

Note: all three evidence rows are **already `CLEARED`** — Zach had already reconciled
them. So this download demonstrates the **re-import hazard** (importing it again makes 3
duplicates, since none carry a stored FITID) and validates the *target* merged shape; it
is not a live unreconciled pair. (The OFX was **not** re-imported — doing so would
manufacture the very duplicates this feature prevents, on real financial data.)

## Design decisions (all approved 2026-07-03)

| Decision | Choice |
|----------|--------|
| Duplicate class | (a) hand-entered `UNRECONCILED` vs bank `CLEARED` |
| Build scope | `fitid` column + parser + import-time match + post-import review queue |
| Boswell (AI fuzzy ranking) | **Deferred** (Phase 3) until the plain heuristic proves ambiguous in practice |
| Match gates | exact **signed amount** + **same target account** + `|date| ≤ 7 days`; **not** payee |
| Match window | **±7 days** (generous — a false match is a cheap reject; a missed match is the status quo pain) |
| Merge action | keep the user's row; **never overwrite payee/category** |
| Review UX | **post-import review step**, with a persistent fallback queue for anything unresolved |
| Auto-merge? | No — human-confirmed only (MS Money pattern) |

## Architecture

### 1. Data model

Add nullable `fitid` to `transactions`:

```
fitid VARCHAR(64) NULL
```

Partial index for fast dedup lookups:

```
(user_id, account_id, fitid) WHERE fitid IS NOT NULL
```

Extend `ofx-parser.ts` to extract `<FITID>` into the parsed transaction row. (QIF/CSV
rows have no FITID — that is expected and handled by the heuristic path.)

> **Plan-phase item:** this fork's migration mechanism is non-standard (playbook noted
> `db-migrate.js`, not TypeORM `migration:generate`). The plan must confirm the exact
> migration path so the `fitid` column survives future upstream merges cleanly.

### 2. Match pipeline

Inserted in `processTransaction()` **after** the two existing transfer checks and
**before** the insert. Ordered:

1. **FITID exact-dedup (re-import guard).** If the incoming row has a FITID and a
   transaction in the target account already carries it → **skip** (increment `skipped`).
   Stops re-downloads from duplicating.
2. **Heuristic candidate search.** In the **target account** (`ctx.accountId` — never
   `BANKACCTFROM`), find candidate rows where:
   - `status = UNRECONCILED`
   - `is_split = false`, not VOID
   - `amount` equals the incoming signed amount **exactly**
   - `|transaction_date − DTPOSTED| ≤ 7 days`

   One or more hits → **do not insert**; record a proposed match (see §3).
3. **No candidate** → insert as new `CLEARED` (current behavior, unchanged).

### 3. Staging store — `import_match_candidate`

Proposed matches must survive dismissal of the post-import dialog, so they live in a
lightweight store rather than transient dialog state:

- `import_batch_id`
- `account_id`
- bank-row snapshot (amount, date, FITID, name, memo, reference)
- `candidate_transaction_ids` (the matching UNRECONCILED row(s))
- `state`: `pending | merged | kept`
- `created_at`

Keeps the register clean (the bank row is not inserted until the user resolves the
match) and nothing is lost if the post-import screen is closed.

### 4. Review UX — post-import step

After an import completes: *"N imported, M possible matches."* Each proposed match shows
the user's row and the bank row side-by-side with two actions:

- **Merge** — accept the match (see §5).
- **Keep both** — reject (see §6).

Multiple candidates for one bank row → surface all; the user picks one to merge, or
keep-both. Unresolved matches remain in a persistent queue reachable later.

### 5. Merge (accept)

On confirm, for the chosen `UNRECONCILED` row:

| Field | Action |
|-------|--------|
| `status` | → `CLEARED` |
| `fitid` | ← bank row's FITID |
| `referenceNumber` | ← bank row's reference (if present) |
| `description` | ← bank memo **only if the user's is empty** |
| `payeeName` / `payeeId` | **unchanged** — keep the user's clean payee |
| `categoryId` | **unchanged** — keep the user's category |

Then discard the staged bank snapshot; mark candidate `merged`. Because the surviving
row now carries the FITID, future imports of the same OFX skip it at step 1.

### 6. Keep both (reject)

Insert the bank row as a new `CLEARED` transaction **with its FITID**. Mark candidate
`kept`. The stored FITID means it will never re-prompt on a later import.

## Scope & non-goals

- **In:** OFX/QIF/CSV (shared `processTransaction`), FITID re-import dedup, amount+date
  heuristic → post-import review, human-confirmed merge / keep-both, persistent fallback.
- **Out (deferred):** Boswell (rtxzr) fuzzy disambiguation for ambiguous candidate sets —
  only build if the plain heuristic produces too many multi-candidate cases in practice.
- **Out (separate task):** cash-flow projection one-time exclusion — **T-550**.

## Known limitations & decision points

**Legacy FITID-less `CLEARED` rows are not re-import-protected.** The heuristic (§2 step 2)
deliberately anchors on `UNRECONCILED` rows only — that is the hand-entered-vs-bank pain.
Rows that were already reconciled to `CLEARED` *before* this feature shipped carry no
`fitid` (e.g. today's three evidence rows). Re-importing an OFX covering them would fall
through both guards and insert duplicates:

- Step 1 (FITID dedup) — no stored FITID on the existing row → no skip.
- Step 2 (heuristic) — existing row is `CLEARED`, not a candidate → no match.
- Step 3 — inserted as new `CLEARED` → **duplicate**.

The guard becomes airtight only for rows created/merged *after* the feature (they carry a
FITID). Options for the legacy backlog:

- **(chosen default) Accept + backfill:** ship UNRECONCILED-only, and provide a one-time
  backfill that stamps computed FITIDs onto historical bank rows (or lean on the existing
  `/built-in-reports/duplicate-transactions` cleanup report). Matches the original
  tracker's "eliminates re-import duplicates forever *once backlog is clean*."
- **(alternative) Widen the heuristic** to also propose matches against FITID-less
  `CLEARED` rows on exact amount + date + account. Catches the legacy re-import case at the
  cost of more review-queue noise (already-done rows resurfacing). Still human-confirmed,
  so false positives are cheap rejects.

**Decided (Zach, 2026-07-03): Accept + backfill.** Ship the UNRECONCILED-only matcher; a
one-time FITID backfill (and/or the existing duplicate-transactions report) handles the
historical backlog. The wider-heuristic alternative is not pursued.

## Testing strategy

Unit tests around the match predicate and merge, TDD-first:

- **Match predicate:** exact-amount required (−11.05 must not match −11.04); ±7-day
  boundary (day 7 matches, day 8 does not); `UNRECONCILED`-only (a `CLEARED`/`VOID` row
  is not a candidate); split rows excluded; target-account scoping (a same-amount row in
  another account is not a candidate).
- **FITID dedup:** second import of the same FITID skips; row without FITID falls through
  to the heuristic.
- **Merge field-copy:** asserts `status→CLEARED`, `fitid`/`reference` copied, description
  backfilled only when empty, and **payee/category NOT overwritten**.
- **Keep-both:** bank row inserted as `CLEARED` and stamped with FITID (no re-prompt on
  re-run).
- **Fixture:** today's real `transactions.ofx` (the 3 CommerceBank rows) — exercises FITID
  parsing (date+cents+seq) and amount+date matching end-to-end.

## Open questions

None material — all design forks resolved above. Plan-phase verifications:
1. Fork migration mechanism for the `fitid` column (upstream-merge-safe).
2. Persistent-queue surface location in the frontend (component + route).
3. Confirm the import result payload shape can carry the proposed-match list to the UI.

---
-- Claude Code 2026-07-03
