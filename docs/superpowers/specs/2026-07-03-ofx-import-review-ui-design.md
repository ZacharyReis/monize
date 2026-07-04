# OFX/QIF/CSV Import — Match-Review UI (frontend + serving backend)

- **Date:** 2026-07-03
- **Task:** T-555 — parent T-235, follows the shipped backend spine
- **Status:** Design **v3** — two Wren rounds folded (Codex 019f2b1d). Merge-safety = confirm dialog; queue gains a **Dismiss** action (both Zach). → Zach spec sign-off → `writing-plans` (mechanism items are binding plan requirements; Wren re-enters on the plan)
- **Author:** Alfred (zforge)
- **Repo/branch:** `monize` @ `t-555-import-review-ui` (off deployed `manor/baseline-v1.11.3`)
- **Related:** backend design `…/2026-07-03-ofx-import-transaction-matching-design.md`; backend plan `…/plans/2026-07-03-ofx-import-matching-backend.md`; hardening T-556.

## Scope reality (read this first)

This started as "the frontend half." Two adversarial Wren reviews grew it into a **full-stack
slice** with its **first migration**. The backend now carries: a normalized+account-hydrated
list endpoint, machine-readable conflict codes (incl. an exception-filter patch), a per-import
bulk match count, and a new **Dismiss** action (migration `092`, new `dismissed` state). The
frontend is the review UI itself. This is bigger than v1 implied — deliberately, because the
review surface is money-adjacent and the gate earned every addition.

## Changes across revisions (Wren gate)

**v2 (Wren round 1 — 7 findings):** [Crit] merge is unrecoverable → **confirm dialog on merge**
(fitid is un-editable, `fitid-not-whitelisted.spec.ts`; recovery = delete + re-import).
[High] 409 overloaded → machine-readable `code`. [High] merge returns `void` not `Transaction`.
[Med] hydration hardening. [Med] account context. [Med] bulk miscount → `matchesStaged`.
[Low] open-view refresh.

**v3 (Wren round 2 — 5/7 resolved; 3 new):**
1. [High] the `code` never reaches the FE — the **`GlobalExceptionFilter` strips custom fields**
   (`http-exception.filter.ts:38,81`). → backend change 2 **also patches the filter** to preserve
   safe fields (`code`).
2. [High] **repeat-merge misclassified** — `merge()` validates the target *before* the state
   claim (`import-match.service.ts:95` before `:108`), so a benign double-resolve returns
   `target_ineligible`, not `already_resolved`. → **check `candidate.state` first**.
3. [Med] **zero-live / unwanted-duplicate** matches had no non-inserting exit (Keep-both
   *inserts*). → **new Dismiss action** (Zach).
4. [Low] confirm-dialog **double-fire guard** (close-then-async, the delete pattern).
5. [Partial] hydration query must scope by **`userId` AND `accountId`**, not `userId` alone.

