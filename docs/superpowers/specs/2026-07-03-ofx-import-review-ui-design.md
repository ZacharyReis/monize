# OFX/QIF/CSV Import — Match-Review UI (frontend)

- **Date:** 2026-07-03
- **Task:** T-555 (frontend) — parent T-235, follows the shipped backend spine
- **Status:** Design approved (Zach, 2026-07-03) → `writing-plans`
- **Author:** Alfred (zforge)
- **Repo/branch:** `monize` @ `t-555-import-review-ui` (off deployed `manor/baseline-v1.11.3`)
- **Related:**
  - Backend design: `docs/superpowers/specs/2026-07-03-ofx-import-transaction-matching-design.md`
  - Backend plan: `docs/superpowers/plans/2026-07-03-ofx-import-matching-backend.md`
  - Backend hardening follow-ups: T-556 (non-blocking)

## Problem

The T-235 backend spine shipped and deployed 2026-07-03 (`manor/baseline-v1.11.3` @
`434a6838`): imports now stage possible duplicates instead of blindly inserting them, and
a resolve API is live. But there is **no user-facing way to act on those matches yet** — the
buttons don't exist. A hand-entered `UNRECONCILED` row and its bank `CLEARED` twin still sit
side by side until Zach reconciles by hand. This spec is the deferred frontend half: the
review UI that lets him confirm a **Merge** or **Keep both** for each staged match, both
right after an import and later from a persistent queue.

This is also where the **real user-facing live gate** for the whole T-235 feature finally
runs — the backend increment could only be verified by integration tests and deploy checks
because nothing could drive the resolve flow end-to-end.

## What exists to consume (backend, live on monize)

Verified against `manor/baseline-v1.11.3`, 2026-07-03.

### Endpoints — `ImportMatchController` (`backend/src/import/import-match.controller.ts`)

JWT-guarded, mounted at `@Controller("import/matches")` (so, with the axios `baseURL:
'/api/v1'`, the frontend calls `/import/matches`):

| Method | Route | Body | Returns |
|--------|-------|------|---------|
| `GET`  | `/import/matches` | — | `ImportMatchCandidate[]` — **raw entity today** (see below) |
| `POST` | `/import/matches/:id/merge` | `MergeMatchDto { transactionId }` | resolved `Transaction` |
| `POST` | `/import/matches/:id/keep-both` | — | inserted `Transaction` |

`:id` is the `ImportMatchCandidate.id` (a uuid). `transactionId` is the id of the chosen
UNRECONCILED candidate row. Both resolve calls are **idempotent via an atomic state claim**:
a second resolve of an already-`merged`/`kept` candidate is rejected — the frontend must
handle the **409** gracefully.

### The import-response shape (hydrated) — `ProposedMatchDto`

`backend/src/import/dto/import.dto.ts` (~312–336), attached to `ImportResultDto.proposedMatches`
(line ~403). Every standard single-account import (`importParsedTransactions`,
`import.service.ts` lines 119/889/973 — OFX/QIF/CSV) emits this, built from the processor's
`ctx.stagedThisRow` buffer (`import.service.ts:1318`), which is **hydrated at match time**:

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

### The persisted shape (un-hydrated) — `ImportMatchCandidate` entity

`backend/src/import/entities/import-match-candidate.entity.ts`. This is what `GET
/import/matches` returns **today**:

```
id, userId, accountId, importBatchId,
bankAmount, bankDate, fitid, bankName, bankMemo, bankReference,
candidateTransactionIds: string[]   // jsonb — bare IDs, NOT hydrated
state: "pending" | "merged" | "kept",
createdAt, updatedAt
```

**The gap:** the entity keeps only `candidateTransactionIds` (bare IDs), while the import
response carries the candidate rows fully hydrated. So the two surfaces return **different
shapes**. Resolving that is the one backend decision in this spec (§ Backend change).

### Staging coverage (already true, no work needed)

`findMatchCandidates` returns `[]` unless `ctx.importBatchId` is set
(`import-regular-processor.service.ts:149`); it is set for every standard import
(`import.service.ts:1251`). So **matches for every OFX/QIF/CSV single-account import are
staged in the DB regardless of what the frontend does with the response** — bulk imports'
matches therefore surface on the Pending Reviews page automatically. The only unstaged path
is multi-account QIF (`importQifMultiAccountFile`, deliberately disabled — T-556, out of
scope).

## Frontend stack (what we design against)

