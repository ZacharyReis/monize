# Import Match-Review UI — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the user-facing review UI for T-235 import matches — an in-wizard review step, a persistent Pending Reviews page, and the backend surface (normalized list, conflict codes, a Dismiss action) to serve them.

**Architecture:** Backend-first. Five backend tasks (migration + `dismissed` state, exception-filter `code` passthrough, conflict codes + merge ordering, Dismiss endpoint, normalized+hydrated `listPending`) give the frontend live, correct endpoints. Then frontend: types + api module, a Zustand badge store, a shared `MatchReviewCard`/`MatchReviewList`, the wizard step, the Pending Reviews page + nav badge, bulk plumbing, and a Playwright live gate. One shared side-by-side component serves both surfaces because the list endpoint is normalized to the import response's shape.

**Tech Stack:** Backend — NestJS + TypeORM + Postgres, Vitest/Jest integration + unit. Frontend — Next.js 16 App Router, React 19, TypeScript, Tailwind 4, Zustand, plain axios (`lib/api.ts`, no React Query), next-intl, react-hot-toast; Vitest + RTL + MSW (~90% coverage enforced); Playwright e2e.

**Spec:** `docs/superpowers/specs/2026-07-03-ofx-import-review-ui-design.md` (v3). **Plan v2** — Wren plan-review folds applied (see "Plan-review folds" below; they amend the referenced tasks).

## Global Constraints