The three round-2 mechanism items (filter patch, merge check-order, confirm guard) are folded
below as **binding requirements** and verified at the **plan gate** — not another paper spec
round (mirrors T-235's R3 → binding-acceptance-criteria precedent).

## Problem

T-235's backend spine (deployed `manor/baseline-v1.11.3` @ `434a6838`) stages possible
import duplicates and exposes a resolve API — but there is **no UI to act on them**. A
hand-entered `UNRECONCILED` row and its bank `CLEARED` twin sit as a duplicate until Zach
reconciles by hand. This spec builds the review UI (post-import + persistent queue) and the
backend surface needed to serve it. It is also the **first real end-to-end live gate** for
the whole T-235 feature.

## Backend contract (verified against `manor/baseline-v1.11.3`, 2026-07-03)

### Endpoints — `ImportMatchController` (`backend/src/import/import-match.controller.ts`)

JWT-guarded, `@Controller("import/matches")` → frontend calls `/import/matches` (axios
`baseURL:'/api/v1'`).

| Method | Route | Body | Returns | Errors |
|--------|-------|------|---------|--------|
| `GET`  | `/import/matches` | — | **`PendingMatch[]`** (normalized — change 1) | — |
| `POST` | `/import/matches/:id/merge` | `{ transactionId }` | **`void`** | 409 `{code}` · 404 · 400 |
| `POST` | `/import/matches/:id/keep-both` | — | `Transaction` | 409 `{code}` · 404 · 400 |
| `POST` | `/import/matches/:id/dismiss` | — | **`void`** (change 4 — NEW) | 409 `{code}` · 404 · 400 |

`:id` = `ImportMatchCandidate.id` (bad uuid → 400 via `ParseUUIDPipe`); missing/foreign
candidate → 404. All resolve calls use an atomic state claim (`import-match.service.ts:68`).

### Shapes

Import responses already carry hydrated `proposedMatches: ProposedMatchDto[]`
(`import.dto.ts` ~312–336, attached ~398), built at match time from `ctx.stagedThisRow`:

```ts
ProposedMatchDto {
  candidateId: string;   // = ImportMatchCandidate.id (the :id for resolve calls)
  bankAmount: number; bankDate: string; bankName?: string;
  candidates: Array<{ id; transactionDate; amount; payeeName: string|null; description: string|null }>;
}
```

The persisted `ImportMatchCandidate` entity keeps only bare `candidateTransactionIds`
(`entity:39`) + `accountId` + bank snapshot; `state` today is `pending|merged|kept`
(`091_import_match_candidate.sql:21`). `listPending` scopes by `userId`, orders `createdAt DESC`
(`service:46`).

### Staging coverage (already true)

Every standard **regular/cash** single-account OFX/QIF/CSV import stages matches
(`importBatchId` set at `import.service.ts:1251`; `findMatchCandidates` no-ops without it,
`import-regular-processor.service.ts:149`). So **bulk imports' matches surface on the queue
automatically.** Two paths don't stage (out of scope): multi-account QIF and
**investment-account** imports (they branch to `ImportInvestmentProcessorService`).

## Frontend stack

Next.js 16 App Router + React 19 + TS; Tailwind 4, custom UI (`components/ui/` — `Modal.tsx`,
`ConfirmDialog.tsx`); Zustand (`store/`); plain axios (`lib/api.ts` — CSRF via `X-CSRF-Token`
cookie) + `lib/apiCache.ts` (`invalidateCache`, no React Query); next-intl (**i18n mandatory**);
react-hot-toast; Heroicons. Vitest + RTL + MSW co-located (~90% enforced); Playwright e2e in
`e2e/`. Import flow = a wizard state machine (`hooks/useImportWizard.ts`, `ImportStep` union in
`app/import/import-utils.ts`, steps in `components/import/*`); single-file `handleImport`
(~951–962) sets `importResult` → `'complete'`; bulk (~842–950) aggregates + drops
`proposedMatches`. `ImportResult` (`lib/import.ts` ~240) lacks `proposedMatches` — add it.

## Design decisions (v3)

| Decision | Choice |
|----------|--------|
| Primary review surface | **In-wizard step** (`'matchReview'`), single-file, before `'complete'` |
| Persistent surface | **Dedicated page** `/import/matches` under Tools + **nav count badge** |
| Inline scope | **Single-file only**; bulk routes to the queue automatically |
| List endpoint | **Normalized** hydrated items + account context (one FE shape) |
| Merge | **One click + confirm dialog** (money-safety) |
| Keep-both | One click, no confirm (additive; a wrong one is just a delete) |
| **Dismiss** | One click, no confirm — resolves to `dismissed`, **inserts nothing**; re-import re-stages |
| Conflict semantics | 409 carries a machine-readable **`code`**; FE treats **only** `already_resolved` as benign |
| Multi-candidate | radio-select one to merge; others stay pending |

## Backend changes (v3)

### 1. Normalize `listPending` → `PendingMatch[]` (hydrated + account context)

Return items = `ProposedMatchDto & { accountId, accountName }` instead of raw entities. Binding
requirements:
- **One batched query** scoped by **`userId` AND `accountId`**: `Transaction WHERE id IN
  (…candidateTransactionIds…) AND userId=:userId AND accountId=:candidate.accountId` — no N+1,
  no cross-user/cross-account leak.
- **Preserve `candidateTransactionIds` order**; **cast decimals to number** (`bankAmount`,
  `amount`).
- **Deleted/ineligible-reference behavior:** drop refs whose row is gone or no longer
  UNRECONCILED-eligible. A candidate with **zero live rows** is still listed (the bank row
  needs a decision) with **Merge disabled** → the user resolves it via **Keep-both or Dismiss**.
- **Cap** newest-first (personal scale; plan sets `LIMIT`, e.g. 200).
- Factor a shared **`toProposedMatchDto(candidate, transactions)` mapper** used by import-time
  and list-time so they can't drift; extend it (or wrap) to add `accountId/accountName` (join
  `accounts`, user-scoped).

### 2. Machine-readable conflict codes (+ exception-filter passthrough)

Attach a `code` to each `ConflictException` on `merge`/`keepBoth`/`dismiss`:

| Case | `code` |
|------|--------|
| lost the claim / candidate already non-pending | `already_resolved` |
| `transactionId` not in this candidate (merge) | `not_a_candidate` |
| target row no longer UNRECONCILED-eligible (merge) | `target_ineligible` |

