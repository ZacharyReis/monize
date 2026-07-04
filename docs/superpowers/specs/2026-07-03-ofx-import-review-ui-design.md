# OFX/QIF/CSV Import — Match-Review UI (frontend)

- **Date:** 2026-07-03
- **Task:** T-555 (frontend) — parent T-235, follows the shipped backend spine
- **Status:** Design **v2** — Wren spec-review folded (2026-07-03). Merge-safety = confirm dialog (Zach). → Wren re-gate → `writing-plans`
- **Author:** Alfred (zforge)
- **Repo/branch:** `monize` @ `t-555-import-review-ui` (off deployed `manor/baseline-v1.11.3`)
- **Related:**
  - Backend design: `docs/superpowers/specs/2026-07-03-ofx-import-transaction-matching-design.md`
  - Backend plan: `docs/superpowers/plans/2026-07-03-ofx-import-matching-backend.md`
  - Backend hardening follow-ups: T-556 (non-blocking)

## Changes in v2 (Wren spec-review, Codex session 019f2b1d)

A read-only, code-grounded Wren review returned **NO-GO** on v1 and caught seven issues,
all verified by Alfred against source. v2 folds every one:

1. **[Critical] Merge is not undoable by normal editing.** `fitid` is *deliberately* rejected
   on the public create/update DTOs (proven by `backend/src/transactions/dto/fitid-not-whitelisted.spec.ts`),
   so a wrong merge can only be recovered by deleting the row and re-importing. v1's "corrected
   by normal editing" was false. **Fix:** a mandatory **confirm dialog on Merge** (Zach's call);
   accurate recovery documented; a full unmerge path deferred to a follow-up.
2. **[High] 409 is overloaded.** `merge()` throws `ConflictException` for *"not a candidate"*,
   *"no longer eligible"*, **and** *"already resolved"*. **Fix:** backend attaches a
   machine-readable `code`; the frontend treats **only** `already_resolved` as benign.
3. **[High] Merge return contract.** `merge()` is `Promise<void>`, not `Promise<Transaction>`
   (`keepBoth()` *does* return the row). **Fix:** frontend types merge as `void`.
4. **[Med] Hydration hardening** — batched, user+account-scoped query; preserve candidate order;
   cast decimals; define deleted-reference behavior; cap the list.
5. **[Med] Account context** — the global Pending Reviews page needs the account name per match.
6. **[Med] Bulk count** — a global pending count includes *stale* reviews; use a per-import
   `matchesStaged` count instead.
7. **[Low] Cache invalidation** doesn't re-render an already-open transactions page — emit a
   change event / refresh on return.

## Problem

The T-235 backend spine shipped and deployed 2026-07-03 (`manor/baseline-v1.11.3` @
`434a6838`): imports now stage possible duplicates instead of blindly inserting them, and a
resolve API is live. But there is **no user-facing way to act on those matches yet** — the
buttons don't exist. A hand-entered `UNRECONCILED` row and its bank `CLEARED` twin still sit
side by side until Zach reconciles by hand. This spec is the deferred frontend half plus the
small backend surface needed to serve it cleanly: the review UI that lets him confirm a
**Merge** or **Keep both** for each staged match, both right after an import and later from a
persistent queue.

This is also where the **real user-facing live gate** for the whole T-235 feature finally
runs — the backend increment could only be verified by integration tests and deploy checks
because nothing could drive the resolve flow end-to-end.

## What exists to consume (backend, live on monize)

Verified against `manor/baseline-v1.11.3`, 2026-07-03.

### Endpoints — `ImportMatchController` (`backend/src/import/import-match.controller.ts`)

JWT-guarded, mounted at `@Controller("import/matches")` (so, with the axios `baseURL:
'/api/v1'`, the frontend calls `/import/matches`):

| Method | Route | Body | Returns | Errors |
|--------|-------|------|---------|--------|
| `GET`  | `/import/matches` | — | **list items** (normalized — see § Backend) | — |
| `POST` | `/import/matches/:id/merge` | `{ transactionId }` | **`void`** (no body) | 409 `{code}`, 404, 400 |
| `POST` | `/import/matches/:id/keep-both` | — | inserted `Transaction` | 409 `{code}`, 404, 400 |

`:id` is the `ImportMatchCandidate.id` (uuid — bad uuid → **400** via `ParseUUIDPipe`).
`transactionId` is the id of the chosen UNRECONCILED candidate row. A missing/foreign
candidate → **404**. Both resolve calls use an **atomic state claim**
(`import-match.service.ts:68`); a lost claim, an ineligible target, or a non-candidate
`transactionId` all currently surface as **409** — v2 disambiguates them with a `code`
(§ Backend, change 2).