- **i18n mandatory** — every user-facing string is a `next-intl` key in `frontend/src/i18n/messages/en/<namespace>.json`. No hardcoded UI strings. Component tests use the custom render (`@/test/render`) which loads real `en` messages, so keys must exist for tests to assert on rendered text.
- **~90% coverage enforced** — every new module/component ships with co-located `*.test.tsx`/`*.spec.ts`.
- **`fitid` is never on the public transaction DTO** — enforced by `backend/src/transactions/dto/fitid-not-whitelisted.spec.ts`. Do not add it. Merge/keep-both write it via the internal `applyImportedMatch`/`createImportedRow` paths only.
- **Migrations are guarded** — every statement uses `IF NOT EXISTS`/`IF EXISTS` (or `DROP … IF EXISTS` before `ADD`). The runner (`scripts/rebuild.sh --migrate-only`) pipes files into `psql` and relies on guards for idempotency; it does not track applied migrations. Update `database/schema.sql` to match every migration.
- **Naming:** 3-digit zero-padded migration prefix; next is `092`.
- **Money-safety:** Merge is confirm-dialog-guarded; Keep-both and Dismiss are one-click. No unmerge in this increment (deferred, T-556 #1).
- **Conflict discrimination:** resolve endpoints return 409 with a machine-readable `code` (`already_resolved` | `not_a_candidate` | `target_ineligible`). The frontend treats **only** `already_resolved` as benign.

## Conventions (shared idioms — every task follows these)

- **API module** (`frontend/src/lib/*.ts`): `import apiClient from './api';` then `async` arrows returning `response.data`; mutations call `invalidateCache('accounts:')` + `invalidateCache('investments:')` from `./apiCache`. A 409 reaches the caller as an unmodified `AxiosError` → read `err.response?.status` and `err.response?.data?.code`.
- **Zustand** (`frontend/src/store/*.ts`): `create<State>()((set, get) => ({...}))`; async actions use `try { const x = await api(); set({...}) } catch { … }` (mirror `preferencesStore.loadPreferences`).
- **ConfirmDialog** (`@/components/ui/ConfirmDialog`): props `{ isOpen, title, message, confirmLabel?, cancelLabel?, variant?, onConfirm, onCancel }`. **Close-then-async pattern** (from `TransactionList.tsx:219`): on confirm, snapshot state, `setConfirm({isOpen:false})` FIRST, set a busy id, then `await` the work in try/catch/finally. Guards double-fire.
- **Component tests** (Vitest+RTL): `import { render, screen, fireEvent } from '@/test/render';` (custom render, loads real i18n). Mock lib modules with `vi.mock('@/lib/<m>', () => ({ <api>: { method: vi.fn().mockResolvedValue(...) } }))`. `vi.clearAllMocks()` in `beforeEach`. Assert on real translated strings.
- **Backend unit tests** (`import-match.service.spec.ts`): mocked repos; `candidateRepo.update` returns `{ affected: 1 }` (claim wins) or `.mockResolvedValueOnce({ affected: 0 })` (claim lost). `pendingCandidate(over)` / `targetTxn(over)` factories.
- **Backend integration** (`backend/test/integration/import-match.integration.spec.ts`): `createIntegrationModule([ImportModule])`, `cleanTables(...)`, `createTestUserDirect`, `createTestAccount`, the local `stageCandidate(over)` + `balanceOf()` helpers.
- **Commit** after each task's tests are green: `git commit -m "<type>(t-555): <task>"`, ending the body with `-- Claude Code 2026-07-03` and `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`.

---

## Plan-review folds (v2 — Wren plan-review, Codex 019f2b1d)

These amend the tasks below; apply each when you reach the referenced task.

**[High] Task 3 — code the POST-claim conflict.** `merge()`'s existing try/catch reverts the
claim and rethrows if `applyImportedMatch` fails. When that failure is a `ConflictException`
(target became ineligible under the row lock — a race), rethrow it CODED. Replace the catch:
```ts
} catch (err) {
  await this.candidateRepo.update({ id: candidateId }, { state: "pending" });
  if (err instanceof ConflictException) {
    throw this.conflict(
      "target_ineligible",
      (err.getResponse() as any)?.message ?? "Transaction is no longer eligible to merge",
    );
  }
  throw err;
}
```
Add a Task-3 unit test: `txService.applyImportedMatch.mockRejectedValue(new ConflictException("x"))`
→ `service.merge(...)` rejects with `response.code === "target_ineligible"` AND
`candidateRepo.update` was called to revert the candidate to `pending`.

**[Med] Task 5 — mapper + merge eligibility must exclude LINKED rows.** The shipped matcher
excludes `linked_transaction_id` rows (`import-regular-processor.service.ts:160`). Add
`!t.linkedTransactionId` to `toProposedMatch`'s `.filter(...)` predicate AND to `merge()`'s
pre-claim eligibility check (extend the `!existing || …` condition with
`|| existing.linkedTransactionId`). Tests: a linked target is dropped from `candidates`
(mapper) and rejected `target_ineligible` (merge).

**[Med] Task 9 — refresh on a REAL conflict.** `MatchReviewList` takes an `onRefresh?()` prop.
On a non-`already_resolved` failure: `toast.error(...)` **and** `onRefresh?.()`. The Pending
Reviews page passes a re-fetch of `importMatchesApi.list()`; the wizard step passes `undefined`
(its stale card simply falls to the queue). Test: a `target_ineligible` rejection calls
`onRefresh` and does NOT mark the card resolved.

**[Med] Task 8 — robust confirm test (avoid ambiguous selector).** Give the merge
`ConfirmDialog` an explicit `confirmLabel={t('matchReview.merge')}`, and query the confirm
button **within the dialog**:
```ts
import { render, screen, fireEvent, within } from "@/test/render";
fireEvent.click(screen.getByRole("button", { name: /^merge$/i })); // trigger
const dialog = screen.getByRole("dialog");
fireEvent.click(within(dialog).getByRole("button", { name: /^merge$/i })); // confirm
expect(h.onMerge).toHaveBeenCalledTimes(1);
```

**[Med] Task 12 — cross-tab refresh.** A plain `window` event only reaches the current window.
On resolve, emit BOTH: `window.dispatchEvent(new CustomEvent('monize:transactions-changed'))`
(same window) AND `new BroadcastChannel('monize').postMessage('transactions-changed')` (other
tabs). The transactions/accounts pages add a `window` listener AND a `BroadcastChannel('monize')`
`onmessage`; both call the existing refetch; clean up both on unmount.

**[Med] Task 13 — full e2e assertions (v3 contract).** Beyond CLEARED + no-duplicate: assert the
merged row **kept the user's payee** ("Google", not the bank "GOOGLE CLOUD"); seed the
UNRECONCILED row with a category and assert it survives. Prove the FITID **behaviorally** (it is
not on the public read DTO): after the merge, **re-import the same OFX** and assert it is
**skipped** (dedup) — no new row appears.

**[Low] Task 6 — cache keys.** Invalidate `'transactions:'` **and** `'accounts:'` on every match
mutation (spec §179); keeping `'investments:'` too is harmless. Apply to
`importMatchesApi.{merge,keepBoth,dismiss}`.

**[Low] i18n — exact copy** (add to `frontend/src/i18n/messages/en/import.json`; ASCII only):
```json
"matchReview": {
  "title": "Review matches",
  "subtitle": "{imported} imported, {matches} possible {matches, plural, one {match} other {matches}}",
  "account": "Account",
  "yourRow": "Your transaction",
  "bankRow": "Bank record",
  "merge": "Merge",
  "keepBoth": "Keep both",
  "dismiss": "Dismiss",
  "confirmMergeTitle": "Merge this transaction?",
  "confirmMergeMessage": "This clears your transaction and attaches the bank record. Undoing it means deleting the row and re-importing.",
  "skipRemaining": "Skip remaining",
  "done": "Done",
  "alreadyResolved": "That match was already resolved.",
  "resolveError": "Could not resolve this match - it has been refreshed.",
  "empty": "You're all caught up - no matches to review.",
  "reviewPointer": "{count} possible {count, plural, one {match} other {matches}} from this import"
}
```
And `frontend/src/i18n/messages/en/navigation.json`: `"pendingReviews": "Pending Reviews"`.

---

## Task 1: Migration 092 + `dismissed` state

**Files:**
- Create: `database/migrations/092_import_match_candidate_dismissed.sql`
- Modify: `database/schema.sql:1156-1157` (the `import_match_candidate_state_check` CHECK)
- Modify: `backend/src/import/entities/import-match-candidate.entity.ts:5` (`ImportMatchState` type)

**Interfaces:**
- Produces: DB state `'dismissed'` accepted by `import_match_candidate.state`; `ImportMatchState = "pending" | "merged" | "kept" | "dismissed"`.

- [ ] **Step 1: Write the migration**

```sql
-- 092_import_match_candidate_dismissed.sql
-- T-555: add a 'dismissed' terminal state so a staged match can be rejected
-- WITHOUT inserting the bank row (merge folds; keep-both inserts; dismiss drops).
ALTER TABLE import_match_candidate
    DROP CONSTRAINT IF EXISTS import_match_candidate_state_check;
ALTER TABLE import_match_candidate
    ADD CONSTRAINT import_match_candidate_state_check
    CHECK (state IN ('pending', 'merged', 'kept', 'dismissed'));
```

- [ ] **Step 2: Update `schema.sql`** — change the CHECK at line ~1156 to the 4-state form above (identical `CHECK (state IN ('pending', 'merged', 'kept', 'dismissed'))`).

- [ ] **Step 3: Extend the entity type** — `import-match-candidate.entity.ts`:

```ts
export type ImportMatchState = "pending" | "merged" | "kept" | "dismissed";
```

- [ ] **Step 4: Apply + verify against a scratch DB**

Run: `psql -U postgres -d monize -f database/migrations/092_import_match_candidate_dismissed.sql`
Then verify the constraint accepts the new value and rejects garbage:
```bash
psql -U postgres -d monize -c "SELECT conname FROM pg_constraint WHERE conname='import_match_candidate_state_check';"
```
Expected: one row (constraint exists). (Behavioral coverage of `dismissed` is Task 4's integration test — integration DB is entity-synchronized, so it needs the entity change from Step 3, not this migration.)

- [ ] **Step 5: Commit** — `git add database/migrations/092_* database/schema.sql backend/src/import/entities/import-match-candidate.entity.ts && git commit`.

---

## Task 2: Exception filter preserves `code`

**Files:**
- Modify: `backend/src/common/filters/http-exception.filter.ts` (the `message` extraction + the final `response…json`)
- Test: `backend/src/common/filters/http-exception.filter.spec.ts` (create)

**Interfaces:**
- Produces: any `HttpException` whose response object carries a string `code` now emits `{ statusCode, message, code, timestamp? }`.

- [ ] **Step 1: Write the failing test** (`http-exception.filter.spec.ts`)

```ts
import { ConflictException, ArgumentsHost } from "@nestjs/common";
import { GlobalExceptionFilter } from "./http-exception.filter";

function mockHost(): { host: ArgumentsHost; json: jest.Mock; status: jest.Mock } {
  const json = jest.fn();
  const status = jest.fn(() => ({ json }));
  const res = { status, headersSent: false } as any;
  const host = { switchToHttp: () => ({ getResponse: () => res }) } as any;
  return { host, json, status };
}

describe("GlobalExceptionFilter code passthrough", () => {
  it("preserves a custom `code` field from an HttpException object response", () => {
    const { host, json, status } = mockHost();
    new GlobalExceptionFilter().catch(
      new ConflictException({ message: "Match candidate already resolved", code: "already_resolved" }),
      host,
    );
    expect(status).toHaveBeenCalledWith(409);
    expect(json).toHaveBeenCalledWith(expect.objectContaining({ code: "already_resolved" }));
  });

  it("omits `code` when the exception carries none", () => {
    const { host, json } = mockHost();
    new GlobalExceptionFilter().catch(new ConflictException("plain"), host);
    expect(json.mock.calls[0][0]).not.toHaveProperty("code");
  });
});
```

- [ ] **Step 2: Run it — expect FAIL** (`code` not emitted).
Run: `cd backend && npx jest http-exception.filter.spec -t "code passthrough"`

- [ ] **Step 3: Patch the filter.** In the object-response branch, capture `code`; include it in the JSON. Change the `else if (typeof exceptionResponse === "object" …)` block to also read `code`, and the final emit:

```ts
    let code: string | undefined;
    // …inside the object-response branch, after setting `message`:
        const resp = exceptionResponse as Record<string, unknown>;
        message = (resp.message as string | string[]) || exception.message;
        if (typeof resp.code === "string") code = resp.code;
    // …the final emit:
    response.status(status).json({
      statusCode: status,
      message,
      ...(code ? { code } : {}),
      ...(this.isProduction ? {} : { timestamp: new Date().toISOString() }),
    });
```

(Declare `let code: string | undefined;` alongside `let message` near the top of `catch`.)

- [ ] **Step 4: Run tests — expect PASS.** Run: `cd backend && npx jest http-exception.filter.spec`

- [ ] **Step 5: Commit.**

---

## Task 3: Conflict codes + merge terminal-state ordering

**Files:**
- Modify: `backend/src/import/import-match.service.ts` (`merge`, `keepBoth`; add a `conflict()` helper + an early state check)
- Test: `backend/src/import/import-match.service.spec.ts` (extend)

**Interfaces:**
- Consumes: `ConflictException` (already imported).
- Produces: `merge`/`keepBoth` throw `ConflictException({ message, code })` with `code ∈ {already_resolved, not_a_candidate, target_ineligible}`; merge checks `candidate.state !== "pending"` → `already_resolved` **before** target validation.

- [ ] **Step 1: Write failing tests** (extend `import-match.service.spec.ts`)

```ts
it("merge on an already-resolved candidate returns already_resolved BEFORE target checks", async () => {
  candidateRepo.findOne.mockResolvedValue(pendingCandidate({ state: "merged" }));
  await expect(service.merge("u1", "cand-1", "txn-1")).rejects.toMatchObject({
    response: { code: "already_resolved" },
  });
  expect(transactionsRepo.findOne).not.toHaveBeenCalled(); // never reached target validation
});

it("merge with a transactionId not on the candidate returns not_a_candidate", async () => {
  candidateRepo.findOne.mockResolvedValue(pendingCandidate({ candidateTransactionIds: ["other"] }));
  await expect(service.merge("u1", "cand-1", "txn-1")).rejects.toMatchObject({
    response: { code: "not_a_candidate" },
  });
});

it("merge against an ineligible target returns target_ineligible", async () => {
  candidateRepo.findOne.mockResolvedValue(pendingCandidate());
  transactionsRepo.findOne.mockResolvedValue(targetTxn({ status: TransactionStatus.CLEARED }));
  await expect(service.merge("u1", "cand-1", "txn-1")).rejects.toMatchObject({
    response: { code: "target_ineligible" },
  });
});

it("keepBoth double-resolve returns already_resolved", async () => {
  candidateRepo.findOne.mockResolvedValue(pendingCandidate({ state: "kept" }));
  await expect(service.keepBoth("u1", "cand-1")).rejects.toMatchObject({
    response: { code: "already_resolved" },
  });
});
```

- [ ] **Step 2: Run — expect FAIL.** Run: `cd backend && npx jest import-match.service.spec`

- [ ] **Step 3: Implement.** Add a helper and reorder `merge`; add the early check to `keepBoth`:

```ts
private conflict(code: string, message: string): ConflictException {
  return new ConflictException({ message, code });
}
```
In `merge`, immediately after `const candidate = await this.loadOwned(...)`:
```ts
  if (candidate.state !== "pending") {
    throw this.conflict("already_resolved", "Match candidate already resolved");
  }
  if (!candidate.candidateTransactionIds.includes(transactionId)) {
    throw this.conflict("not_a_candidate", "transactionId is not a candidate for this match");
  }
  // …existing eligibility check → replace its throw with:
  if (!existing || existing.accountId !== candidate.accountId ||
      existing.status !== TransactionStatus.UNRECONCILED || existing.isSplit || existing.isTransfer) {
    throw this.conflict("target_ineligible", "Transaction is no longer eligible to merge");
  }
  if (!(await this.claim(userId, candidateId, "merged"))) {
    throw this.conflict("already_resolved", "Match candidate already resolved");
  }
```
In `keepBoth`, after `loadOwned`:
```ts
  if (candidate.state !== "pending") {
    throw this.conflict("already_resolved", "Match candidate already resolved");
  }
  // …existing claim-lost throw → this.conflict("already_resolved", "Match candidate already resolved")
```

- [ ] **Step 4: Run — expect PASS.** Run: `cd backend && npx jest import-match.service.spec`

- [ ] **Step 5: Commit.**

---

## Task 4: Dismiss action (service + controller)

**Files:**
- Modify: `backend/src/import/import-match.service.ts` (add `dismiss`)
- Modify: `backend/src/import/import-match.controller.ts` (add route)
- Test: `import-match.service.spec.ts` (unit) + `backend/test/integration/import-match.integration.spec.ts` (integration)

**Interfaces:**
- Produces: `ImportMatchService.dismiss(userId: string, candidateId: string): Promise<void>`; `POST /import/matches/:id/dismiss`.

- [ ] **Step 1: Write failing tests.** Unit (`import-match.service.spec.ts`):
```ts
describe("dismiss", () => {
  it("claims the candidate as dismissed and inserts nothing", async () => {
    candidateRepo.findOne.mockResolvedValue(pendingCandidate());
    await service.dismiss("u1", "cand-1");
    expect(candidateRepo.update).toHaveBeenCalledWith(
      { id: "cand-1", userId: "u1", state: "pending" }, { state: "dismissed" },
    );
    expect(txService.createImportedRow).not.toHaveBeenCalled();
    expect(txService.applyImportedMatch).not.toHaveBeenCalled();
  });
  it("double-dismiss returns already_resolved", async () => {
    candidateRepo.findOne.mockResolvedValue(pendingCandidate({ state: "dismissed" }));
    await expect(service.dismiss("u1", "cand-1")).rejects.toMatchObject({ response: { code: "already_resolved" } });
  });
});
```
Integration (`import-match.integration.spec.ts`):
```ts
describe("dismiss", () => {
  it("marks the candidate dismissed, inserts no row, leaves balance unchanged", async () => {
    const before = await balanceOf();
    const cand = await stageCandidate({ bankAmount: -50, fitid: "FIT-DISMISS" });
    await matchService.dismiss(userId, cand.id);
    const c = await dataSource.manager.findOneOrFail(ImportMatchCandidate, { where: { id: cand.id } });
    expect(c.state).toBe("dismissed");
    expect(await matchService.listPending(userId)).toHaveLength(0); // drops off the queue
    const rows = await dataSource.manager.find(Transaction, { where: { fitid: "FIT-DISMISS" } });
    expect(rows).toHaveLength(0);            // nothing inserted
    expect(await balanceOf()).toBe(before);  // balance untouched
  });
});
```

- [ ] **Step 2: Run — expect FAIL** (`dismiss` undefined). Run: `cd backend && npx jest import-match`

- [ ] **Step 3: Implement `dismiss` in the service:**
```ts
async dismiss(userId: string, candidateId: string): Promise<void> {
  const candidate = await this.loadOwned(userId, candidateId);
  if (candidate.state !== "pending") {
    throw this.conflict("already_resolved", "Match candidate already resolved");
  }
  if (!(await this.claim(userId, candidateId, "dismissed"))) {
    throw this.conflict("already_resolved", "Match candidate already resolved");
  }
}
```
Add the controller route:
```ts
@Post(":id/dismiss")
dismiss(@Req() req: any, @Param("id", ParseUUIDPipe) id: string) {
  return this.matchService.dismiss(req.user.id, id);
}
```

- [ ] **Step 4: Run — expect PASS.** Run: `cd backend && npx jest import-match`

- [ ] **Step 5: Commit.**

---

## Task 5: Normalize `listPending` → hydrated `PendingMatchDto[]` (+ shared mapper)

**Files:**
- Modify: `backend/src/import/dto/import.dto.ts` (add `PendingMatchDto`)
- Create: `backend/src/import/import-match.mapper.ts` (`toProposedMatch(candidate, transactions)`)
- Modify: `backend/src/import/import-match.service.ts` (`listPending` rewrite; inject `AccountsService` already present)
- Modify: `backend/src/import/import-regular-processor.service.ts` (use the shared mapper in `stageMatchCandidate`)
- Test: `import-match.integration.spec.ts` + a mapper unit test `import-match.mapper.spec.ts`

**Interfaces:**
- Produces: `PendingMatchDto = ProposedMatchDto & { accountId: string; accountName: string }`; `listPending(userId): Promise<PendingMatchDto[]>`; `toProposedMatch(c, txns) → ProposedMatchDto`-shaped object with eligibility-filtered, order-preserved `candidates`.

- [ ] **Step 1: Write the mapper + its failing test** (`import-match.mapper.ts` + `.spec.ts`)

```ts
// import-match.mapper.ts
import { ImportMatchCandidate } from "./entities/import-match-candidate.entity";
import { Transaction, TransactionStatus } from "../transactions/entities/transaction.entity";

export function toProposedMatch(candidate: ImportMatchCandidate, transactions: Transaction[]) {
  const byId = new Map(transactions.map((t) => [t.id, t]));
  const candidates = candidate.candidateTransactionIds
    .map((id) => byId.get(id))
    .filter((t): t is Transaction =>
      !!t && t.status === TransactionStatus.UNRECONCILED &&
      t.accountId === candidate.accountId && !t.isSplit && !t.isTransfer,
    )
    .map((t) => ({
      id: t.id, transactionDate: t.transactionDate, amount: Number(t.amount),
      payeeName: t.payeeName, description: t.description,
    }));
  return {
    candidateId: candidate.id,
    bankAmount: Number(candidate.bankAmount),
    bankDate: candidate.bankDate,
    bankName: candidate.bankName ?? undefined,
    candidates,
  };
}
```
Test (`import-match.mapper.spec.ts`): assert order preserved, decimals cast to `number`, and an ineligible/absent referenced txn is dropped (zero-live → `candidates: []`).

- [ ] **Step 2: Run — expect FAIL.** Run: `cd backend && npx jest import-match.mapper`

- [ ] **Step 3: Add `PendingMatchDto`** (`import.dto.ts`) — extends the ProposedMatch shape with account context:
```ts
export class PendingMatchDto extends ProposedMatchDto {
  @ApiProperty() accountId: string;
  @ApiProperty() accountName: string;
}
```

- [ ] **Step 4: Rewrite `listPending`** to hydrate + add account context, capped, batched, user+account scoped:
```ts
async listPending(userId: string): Promise<PendingMatchDto[]> {
  const candidates = await this.candidateRepo.find({
    where: { userId, state: "pending" },
    order: { createdAt: "DESC" },
    take: 200,
  });
  if (candidates.length === 0) return [];
  const txnIds = [...new Set(candidates.flatMap((c) => c.candidateTransactionIds))];
  const txns = txnIds.length
    ? await this.transactionsRepo.find({ where: { id: In(txnIds), userId } })
    : [];
  const accounts = await this.accountsService.findByIds(userId, [...new Set(candidates.map((c) => c.accountId))]);
  const accountName = new Map(accounts.map((a) => [a.id, a.name]));
  return candidates.map((c) => ({
    ...toProposedMatch(c, txns),
    accountId: c.accountId,
    accountName: accountName.get(c.accountId) ?? "",
  }));
}
```
(Add `In` to the `typeorm` import; `toProposedMatch` import; the batched txn fetch is user-scoped and the mapper re-filters by `candidate.accountId`, so no cross-account leak.)

- [ ] **Step 5: Refactor the processor to use the mapper** (`import-regular-processor.service.ts` `stageMatchCandidate`) — replace the inline `ctx.stagedThisRow.push({...})` with `ctx.stagedThisRow.push(toProposedMatch(saved, candidates))`. (Bank name still comes from `saved.bankName`, set from `qifTx.payee` at candidate creation — behavior-preserving. Verify the existing processor/import tests stay green.)

- [ ] **Step 6: Extend the integration test** — stage a candidate with one live UNRECONCILED target; assert `listPending` returns the hydrated `candidates[0]` (id/amount as number/date), `accountName` populated, `accountId` set; then set the target to CLEARED and assert the candidate is still listed with `candidates: []` (zero-live). Add a cross-user isolation case (another user's candidate/txn is not returned/hydrated).

- [ ] **Step 7: Run — expect PASS** (mapper + service + integration + existing import tests). Run: `cd backend && npx jest import`

- [ ] **Step 8: Commit.**

---

## Task 6: Frontend types + `importMatchesApi`

**Files:**
- Create: `frontend/src/types/import.ts` (`ProposedMatch`, `PendingMatch`)
- Modify: `frontend/src/lib/import.ts` (add `proposedMatches?`, `matchesStaged?` to `ImportResult`)
- Modify: `frontend/src/app/import/import-utils.ts` (add `matchesStaged?` to `BulkImportResult`)
- Create: `frontend/src/lib/import-matches.ts` (`importMatchesApi`)
- Test: `frontend/src/lib/import-matches.test.ts`

**Interfaces:**
- Produces: `ProposedMatch`, `PendingMatch = ProposedMatch & { accountId; accountName }`; `importMatchesApi.{ list, merge, keepBoth, dismiss }`.

- [ ] **Step 1: Types** (`types/import.ts`):
```ts
export interface ProposedMatch {
  candidateId: string;
  bankAmount: number;
  bankDate: string;
  bankName?: string;
  candidates: Array<{ id: string; transactionDate: string; amount: number; payeeName: string | null; description: string | null }>;
}
export type PendingMatch = ProposedMatch & { accountId: string; accountName: string };
```
Add `proposedMatches?: ProposedMatch[];` and `matchesStaged?: number;` to `ImportResult` (`lib/import.ts`); `matchesStaged?: number;` to `BulkImportResult` (`import-utils.ts`).

- [ ] **Step 2: Write the failing api test** (`import-matches.test.ts`)
```ts
import { describe, it, expect, vi, beforeEach } from "vitest";
vi.mock("./api", () => ({ default: { get: vi.fn(), post: vi.fn() } }));
vi.mock("./apiCache", () => ({ invalidateCache: vi.fn() }));
import apiClient from "./api";
import { invalidateCache } from "./apiCache";
import { importMatchesApi } from "./import-matches";

describe("importMatchesApi", () => {
  beforeEach(() => vi.clearAllMocks());
  it("merge posts transactionId and invalidates caches", async () => {
    (apiClient.post as any).mockResolvedValue({ data: undefined });
    await importMatchesApi.merge("cand-1", "txn-1");
    expect(apiClient.post).toHaveBeenCalledWith("/import/matches/cand-1/merge", { transactionId: "txn-1" });
    expect(invalidateCache).toHaveBeenCalledWith("accounts:");
  });
  it("dismiss posts to the dismiss route", async () => {
    (apiClient.post as any).mockResolvedValue({ data: undefined });
    await importMatchesApi.dismiss("cand-1");
    expect(apiClient.post).toHaveBeenCalledWith("/import/matches/cand-1/dismiss");
  });
  it("list returns response.data", async () => {
    (apiClient.get as any).mockResolvedValue({ data: [] });
    expect(await importMatchesApi.list()).toEqual([]);
  });
});
```

- [ ] **Step 3: Run — expect FAIL.** Run: `cd frontend && npx vitest run src/lib/import-matches.test.ts`

- [ ] **Step 4: Implement** (`lib/import-matches.ts`):
```ts
import apiClient from "./api";
import { invalidateCache } from "./apiCache";
import { PendingMatch } from "@/types/import";
import { Transaction } from "@/types/transaction";

export const importMatchesApi = {
  list: async (): Promise<PendingMatch[]> => (await apiClient.get<PendingMatch[]>("/import/matches")).data,
  merge: async (candidateId: string, transactionId: string): Promise<void> => {
    await apiClient.post(`/import/matches/${candidateId}/merge`, { transactionId });
    invalidateCache("accounts:"); invalidateCache("investments:");
  },
  keepBoth: async (candidateId: string): Promise<Transaction> => {
    const r = await apiClient.post<Transaction>(`/import/matches/${candidateId}/keep-both`);
    invalidateCache("accounts:"); invalidateCache("investments:");
    return r.data;
  },
  dismiss: async (candidateId: string): Promise<void> => {
    await apiClient.post(`/import/matches/${candidateId}/dismiss`);
    invalidateCache("accounts:"); invalidateCache("investments:");
  },
};
```

- [ ] **Step 5: Run — expect PASS.** Then **Step 6: Commit.**

---

## Task 7: `pendingReviewsStore`

**Files:** Create `frontend/src/store/pendingReviewsStore.ts`; Test `frontend/src/store/pendingReviewsStore.test.ts`.

**Interfaces:** Produces `usePendingReviewsStore` with `{ count: number; refresh(): Promise<void> }`.

- [ ] **Step 1: Failing test:**
```ts
import { describe, it, expect, vi, beforeEach } from "vitest";
vi.mock("@/lib/import-matches", () => ({ importMatchesApi: { list: vi.fn() } }));
import { importMatchesApi } from "@/lib/import-matches";
import { usePendingReviewsStore } from "./pendingReviewsStore";

describe("pendingReviewsStore", () => {
  beforeEach(() => { vi.clearAllMocks(); usePendingReviewsStore.setState({ count: 0 }); });
  it("refresh sets count to the list length", async () => {
    (importMatchesApi.list as any).mockResolvedValue([{}, {}, {}]);
    await usePendingReviewsStore.getState().refresh();
    expect(usePendingReviewsStore.getState().count).toBe(3);
  });
  it("refresh leaves count unchanged on error", async () => {
    (importMatchesApi.list as any).mockRejectedValue(new Error("boom"));
    await usePendingReviewsStore.getState().refresh();
    expect(usePendingReviewsStore.getState().count).toBe(0);
  });
});
```

- [ ] **Step 2: Run — expect FAIL. Step 3: Implement:**
```ts
import { create } from "zustand";
import { importMatchesApi } from "@/lib/import-matches";

interface PendingReviewsState { count: number; refresh: () => Promise<void>; }

export const usePendingReviewsStore = create<PendingReviewsState>()((set) => ({
  count: 0,
  refresh: async () => {
    try { const matches = await importMatchesApi.list(); set({ count: matches.length }); }
    catch { /* leave last-known count */ }
  },
}));
```

- [ ] **Step 4: Run — expect PASS. Step 5: Commit.**

---

## Task 8: `MatchReviewCard` + i18n

**Files:** Create `frontend/src/components/import/MatchReviewCard.tsx` + `.test.tsx`; Modify `frontend/src/i18n/messages/en/import.json` (add `matchReview.*`).

**Interfaces:**
- Consumes: `PendingMatch`, `@/components/ui/ConfirmDialog`.
- Produces: `<MatchReviewCard match onMerge(candidateId, transactionId) onKeepBoth(candidateId) onDismiss(candidateId) resolving? showAccount? />`.

- [ ] **Step 1: Add i18n keys** to `import.json` under a new `matchReview` object: `title`, `bankRow`, `yourRow`, `merge`, `keepBoth`, `dismiss`, `confirmMergeTitle`, `confirmMergeMessage`, `skipRemaining`, `done`, `alreadyResolved`, `resolveError`, `empty`, `nImportedMMatches`, `account`. (Exact copy in the plan appendix; keep ASCII.)

- [ ] **Step 2: Write failing component tests** (`MatchReviewCard.test.tsx`)
```ts
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@/test/render";
import { MatchReviewCard } from "./MatchReviewCard";
import { PendingMatch } from "@/types/import";

const single: PendingMatch = {
  candidateId: "c1", bankAmount: -11.04, bankDate: "2026-07-02", bankName: "GOOGLE",
  accountId: "a1", accountName: "TD Checking",
  candidates: [{ id: "t1", transactionDate: "2026-07-01", amount: -11.04, payeeName: "Google", description: null }],
};
const handlers = () => ({ onMerge: vi.fn(), onKeepBoth: vi.fn(), onDismiss: vi.fn() });

describe("MatchReviewCard", () => {
  beforeEach(() => vi.clearAllMocks());
  it("merge opens a confirm dialog and fires onMerge once on confirm", () => {
    const h = handlers();
    render(<MatchReviewCard match={single} {...h} />);
    fireEvent.click(screen.getByRole("button", { name: /^merge$/i }));
    expect(h.onMerge).not.toHaveBeenCalled();                 // gated by confirm
    fireEvent.click(screen.getByRole("button", { name: /^merge$/i })); // confirm button in dialog
    expect(h.onMerge).toHaveBeenCalledTimes(1);
    expect(h.onMerge).toHaveBeenCalledWith("c1", "t1");
  });
  it("keep-both and dismiss are one-click (no confirm)", () => {
    const h = handlers();
    render(<MatchReviewCard match={single} {...h} />);
    fireEvent.click(screen.getByRole("button", { name: /keep both/i }));
    fireEvent.click(screen.getByRole("button", { name: /dismiss/i }));
    expect(h.onKeepBoth).toHaveBeenCalledWith("c1");
    expect(h.onDismiss).toHaveBeenCalledWith("c1");
  });
  it("multi-candidate disables merge until a row is selected", () => {
    const multi = { ...single, candidates: [single.candidates[0], { ...single.candidates[0], id: "t2" }] };
    render(<MatchReviewCard match={multi} {...handlers()} />);
    expect(screen.getByRole("button", { name: /^merge$/i })).toBeDisabled();
    fireEvent.click(screen.getAllByRole("radio")[1]);
    expect(screen.getByRole("button", { name: /^merge$/i })).not.toBeDisabled();
  });
  it("zero-live disables merge, keeps dismiss/keep-both", () => {
    render(<MatchReviewCard match={{ ...single, candidates: [] }} {...handlers()} />);
    expect(screen.getByRole("button", { name: /^merge$/i })).toBeDisabled();
    expect(screen.getByRole("button", { name: /dismiss/i })).toBeEnabled();
  });
});
```

- [ ] **Step 3: Run — expect FAIL. Step 4: Implement** `MatchReviewCard.tsx` (`'use client'`): render bank row + candidate row(s); single candidate → auto-selected; multiple → radios (selected id in `useState`, none preselected); Merge button `disabled={!selectedId || resolving}` opens a local `confirmOpen` state → `<ConfirmDialog>` whose `onConfirm` does **close-then-async**: `setConfirmOpen(false); onMerge(match.candidateId, selectedId!)`. Keep-both `onClick={() => onKeepBoth(match.candidateId)}`, Dismiss `onClick={() => onDismiss(match.candidateId)}`, both `disabled={resolving}`. `showAccount` renders `match.accountName`. All labels via `useTranslations('import')` `matchReview.*`.

- [ ] **Step 5: Run — expect PASS. Step 6: Commit.**

---

## Task 9: `MatchReviewList`

**Files:** Create `frontend/src/components/import/MatchReviewList.tsx` + `.test.tsx`.

**Interfaces:**
- Consumes: `MatchReviewCard`, `importMatchesApi`, `PendingMatch`.
- Produces: `<MatchReviewList matches onResolved?(candidateId) showAccount? />` — owns calling `importMatchesApi.{merge,keepBoth,dismiss}`, per-card `resolving`, code-based conflict handling, empty state.

- [ ] **Step 1: Failing tests** — success removes/greys a card + calls `onResolved`; a rejected merge with `err.response.data.code === "already_resolved"` is treated benign (no error toast; card resolved); `code === "target_ineligible"` surfaces an error toast and keeps the card; empty `matches` renders the `matchReview.empty` string. Mock `@/lib/import-matches` and `react-hot-toast`.
```ts
vi.mock("@/lib/import-matches", () => ({ importMatchesApi: { merge: vi.fn(), keepBoth: vi.fn(), dismiss: vi.fn() } }));
vi.mock("react-hot-toast", () => ({ default: { success: vi.fn(), error: vi.fn() } }));
// … assert toast.error NOT called for already_resolved; called for target_ineligible.
```

- [ ] **Step 2: Run — FAIL. Step 3: Implement** — a helper `isAlreadyResolved(err) => err?.response?.data?.code === "already_resolved"`. Each action: set that card `resolving`, `await` the api call in try/catch; on success or `isAlreadyResolved` → mark resolved + `onResolved?.(id)`; else `toast.error(t('matchReview.resolveError'))`; finally clear `resolving`. Empty → `<p>{t('matchReview.empty')}</p>`.

- [ ] **Step 4: PASS. Step 5: Commit.**

---

## Task 10: `MatchReviewStep` + wizard wiring

**Files:** Modify `frontend/src/app/import/import-utils.ts` (`ImportStep` union), `frontend/src/hooks/useImportWizard.ts` (single-file branch), `frontend/src/app/import/page.tsx` (switch + `stepOrder`); Create `frontend/src/components/import/MatchReviewStep.tsx` + `.test.tsx`.

**Interfaces:**
- Produces: `ImportStep` includes `'matchReview'`; wizard routes single-file imports with matches to it; `<MatchReviewStep matches onDone />`.

- [ ] **Step 1: Failing wizard test** (extend `useImportWizard` tests): a single-file import whose `result.proposedMatches` is non-empty leaves `step === 'matchReview'`; empty/undefined → `'complete'`. (Mirror the existing single-file import test; mock `importFn` to resolve a result with/without `proposedMatches`.)

- [ ] **Step 2: FAIL. Step 3: Implement:**
  - `import-utils.ts`: add `'matchReview'` before `'complete'` in the union.
  - `useImportWizard.ts` single-file branch (lines 951-962): after `setImportResult(result)`, `setStep(result.proposedMatches?.length ? 'matchReview' : 'complete')` instead of always `'complete'`.
  - `page.tsx`: add a `case 'matchReview': return <MatchReviewStep matches={wizard.importResult?.proposedMatches ?? []} onDone={() => wizard.setStep('complete')} />;` and add `'matchReview'` to the `stepOrder` array (line 215) so it gets a progress dot.
  - `MatchReviewStep.tsx`: wraps `<MatchReviewList matches showAccount={false} onResolved={() => usePendingReviewsStore.getState().refresh()} />`; footer shows **Done** if all resolved else **Skip remaining →**, both `onClick={onDone}`. (Track resolved count locally.)

- [ ] **Step 4: `MatchReviewStep.test.tsx`** — renders the list; footer label flips Done/Skip on resolved count; clicking calls `onDone`. **Step 5: PASS. Step 6: Commit.**

---

## Task 11: Pending Reviews page + nav badge

**Files:** Create `frontend/src/app/import/matches/page.tsx` + a co-located or `__tests__` test; Modify `frontend/src/components/layout/AppHeader.tsx` (+ `MobileNavDrawer.tsx`); Modify `frontend/src/i18n/messages/en/navigation.json` (`pendingReviews`).

**Interfaces:** Consumes `importMatchesApi.list`, `MatchReviewList`, `usePendingReviewsStore`.

- [ ] **Step 1: Page test** — mock `@/lib/import-matches`; assert it fetches on mount, renders a `MatchReviewList` with the returned matches (`showAccount`), and shows the `matchReview.empty` string when the list is empty.

- [ ] **Step 2: FAIL. Step 3: Implement the page** — `ProtectedRoute → PageLayout → PageHeader title={t('pendingReviews')}`; `useEffect(() => { importMatchesApi.list().then(setMatches); usePendingReviewsStore.getState().refresh(); }, [])`; `<MatchReviewList matches={matches} showAccount onResolved={reloadListAndStore} />`.

- [ ] **Step 4: Nav badge** — in `AppHeader.tsx`: add `{ href: '/import/matches', labelKey: 'pendingReviews' }` to `toolsLinks`; subscribe `const pendingCount = usePendingReviewsStore((s) => s.count)`; call `usePendingReviewsStore.getState().refresh()` in a mount `useEffect`; render the badge for that link from `pendingCount` (not the static `link.badge`) using the existing amber badge span. Mirror in `MobileNavDrawer.tsx`. Add `pendingReviews` to `navigation.json`.

- [ ] **Step 5: PASS + `cd frontend && npx vitest run` green. Step 6: Commit.**

---

## Task 12: Bulk `matchesStaged` + CompleteStep pointer + open-view refresh

**Files:** Modify `useImportWizard.ts` (bulk loop), `frontend/src/components/import/CompleteStep.tsx` (+ test), `MatchReviewList.tsx` (emit refresh event), `frontend/src/app/transactions/page.tsx` + `frontend/src/app/accounts/page.tsx` (listen).

- [ ] **Step 1: Bulk sum** — in `useImportWizard.ts` bulk block: `let totalMatchesStaged = 0;` (init ~850), `totalMatchesStaged += result.proposedMatches?.length ?? 0;` (~873), include `matchesStaged: totalMatchesStaged` in `setBulkImportResult({...})` (~941). Test: a bulk import of two files each returning `proposedMatches` of length 2 → `bulkImportResult.matchesStaged === 4`.

- [ ] **Step 2: CompleteStep pointer** — in the `bulkImportResult &&` block, if `bulkImportResult.matchesStaged` `> 0`, render a `<li>`/banner "M matches from this import → Review" that `router.push('/import/matches')` (mirror the existing footer `router.push`). Test asserts the pointer shows with the count and navigates.

- [ ] **Step 3: Open-view refresh** — after a successful resolve, `MatchReviewList` dispatches `window.dispatchEvent(new CustomEvent('monize:transactions-changed'))`. In `app/transactions/page.tsx` and `app/accounts/page.tsx`, add a mount `useEffect` that adds a `window` listener for that event and re-runs the existing fetch (return the removeEventListener cleanup). Test (transactions page): dispatching the event triggers a refetch (spy the api).

- [ ] **Step 4: Run `cd frontend && npx vitest run` — green. Step 5: Commit.**

---

## Task 13: E2E live gate (Playwright)

**Files:** Modify `e2e/tests/import.spec.ts` (add specs); import `createTransaction` from `../helpers/factories`.

**Interfaces:** Consumes `authedPage`, `api`, `createAccount`, `createTransaction`, `uniqueId`.

- [ ] **Step 1: Merge spec** — seed an account + an UNRECONCILED transaction; import an inline OFX whose `<STMTTRN>` matches its amount+date; drive to the review step; Merge → confirm; assert the row is CLEARED and no duplicate.
```ts
test("import match review: merge folds the bank row into the pending transaction", async ({ authedPage: page, api }) => {
  const account = await createAccount(api, { name: `Match ${uniqueId()}` });
  await createTransaction(api, { accountId: account.id, amount: -11.04, transactionDate: "2026-07-02", payeeName: "Google", status: "UNRECONCILED" });
  const ofx = [
    "OFXHEADER:100", "DATA:OFXSGML", "VERSION:102", "", "<OFX><BANKMSGSRSV1><STMTTRNRS><STMTRS>",
    "<BANKTRANLIST>", "<STMTTRN><TRNTYPE>DEBIT<DTPOSTED>20260702<TRNAMT>-11.04",
    "<FITID>2026070200000110401<NAME>GOOGLE CLOUD</STMTTRN>",
    "</BANKTRANLIST></STMTRS></STMTTRNRS></BANKMSGSRSV1></OFX>",
  ].join("\n");
  await page.goto("/import");
  await page.locator('input[type="file"]').setInputFiles({ name: "match.ofx", mimeType: "text/plain", buffer: Buffer.from(ofx) });
  await expect(page.getByRole("heading", { name: /select destination account/i })).toBeVisible({ timeout: 15000 });
  await page.getByLabel(/import into account/i).selectOption({ value: account.id });
  await page.getByRole("button", { name: /^next$/i }).click();
  await expect(page.getByRole("heading", { name: /review import/i })).toBeVisible({ timeout: 10000 });
  await page.getByRole("button", { name: /import transactions/i }).click();
  // Review-matches step:
  await expect(page.getByRole("heading", { name: /review matches/i })).toBeVisible({ timeout: 15000 });
  await page.getByRole("button", { name: /^merge$/i }).first().click();
  await page.getByRole("button", { name: /^merge$/i }).last().click(); // confirm
  // Assert: no duplicate — exactly one row for this account+amount.
  const txns = await api.get<{ data: Array<{ amount: number; status: string; fitid?: string }> }>(`/transactions?accountId=${account.id}`);
  const matched = txns.data.filter((t) => Number(t.amount) === -11.04);
  expect(matched).toHaveLength(1);
  expect(matched[0].status).toBe("CLEARED");
});
```
(Confirm the exact `/transactions` list response shape via `transactionsApi.getAll` during implementation; adjust the assertion accessor if it is `{ transactions: [...] }`.)

- [ ] **Step 2: Keep-both + Dismiss specs** — Keep-both: assert two rows exist afterward (the manual UNRECONCILED + a new CLEARED). Dismiss: assert still one row (the manual UNRECONCILED, unchanged) and the badge/queue is empty.

- [ ] **Step 3: Run the e2e suite** `cd e2e && npx playwright test import.spec.ts` (needs the docker e2e stack up). **Step 4: Commit.**

---

## Self-Review

- **Spec coverage:** list normalize (T5), conflict codes + filter passthrough + merge ordering (T2, T3), Dismiss + migration (T1, T4), account context (T5), bulk matchesStaged (T12), open-view refresh (T12), confirm-guarded merge (T8), shared card/list (T8, T9), wizard step (T10), page + badge (T11), e2e live gate (T13). All spec sections map to a task.
- **Type consistency:** `PendingMatch`/`PendingMatchDto` fields identical across T5/T6; `importMatchesApi.merge → void`, `keepBoth → Transaction`, `dismiss → void` consistent T6→T9; conflict `code` values identical T2/T3/T9.
- **Deferred (spec non-goals, not gaps):** unmerge/recovery (T-556 #1), inline bulk review, multi-account QIF + investment matching, legacy backfill.

---
-- Claude Code 2026-07-03