**Binding (round-2 High #1):** the global `GlobalExceptionFilter`
(`backend/src/common/filters/http-exception.filter.ts:38,81`, installed `app.module.ts:147`)
currently emits only `{ statusCode, message, timestamp }` and **strips `code`**. Patch it to
**preserve safe custom fields** (at least `code`) from `HttpException.getResponse()`, with
tests. Without this the FE discrimination is dead on arrival.

**Binding (round-2 High #2):** in `merge`, check **`candidate.state !== "pending"` →
`already_resolved` FIRST**, before target-eligibility validation, so a benign double-resolve
isn't misreported as `target_ineligible`.

### 3. Per-import `matchesStaged` (bulk)

Bulk aggregation sums each file's `proposedMatches.length` into `matchesStaged` before
discarding the arrays, so the bulk Complete screen shows an accurate *this-import* count.

### 4. Dismiss action (NEW — migration 092)

- **Migration `092_import_match_candidate_dismissed.sql`:** extend the state CHECK to
  `('pending','merged','kept','dismissed')` (drop+re-add constraint); update the canonical
  `database/schema.sql` (`state IN` ~1156). No data backfill.
- **`ImportMatchState`** entity type += `"dismissed"`.
- **`ImportMatchService.dismiss(userId, candidateId): Promise<void>`** — `loadOwned` (404 if
  foreign) → atomic `claim(userId, candidateId, "dismissed")`; a lost claim → `already_resolved`
  409. **Inserts nothing, mutates no transaction.** (Re-importing the same OFX re-stages a new
  pending candidate, since no FITID was written anywhere — so Dismiss is reversible-by-reimport.)
- **`POST /import/matches/:id/dismiss`** controller route, JWT + `ParseUUIDPipe`.
- `dismissed` never appears in `listPending` (pending-only) → drops off the queue + badge.

## Frontend components

### Types + API (`lib/import-matches.ts`, `types/import.ts`)
`PendingMatch = ProposedMatchDto & { accountId; accountName }`. Add `proposedMatches?` +
`matchesStaged?` to the import-result types. `importMatchesApi`:
`list(): Promise<PendingMatch[]>`; `merge(id, txnId): Promise<void>` (**return ignored**);
`keepBoth(id): Promise<Transaction>`; `dismiss(id): Promise<void>`. Every mutation
`invalidateCache('transactions:')` + `invalidateCache('accounts:')`.

### `MatchReviewCard` (`components/import/`) — the shared unit
Presentational; bank row vs candidate row(s); actions **Merge / Keep both / Dismiss**.
- **Merge is `ConfirmDialog`-guarded** (reuse `components/ui/ConfirmDialog.tsx`); **binding
  (round-2 Low):** follow the delete pattern — **close the dialog first, then run the async
  merge**, and disable the trigger while resolving so it can't double-fire. **Keep-both and
  Dismiss are one-click** (no confirm).
- **Multi-candidate:** radio per row; Merge disabled until one selected. **Zero live
  candidates:** Merge disabled; only **Keep-both / Dismiss**.
- Props incl. `resolving?`, `showAccount?` (renders `accountName`).

### `MatchReviewList` (`components/import/`) — shared orchestrator
Renders cards; per-card `idle|resolving|resolved`. **Conflict handling by `code`:**
`already_resolved` → benign (mark resolved, toast, refresh); everything else → real error
(toast + list refresh so a stale card self-corrects). Empty-state slot.

### `MatchReviewStep` (wizard step)
New `ImportStep 'matchReview'` (union + `app/import/page.tsx` switch), between import and
`'complete'`. `useImportWizard` single-file: `result.proposedMatches?.length` →
`setStep('matchReview')` else `'complete'`. Wraps `MatchReviewList` (`showAccount=false`);
footer **Done** (all resolved) / **Skip remaining →** (both → `'complete'`; unresolved stay
pending). Each resolve → `pendingReviewsStore.refresh()`.

### Pending Reviews page (`app/import/matches/page.tsx`)
`ProtectedRoute → PageLayout → PageHeader`; `useEffect` → `importMatchesApi.list()` →
`MatchReviewList` (`showAccount=true`); friendly empty state; resolve refreshes list + store.

### `pendingReviewsStore` (`store/`) + nav + i18n + bulk + open-view refresh
Zustand `{ count; refresh() }` (list length), refreshed on `AppHeader` mount, post-import, and
per resolve → nav badge on `toolsLinks` (`AppHeader.tsx`, mirror `MobileNavDrawer.tsx`). New
i18n keys (`import.json` `matchReview.*`, `navigation.json` `pendingReviews`). Bulk
`CompleteStep`: `matchesStaged > 0` → "M matches from this import → Review" link.
**Open-view refresh (round-1 Low):** after a resolve, emit a `transactions-changed` signal
(window event or Zustand flag) so open transactions/accounts pages refresh; mechanism finalized
in the plan.

## Data flow

```
Single-file import → proposedMatches[] → 'matchReview' (else 'complete')
  → MatchReviewList → MatchReviewCard
      Merge     → ConfirmDialog(close→async) → POST …/merge {transactionId}  (void)
      Keep both →                              POST …/keep-both              (Transaction)
      Dismiss   →                              POST …/dismiss                (void)
      success → invalidateCache(txns,accounts) + emit transactions-changed + store.refresh()
      409 → by code: already_resolved=benign; else=error+refresh
  → Done / Skip remaining → 'complete'
Pending Reviews page → GET /import/matches → PendingMatch[] → MatchReviewList(showAccount)
Nav badge ← store.count ; Bulk Complete ← result.matchesStaged
```

## Error handling
409 discriminated by `code` (only `already_resolved` benign); 404/network/5xx → toast +
refresh; merge cancel = no-op, guarded against double-fire; multi-candidate gates Merge;
zero-live → Keep-both/Dismiss only; no matches → skip step; empty queue → friendly state.
Axios already handles 401/CSRF.

## Testing strategy

**Backend (Vitest):** `listPending` hydration — ordered candidates, decimals cast, **scoped by
userId AND accountId** (no cross leak), `accountName` present, deleted-ref dropped, zero-live
still listed; conflict `code`s per case; **`merge` returns `already_resolved` before target
validation** when candidate non-pending; **exception-filter preserves `code`**; `dismiss`
transitions `pending→dismissed`, **inserts nothing**, drops from `listPending`,
double-dismiss → `already_resolved`.
**Frontend unit (RTL+MSW, ~90%):** `MatchReviewCard` — Merge opens ConfirmDialog and fires
**once** (close-then-async, no double-fire); Keep-both/Dismiss one-click; multi-candidate radio
gates Merge; zero-live → Keep-both/Dismiss only; `showAccount`. `MatchReviewList` —
`already_resolved` benign vs `target_ineligible` error; empty. `MatchReviewStep` +
`useImportWizard` branching. Page fetch/empty/refresh. `pendingReviewsStore` +
`importMatchesApi` (merge ignores response; cache invalidation asserted; `dismiss`). Bulk
`CompleteStep` `matchesStaged`.
**E2E (Playwright, `e2e/tests/import.spec.ts`) — the live gate:** seed an UNRECONCILED row,
import a matching OFX, assert the review step, **Merge → confirm** → row CLEARED + FITID + kept
payee/category + **no duplicate**. Specs: **Keep both** inserts a new CLEARED row (no confirm);
**Dismiss** removes the card, inserts nothing, badge drops; resolve from the **Pending Reviews
page** (account label) drops the badge.

## Scope & non-goals
- **In:** backend list normalize (+account ctx, hardening, userId+accountId scope), conflict
  `code`s + **exception-filter patch** + **merge terminal-state ordering**, bulk `matchesStaged`,
  **Dismiss action (migration 092)**; frontend types + `importMatchesApi`; shared
  `MatchReviewCard` (confirm-gated, double-fire-safe merge) + `MatchReviewList` (code-based) +
  `MatchReviewStep`; `/import/matches` page + badge + store; open-view refresh; i18n; Vitest +
  Playwright (live gate).
- **Out (deferred):** a true **unmerge/recovery** path (reverse a merge — detach fitid,
  re-stage) → pairs with **T-556 #1** action-history; inline review for **bulk**;
  multi-account QIF + investment-account matching; legacy FITID backfill; Boswell (Phase 3).

## Known limitation / accepted risk
**No true undo on a merge.** `fitid` is deliberately un-settable via public create/update DTOs
(`fitid-not-whitelisted.spec.ts`), so a wrong merge is recovered only by deleting the row +
re-importing. **Mitigation:** the mandatory confirm dialog. A first-class **unmerge** is
deferred with T-556 #1. (Keep-both and Dismiss are safe: delete the inserted row / re-import
respectively.)

## Open questions / plan-phase verifications
1. `toProposedMatchDto` factoring, `accountName` join, and the list `LIMIT` value.
2. Exception-filter patch: exact allow-list of preserved fields; confirm the axios interceptor
   surfaces `err.response.data.code`.
3. `matchesStaged` plumbing through `useImportWizard.ts` (~842–950).
4. Open-view refresh mechanism (window event vs Zustand vs refetch-on-focus).
5. Migration 092 SQL (drop+re-add CHECK) + `schema.sql` sync; apply via `scripts/rebuild.sh
   --migrate-only`.
6. `ImportStep` switch + progress-indicator label; clean SSR hydration of the badge.

---
-- Claude Code 2026-07-03 (v3)