Next.js 16 (App Router) + React 19 + TypeScript 5.9; Tailwind CSS 4 with **custom** UI
components (`components/ui/`, no MUI/Chakra); **Zustand** stores (`store/`); **plain axios**
(`lib/api.ts` — `apiClient`, `baseURL: '/api/v1'`, `withCredentials`, CSRF via
`X-CSRF-Token` cookie) with a small custom cache (`lib/apiCache.ts` — `cachedRequest` /
`invalidateCache`, **no React Query**); `next-intl` (**i18n mandatory** — every string is a
key in `i18n/messages/en/*.json`); `react-hot-toast`; Heroicons. Tests: **Vitest + React
Testing Library + jsdom + MSW** co-located as `*.test.tsx` (**~90% coverage enforced**);
**Playwright** e2e in `e2e/`.

**Import flow:** a wizard state machine — `hooks/useImportWizard.ts`, step union
`ImportStep` in `app/import/import-utils.ts`, step components in `components/import/*`. The
**single-file** path (`handleImport`, ~lines 951–962) sets `importResult` and jumps to
`'complete'` → `CompleteStep.tsx`. The **bulk** path (~842–950) aggregates per file and
**discards `proposedMatches`**.

**Two gotchas to fix first:** (a) the frontend `ImportResult` interface (`lib/import.ts`
~240–261) is behind the backend DTO — it lacks `proposedMatches`; (b) the bulk path drops
match data (fine — bulk uses the queue).

## Design decisions (all approved 2026-07-03)

| Decision | Choice |
|----------|--------|
| Primary review surface | **In-wizard step** (`'matchReview'`), single-file, shown before `'complete'` |
| Persistent surface | **Dedicated page** `/import/matches` under Tools + **nav count badge** |
| Inline scope | **Single-file only**; bulk imports route to the queue automatically |
| Backend list endpoint | **Normalize `listPending` → `ProposedMatchDto[]`** (hydrate) — one shape, one component |
| Merge interaction | **One click**, no confirm dialog (MS-Money muscle memory) |
| Multi-candidate | Show all; **radio-select one** to merge; others stay pending |
| Route | `/import/matches` (mirrors the API) |

## Backend change (small, read-only, no migration)