### The hydrated shape — `ProposedMatchDto`

`backend/src/import/dto/import.dto.ts` (~312–336), attached to `ImportResultDto.proposedMatches`
(~398). Every standard **regular/cash** single-account import (`importParsedTransactions` —
`import.service.ts` lines 119/889/973, OFX/QIF/CSV) emits this, hydrated at match time from
the processor's `ctx.stagedThisRow` (`import.service.ts:1318`):

```ts
ProposedMatchDto {
  candidateId: string;            // = ImportMatchCandidate.id (the :id for resolve calls)
  bankAmount: number;
  bankDate: string;               // YYYY-MM-DD
  bankName?: string;              // ugly bank NAME, e.g. "VISA DDA PUR AP 469216 GOOG"
  candidates: Array<{             // the matching UNRECONCILED row(s), hydrated
    id: string;
    transactionDate: string;
    amount: number;
    payeeName: string | null;
    description: string | null;
  }>;
}
```

### The persisted shape — `ImportMatchCandidate` entity

`backend/src/import/entities/import-match-candidate.entity.ts`. What `GET /import/matches`
returns **today** (raw, un-hydrated):

```
id, userId, accountId, importBatchId,
bankAmount, bankDate, fitid, bankName, bankMemo, bankReference,
candidateTransactionIds: string[]   // jsonb — bare IDs, NOT hydrated
state: "pending" | "merged" | "kept",
createdAt, updatedAt
```

`listPending` already scopes by `userId` and orders `createdAt DESC`
(`import-match.service.ts:46`). The gap is hydration + account context — resolved in § Backend.

### Staging coverage (already true, no work needed)

`findMatchCandidates` returns `[]` unless `ctx.importBatchId` is set
(`import-regular-processor.service.ts:149`); it is set for every standard import
(`import.service.ts:1251`). So matches for every **regular/cash** single-account
OFX/QIF/CSV import are staged in the DB regardless of what the frontend does with the
response — **bulk imports' matches surface on the Pending Reviews page automatically.**
Two paths do **not** stage (both out of scope): multi-account QIF
(`importQifMultiAccountFile`, deliberately disabled) and **investment-account** imports
(they branch to `ImportInvestmentProcessorService`, which stages no matches).

## Frontend stack (what we design against)

Next.js 16 (App Router) + React 19 + TypeScript 5.9; Tailwind CSS 4 with **custom** UI
components (`components/ui/` — incl. `Modal.tsx` + `ConfirmDialog.tsx`, no MUI/Chakra);
**Zustand** stores (`store/`); **plain axios** (`lib/api.ts` — `apiClient`, `baseURL:
'/api/v1'`, `withCredentials`, CSRF via `X-CSRF-Token` cookie) with a small custom cache
(`lib/apiCache.ts` — `cachedRequest` / `invalidateCache`, **no React Query**); `next-intl`
(**i18n mandatory**); `react-hot-toast`; Heroicons. Tests: **Vitest + RTL + jsdom + MSW**
co-located `*.test.tsx` (**~90% coverage enforced**); **Playwright** e2e in `e2e/`.

**Import flow:** a wizard state machine — `hooks/useImportWizard.ts`, step union `ImportStep`
in `app/import/import-utils.ts`, step components in `components/import/*`. The **single-file**
path (`handleImport`, ~951–962) sets `importResult` and jumps to `'complete'` →
`CompleteStep.tsx`. The **bulk** path (~842–950) aggregates per file and **discards
`proposedMatches`** (v2 preserves only a *count*, § Components).

**Two gotchas to fix first:** (a) the frontend `ImportResult` interface (`lib/import.ts`
~240–261) lacks `proposedMatches`; (b) the bulk path drops match data.

## Design decisions (v2)

| Decision | Choice |
|----------|--------|
| Primary review surface | **In-wizard step** (`'matchReview'`), single-file, before `'complete'` |
| Persistent surface | **Dedicated page** `/import/matches` under Tools + **nav count badge** |
| Inline scope | **Single-file only**; bulk imports route to the queue automatically |
| List endpoint | **Normalize `listPending`** → hydrated items with **account context** (one FE shape) |
| Merge interaction | **One click + a confirm dialog** (money-safety; not applied to keep-both) |
| Keep-both interaction | One click, no confirm (additive; a wrong one is just a delete) |
| Conflict semantics | 409 carries a machine-readable **`code`**; FE treats **only** `already_resolved` as benign |
| Multi-candidate | Show all; **radio-select one** to merge; others stay pending |
| Route | `/import/matches` (mirrors the API) |

## Backend changes (read-only + additive; no migration)

Three edits, all riding the same Wren gate as the frontend.

### 1. Normalize `listPending` → hydrated list items (with account context)

Return an array of items shaped like `ProposedMatchDto` **plus** `accountId` + `accountName`,
instead of raw `ImportMatchCandidate[]`. Hard requirements (Wren Med #4/#5):

- **One batched query** for the referenced rows: `Transaction WHERE id IN
  (…candidateTransactionIds…) AND userId = :userId` — never a per-candidate N+1, and
  re-scoped by `userId` so hydration can't leak another user's row.
- **Preserve `candidateTransactionIds` order** when building `candidates`.
- **Cast decimals to number** (`bankAmount`, candidate `amount`) — TypeORM `decimal` returns
  strings.
- **Deleted-reference behavior:** drop any `candidateTransactionIds` whose row no longer
  exists (or is no longer UNRECONCILED/eligible). If a candidate ends up with **zero** live
  rows, it is **merge-ineligible** → the UI shows it **Keep-both-only** (Merge disabled). It
  is never silently dropped (the bank row still needs a decision).
- **Cap the list** newest-first (personal scale): return at most a documented `LIMIT`
  (plan sets the value, e.g. 200) so the page/badge can't be unbounded. Pagination is a
  plan-phase call if the cap proves tight.
- Factor a shared **`toProposedMatchDto(candidate, transactions)` mapper** used by both the
  import path and the list path so the two can't drift.
- Add `accountId` + `accountName` per item (join `accounts`, user-scoped).

### 2. Machine-readable conflict codes on `merge` / `keepBoth`

The `ConflictException`s currently differ only by message. Attach a `code` to each so the
frontend can discriminate:

| Case | `code` | HTTP |
|------|--------|------|
| lost the atomic claim (already merged/kept) | `already_resolved` | 409 |
| `transactionId` not in this candidate | `not_a_candidate` | 409 |
| target row no longer UNRECONCILED/eligible | `target_ineligible` | 409 |

(`loadOwned` 404 and the `ParseUUIDPipe` 400 are unchanged.) The frontend treats **only**
`already_resolved` as benign.

### 3. Per-import `matchesStaged` count (bulk)

The bulk aggregation path drops each file's `proposedMatches`; have it also **sum their
lengths** into a `matchesStaged` field on the bulk result, so the bulk Complete screen shows
an accurate *this-import* count (not a global pending total that includes stale reviews).
Cheap — sum before discarding the arrays.

## Architecture — frontend components

Each unit has one job, a defined interface, and its own co-located tests.

### 1. Types + API module

- **Types** (`lib/import.ts` or `types/import.ts`): mirror `ProposedMatchDto` + nested
  candidate; a `PendingMatch = ProposedMatchDto & { accountId; accountName }` for list items;
  add `proposedMatches?: ProposedMatchDto[]` and `matchesStaged?: number` to the relevant
  `ImportResult` / bulk-result interfaces.
- **`importMatchesApi`** (`lib/import-matches.ts`, mirroring the `lib/*.ts` idiom):
  - `list(): Promise<PendingMatch[]>` → `apiClient.get('/import/matches')`
  - `merge(candidateId, transactionId): Promise<void>` →
    `apiClient.post('/import/matches/${id}/merge', { transactionId })` — **return ignored**
  - `keepBoth(candidateId): Promise<Transaction>` →
    `apiClient.post('/import/matches/${id}/keep-both')`
  - Each mutation calls `invalidateCache('transactions:')` **and** `invalidateCache('accounts:')`.

### 2. `MatchReviewCard` (`components/import/MatchReviewCard.tsx`) — the shared unit

Renders **one** match: bank row vs candidate UNRECONCILED row(s), with **Merge** / **Keep
both**. Presentational — no fetching. Consumed by both surfaces so they look identical.

- **Props:** `match: PendingMatch`, `onMerge(candidateId, transactionId)`,
  `onKeepBoth(candidateId)`, `resolving?: boolean`, `showAccount?: boolean`.
- **Merge is guarded by a `ConfirmDialog`** (reuse `components/ui/ConfirmDialog.tsx`): clicking
  Merge opens a confirm ("Clear your ‹payee amount› row and attach the bank record? Undoing
  means deleting + re-importing.") — only on confirm does `onMerge` fire. **Keep-both is
  direct** (no confirm).
- **Multi-candidate** (`candidates.length > 1`): radio per row; **Merge disabled until one is
  selected**; merges the selected row. **Zero live candidates** (hydration dropped them all):
  Merge disabled entirely, only Keep-both offered.
- `showAccount` renders the `accountName` label (on for the page, off in the single-account
  wizard step).

### 3. `MatchReviewList` (`components/import/MatchReviewList.tsx`) — shared orchestrator

Takes matches + async resolve handlers, renders `MatchReviewCard`s, owns per-card lifecycle:

- Tracks per-card `idle | resolving | resolved`; greys/removes a card on success.
- **Conflict handling by code** (not by HTTP status): inspect `err.response?.data?.code`.
  `already_resolved` → benign (mark resolved, toast `matchReview.alreadyResolved`, refresh).
  `not_a_candidate` / `target_ineligible` / 404 / anything else → real error (toast, refresh
  the list so the stale card corrects itself, keep the surface actionable).
- **Empty state** slot so the page says "all caught up" and the wizard step can auto-advance.

### 4. `MatchReviewStep` (`components/import/MatchReviewStep.tsx`) — wizard step

- New `ImportStep` `'matchReview'` (added to `import-utils.ts` union + `app/import/page.tsx`
  switch), between import and `'complete'`.
- `useImportWizard.ts` single-file `handleImport`: `result.proposedMatches?.length` →
  `setStep('matchReview')`, else `'complete'`. Store `proposedMatches` for the step.
- Wraps `MatchReviewList` (`showAccount=false`). Footer: **"Done"** when all resolved, else
  **"Skip remaining →"**; both advance to `'complete'` (unresolved stay pending in the DB,
  reappear on the page). On each resolve, `pendingReviewsStore.refresh()`.

### 5. Pending Reviews page (`app/import/matches/page.tsx`)

- Standard shell: `ProtectedRoute → PageLayout → PageHeader`.
- `useEffect` → `importMatchesApi.list()` into `useState`. Renders `MatchReviewList`
  (`showAccount=true`). Friendly empty state. On resolve, refresh the local list + the store.

### 6. `pendingReviewsStore` (`store/pendingReviewsStore.ts`) — badge count

Zustand `{ count; refresh() }`. `refresh()` = `importMatchesApi.list().length`. Called on
`AppHeader` mount, after a single-file import completes, and after every resolve.

### 7. Nav + i18n + bulk CompleteStep + open-view refresh

- **Nav** (`AppHeader.tsx` `toolsLinks`, mirrored in `MobileNavDrawer.tsx`): add
  `{ href: '/import/matches', labelKey: 'pendingReviews', badge: count || undefined }`.
- **i18n**: new `import.json` (`matchReview.*`) + `navigation.json` (`pendingReviews`) keys.
- **Bulk `CompleteStep.tsx`**: if `matchesStaged > 0`, show "M possible matches from this
  import → Review" linking to `/import/matches` (uses the per-import count, not a global one).
- **Open-view refresh (Wren Low #7):** after a resolve, besides cache invalidation, emit a
  lightweight `transactions-changed` signal (custom window event or a small Zustand flag); the
  transactions + accounts pages subscribe (or refresh on focus/route-return) so an already-open
  register reflects the merge. Mechanism finalized in the plan.

## Data flow

```
Single-file import
  POST /import/{ofx,csv,qif} → ImportResultDto.proposedMatches[] (hydrated)
    → useImportWizard: proposedMatches.length ? 'matchReview' : 'complete'
    → MatchReviewStep → MatchReviewList → MatchReviewCard
        Merge  → ConfirmDialog → POST /import/matches/:id/merge {transactionId}   (returns void)
        Keep both →              POST /import/matches/:id/keep-both               (returns Transaction)
        success → invalidateCache(transactions:, accounts:), emit transactions-changed,
                  pendingReviewsStore.refresh()
        409 → discriminate by code: already_resolved = benign; else = error + refresh
    → "Done" / "Skip remaining" → 'complete'  (unresolved stay in the queue)

Pending Reviews page
  GET /import/matches → PendingMatch[] (hydrated + accountName) → MatchReviewList (showAccount)

Nav badge  ← pendingReviewsStore.count (mount + after import + after each resolve)
Bulk Complete  ← result.matchesStaged (per-import) → link to /import/matches
```

## Error handling

- **409 by `code`:** only `already_resolved` is benign; `not_a_candidate` /
  `target_ineligible` are surfaced (with a list refresh so the stale card self-corrects).
- **404 / network / 5xx:** toast, card stays actionable, refresh where useful.
- **Merge confirm:** cancel = no-op; only confirm commits.
- **Multi-candidate:** Merge disabled until a row is selected. **Zero live candidates:**
  Keep-both only.
- **No matches** in an import → skip `'matchReview'`. **Empty queue** → friendly empty state.
- Axios interceptor already handles 401 refresh + CSRF — no new work.

## Testing strategy

**Backend (Vitest, `backend/`):** `listPending` normalization — hydrates
`candidateTransactionIds` into ordered `candidates`, casts decimals, **scopes the transaction
fetch by `userId`** (no cross-user leak), includes `accountName`, and handles the
deleted-reference edge (drops dead ids; zero-live → still listed, merge-ineligible). Conflict
`code`s — `merge`/`keepBoth` throw `ConflictException` carrying the right `code` for each of
the three cases. Reuse the `import-match.service` test harness (it already asserts the atomic
claim + 409 on double-resolve).

**Frontend unit (Vitest + RTL + MSW, co-located, ~90%):**
- `MatchReviewCard`: renders bank vs candidate; **Merge opens ConfirmDialog and only fires
  onMerge on confirm**; Keep-both fires directly; multi-candidate radio gates Merge; zero-live
  → Keep-both-only; `showAccount` renders the label; `resolving` disables buttons.
- `MatchReviewList`: success removes a card; **`already_resolved` code → benign**;
  `target_ineligible` → error + refresh; empty state.
- `MatchReviewStep` + `useImportWizard`: matches → `'matchReview'`; none → `'complete'`;
  Done/Skip → `'complete'`.
- Pending Reviews page: fetch + render + account label; empty; resolve refreshes list + store.
- `pendingReviewsStore` + `importMatchesApi` (mocked `apiClient`; merge ignores the response;
  cache invalidation asserted).
- Bulk `CompleteStep`: `matchesStaged` count drives the pointer.

**E2E (Playwright, `e2e/tests/import.spec.ts`) — the real live gate:** seed an account + a
hand-entered **UNRECONCILED** transaction (`e2e/helpers/factories.ts`), import an OFX whose
bank row matches (amount + date within 7 days), assert the **Review matches** step appears,
click **Merge → confirm**, assert: the row is **CLEARED**, carries the **FITID**, keeps the
**user's payee/category**, and **no duplicate** exists. Second spec: **Keep both** inserts a
new CLEARED row (no confirm). Third: resolve from the **Pending Reviews page** (with account
label) and the **badge count drops**.

## Scope & non-goals

- **In:** backend `listPending` normalize (+ account context, hardening), conflict `code`s,
  bulk `matchesStaged`; frontend types + `importMatchesApi`; shared `MatchReviewCard`
  (confirm-gated merge) + `MatchReviewList` (code-based conflict handling); single-file
  `MatchReviewStep`; `/import/matches` page + nav badge + `pendingReviewsStore`; open-view
  refresh signal; i18n; Vitest unit + Playwright e2e (the live gate).
- **Out (deferred):** a true **unmerge / recovery path** (reverse a merge — detach fitid,
  re-stage) — pairs with **T-556 #1** (action-history on import-apply); inline review for
  **bulk**; **multi-account QIF** + **investment-account** matching (backend-unstaged);
  legacy FITID backfill; Boswell fuzzy ranking (T-235 Phase 3).

## Known limitation / accepted risk

**No true undo on a merge.** `fitid` is deliberately un-settable via the public
create/update DTOs (enforced by `backend/src/transactions/dto/fitid-not-whitelisted.spec.ts`,
an anti-spoof guard), so a wrong merge is recovered **only** by deleting the merged row and
re-importing the OFX — clunky, and it loses the manual row's id/history. **Mitigation:** the
mandatory **confirm dialog on Merge** (Keep-both is additive and needs none). A first-class
**unmerge** path is the real fix and is deferred to a follow-up alongside T-556 #1
(action-history), so import-apply becomes properly reversible.

## Open questions / plan-phase verifications

All UX/contract forks resolved above. To settle during `writing-plans`:

1. `toProposedMatchDto` mapper factoring + the exact `LIMIT` for the list (and whether
   pagination is needed at personal scale).
2. Conflict-`code` transport: NestJS `ConflictException` response body shape the interceptor
   passes through to `err.response.data.code` (confirm the axios interceptor doesn't strip it).
3. `matchesStaged` plumbing through the bulk aggregation (`useImportWizard.ts` ~842–950).
4. Open-view refresh mechanism (custom window event vs. Zustand flag vs. refetch-on-focus).
5. `ImportStep` switch + progress-indicator label for the new step; clean SSR hydration of the
   `AppHeader` badge subscription.

---
-- Claude Code 2026-07-03 (v2)