Normalize `ImportMatchService.listPending` to return **`ProposedMatchDto[]`** instead of raw
`ImportMatchCandidate[]`: for each pending candidate, load the transactions named in
`candidateTransactionIds` (scoped to the user) and shape them into `ProposedMatchDto.candidates`,
reusing the same DTO the import path already produces (factor a shared
`toProposedMatchDto(candidate, transactions)` mapper so import-time and list-time hydration
can't drift). No schema change, no migration — a read-only query + mapping.

**Why (vs. hydrating on the frontend):** the alternative — page fetches candidates then
fetches each referenced transaction by id and joins client-side — needs a batch
`transactions?ids=[...]` endpoint that doesn't exist (so a backend change anyway) or N+1
fetches, and forks the component's input into two shapes. Normalizing server-side is
smaller and keeps the frontend on **one shape → one shared component**. This is the only
backend edit in this increment; it rides the same Wren gate as the frontend.

## Architecture — components

Each unit has one job, a defined interface, and its own co-located tests.

### 1. Types + API module

- **Types** (`lib/import.ts`, alongside `ImportResult`, or a new `types/import.ts`): mirror
  `ProposedMatchDto` and its nested `candidate` shape; add `proposedMatches?:
  ProposedMatchDto[]` to the `ImportResult` interface.
- **`importMatchesApi`** (`lib/import-matches.ts`, mirroring the `lib/*.ts` service idiom):
  - `list(): Promise<ProposedMatchDto[]>` → `apiClient.get('/import/matches')`
  - `merge(candidateId, transactionId): Promise<Transaction>` →
    `apiClient.post('/import/matches/${id}/merge', { transactionId })`
  - `keepBoth(candidateId): Promise<Transaction>` →
    `apiClient.post('/import/matches/${id}/keep-both')`
  - Each mutation calls `invalidateCache('transactions:')` **and** `invalidateCache('accounts:')`
    (a resolve changes a row's status/fitid and an account's cleared balance).

### 2. `MatchReviewCard` (`components/import/MatchReviewCard.tsx`) — the shared unit

Renders **one** `ProposedMatchDto`: the bank row on one side, the candidate UNRECONCILED
row(s) on the other, with **Merge** / **Keep both**.

- **Props:** `match: ProposedMatchDto`, `onMerge(candidateId, transactionId)`,
  `onKeepBoth(candidateId)`, `resolving?: boolean`.
- **Multi-candidate:** if `candidates.length > 1`, render each with a radio; **Merge is
  disabled until one is selected**; it merges the selected row. Keep-both ignores the
  selection.
- Pure/presentational — no data fetching. Consumed by both the wizard step and the page, so
  the two surfaces look identical.

### 3. `MatchReviewList` (`components/import/MatchReviewList.tsx`) — shared orchestrator

Takes a list of matches + async resolve handlers, renders `MatchReviewCard`s, and owns the
per-card lifecycle:

- Tracks per-card state (`idle | resolving | resolved`), removes/greys a card on success.
- **409 handling:** treat "already resolved" as benign success — mark resolved, toast
  `import.matchReview.alreadyResolved`, don't surface an error.
- Other failures: toast the error, leave the card actionable for retry.
- **Empty state** slot (`emptyLabel`) so the page can say "No pending reviews" and the
  wizard step can auto-advance.

### 4. `MatchReviewStep` (`components/import/MatchReviewStep.tsx`) — wizard step

- New `ImportStep` value `'matchReview'`; added to the `import-utils.ts` union and the
  `app/import/page.tsx` switch, rendered between `review`/import and `complete`.
- `useImportWizard.ts` single-file `handleImport`: when the result has
  `proposedMatches?.length`, `setStep('matchReview')`; otherwise `'complete'` (unchanged).
  Store `proposedMatches` in wizard state for the step to consume.
- Wraps `MatchReviewList` (resolving via `importMatchesApi`). Footer shows **"Done"** once
  every match is resolved, or **"Skip remaining →"** while any stay pending; both advance to
  `'complete'` (one action, context-labeled). Unresolved matches simply remain pending in the
  DB (already staged) — nothing to persist on skip; they reappear on the Pending Reviews page.
- On any resolve, call `pendingReviewsStore.refresh()` (§6) so the badge tracks reality.

### 5. Pending Reviews page (`app/import/matches/page.tsx`)

- Standard shell: `ProtectedRoute → PageLayout → PageHeader`.
- `useEffect` → `importMatchesApi.list()` into `useState` (the app's manual fetch idiom;
  no React Query). Renders `MatchReviewList` with the same resolve handlers.
- Empty state: friendly "You're all caught up — no matches to review."
- On resolve, refresh both the local list and `pendingReviewsStore`.

### 6. `pendingReviewsStore` (`store/pendingReviewsStore.ts`) — badge count

Small Zustand store: `{ count: number; refresh(): Promise<void> }`. `refresh()` calls
`importMatchesApi.list()` and sets `count = length`. Called: on app mount (or first render
of `AppHeader`), after a single-file import completes, and after every resolve. Keeps the
nav badge honest without polling.

### 7. Nav + i18n + bulk CompleteStep

- **Nav** (`components/layout/AppHeader.tsx` `toolsLinks`, mirrored in
  `MobileNavDrawer.tsx`): add `{ href: '/import/matches', labelKey: 'pendingReviews', badge:
  count || undefined }` — `toolsLinks` already supports an optional `badge`.
- **i18n**: new keys under `import.json` (`matchReview.*`: title, N-imported-M-matches,
  merge, keepBoth, skipAll, done, alreadyResolved, empty) and `navigation.json`
  (`pendingReviews`). No hardcoded strings.
- **Bulk `CompleteStep.tsx`**: when a bulk import staged matches (count from
  `pendingReviewsStore` after refresh, or a `matchesStaged` count if surfaced), show a
  "M possible matches → Review" link to `/import/matches`. (Bulk still doesn't get the
  inline step.)

## Data flow

```
Single-file import
  POST /import/{ofx,csv,qif}
    → ImportResultDto.proposedMatches[] (hydrated)
    → useImportWizard: proposedMatches.length ? step='matchReview' : 'complete'
    → MatchReviewStep → MatchReviewList → MatchReviewCard
        Merge(candidateId, transactionId) → POST /import/matches/:id/merge {transactionId}
        Keep both(candidateId)           → POST /import/matches/:id/keep-both
        on success → invalidateCache(transactions:, accounts:), pendingReviewsStore.refresh()
    → "Skip all" / "Done" → step='complete' (unresolved stay in queue)

Pending Reviews page
  GET /import/matches → ProposedMatchDto[] (after backend normalize)
    → MatchReviewList (same component, same handlers)

Nav badge
  pendingReviewsStore.count, refreshed on mount + after import + after each resolve
```

## Error handling

- **409 already-resolved** (other tab, or resolved in-wizard then revisited on the page):
  benign — mark resolved, toast, refresh. Never an error banner.
- **Network / 5xx**: toast, card stays actionable for retry.
- **Multi-candidate**: Merge disabled until a row is selected.
- **No matches** in an import: skip `'matchReview'`, go straight to `'complete'`.
- **Empty queue**: friendly empty state, no error.
- The axios interceptor already handles 401 refresh + CSRF transparently — no new work.

## Testing strategy

**Backend (Vitest, `backend/`):** `listPending` normalization — hydrates
`candidateTransactionIds` into `ProposedMatchDto.candidates`; user-scoping (never returns
another user's transactions); a candidate whose referenced transactions were since deleted
degrades safely (empty `candidates`, still listed or filtered — decided in plan). Reuse the
existing `import-match.service` test harness.

**Frontend unit (Vitest + RTL + MSW, co-located, ~90% enforced):**
- `MatchReviewCard`: renders bank vs candidate rows; single-candidate one-click Merge/Keep-both
  emit the right args; multi-candidate radio gates Merge; `resolving` disables buttons.
- `MatchReviewList`: success removes a card; **409 → benign resolved path**; error → retryable;
  empty state.
- `MatchReviewStep` + `useImportWizard`: result with matches → `'matchReview'`; without →
  `'complete'`; Skip/Done → `'complete'`.
- Pending Reviews page: fetch + render; empty; resolve refreshes list + store.
- `pendingReviewsStore`: refresh sets count; `importMatchesApi` (mocked `apiClient`, cache
  invalidation asserted).

**E2E (Playwright, `e2e/tests/import.spec.ts`) — the real live gate:** seed an account +
a hand-entered **UNRECONCILED** transaction (via `e2e/helpers/factories.ts`), import an OFX
whose bank row matches it (amount + date within 7 days), assert the **Review matches** step
appears, click **Merge**, assert: the row is now **CLEARED**, carries the **FITID**, keeps
the **user's payee/category**, and **no duplicate** was inserted. A second spec: **Keep
both** inserts the bank row as a new CLEARED row. A third: resolving from the **Pending
Reviews page** works and the badge count drops.

## Scope & non-goals

- **In:** backend `listPending` normalize; frontend types + `importMatchesApi`; shared
  `MatchReviewCard` + `MatchReviewList`; single-file `MatchReviewStep` wired into the wizard;
  `/import/matches` page + nav badge + `pendingReviewsStore`; i18n; bulk `CompleteStep`
  pointer; Vitest unit + Playwright e2e (the end-to-end live gate).
- **Out (deferred):** inline review for **bulk** imports (the queue covers them
  automatically — the aggregate path stays as-is); **multi-account QIF** matching
  (backend-disabled, T-556); **legacy FITID backfill** and the other T-556 backend hardening
  items; Boswell fuzzy ranking (T-235 Phase 3).

## Known limitation / accepted risk

**No undo on a mis-merge yet.** Import-apply (`merge` / `keep-both`) does not record an
action-history entry (T-556 item 1), so a wrong Merge is corrected by normal transaction
editing, not Ctrl-Z. Accepted for this increment: the side-by-side makes intent unambiguous
and Keep-both is the safe alternative; one-click speed is the point of the flow. If the
undo gap bites in practice, T-556 #1 adds action-history to both apply paths.

## Open questions / plan-phase verifications

None material — all UX forks resolved above. To confirm during `writing-plans`:

1. **`listPending` normalize:** exact reuse point for a shared `toProposedMatchDto` mapper,
   and the deleted-referenced-transaction edge (filter vs. empty `candidates`).
2. **Bulk match count on `CompleteStep`:** whether to surface a `matchesStaged` count in the
   bulk result, or lean on `pendingReviewsStore.refresh()` for the pointer.
3. **`ImportStep` switch site** in `app/import/page.tsx` + progress-indicator handling for
   the new step (does the wizard progress bar need a new label?).
4. **Nav badge source of truth**: confirm `AppHeader` is a client component that can
   subscribe to a Zustand store (it is, but verify SSR hydration is clean).

---
-- Claude Code 2026-07-03
