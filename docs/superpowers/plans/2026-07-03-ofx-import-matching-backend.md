# OFX/QIF/CSV Import Transaction Matching — Backend Spine Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give the import pipeline a matching engine so a bank `CLEARED` row is matched against a hand-entered `UNRECONCILED` row (amount + date window), staged for human review, and merged on confirm — instead of blindly inserting a duplicate.

**Architecture:** A `fitid` column + OFX parser extraction enables deterministic re-import dedup. In `ImportRegularProcessorService.processTransaction`, *after* the existing transfer checks, two new gates run: (1) FITID exact-dedup skips re-imports; (2) for incoming **CLEARED** rows only, an amount+date+account heuristic finds `UNRECONCILED` candidates and, on a hit, stages an `ImportMatchCandidate` row (buffered onto the import response, flushed only after the row's savepoint releases) instead of inserting. A separate `ImportMatchService` + controller resolves each staged match by **delegating to the vetted transaction paths**: **merge** = atomically claim → revalidate → `TransactionsService.update` (status `CLEARED` + adopt the bank's posted date, which recalculates balance) → balance-neutral marker copy; **keep both** = atomically claim → `TransactionsService.create` with `status:CLEARED`+`fitid` in one call (balance + net-worth handled by the vetted path, no post-insert stamp).

**Tech Stack:** NestJS, TypeORM (runtime-only, `synchronize: false`), PostgreSQL, custom SQL migrations, Jest (`ts-jest`, colocated `*.spec.ts`, **ES2021 target**).

## Codex Review

Adversarial plan-review by Codex/Wren, session `019f2974-dad8-7591-8bdb-a932dd0158df`.

**Round 1** — 5 Critical, 4 High, 3 Medium, all verified real and folded (FITID-after-transfers; atomic claim; revalidate; reuse create path; CLEARED-gated staging; optional context fields; transfer exclusion; dedupe guard; buffer-after-release; roundMoney; ES2021 tests; ParseUUIDPipe). Round-1 re-gate confirmed all 12 **RESOLVED**.

**Round 2** — the resolve-path fixes exposed 6 residuals (3 Crit / 2 High / 1 Med), all folded here:

| # | Sev | Finding | Fold |
|---|-----|---------|------|
| R2-1 | Crit | keepBoth create-then-stamp window → double-count on stamp failure | Task 6: `create()` sets `status:CLEARED`+`fitid` atomically (DTO spread) — **no post-insert stamp** |
| R2-2 | Crit | merge leaves a future-dated row → current-balance excludes it | Task 6: merge **adopts `bankDate`** via `update()`, which recalculates balance |
| R2-3 | Crit | staging race (check-then-insert, no unique constraint) → double keepBoth | Task 3: partial **UNIQUE index** on `(account_id, fitid) WHERE state='pending'` |
| R2-4 | High | `candidate.currencyCode` doesn't exist (compile blocker) | Task 6: fetch currency via `AccountsService.findOne` |
| R2-5 | High | claim runs outside the financial txn (crash window) | Accepted residual: claim-before is money-safe (stuck candidate ≫ double-charge); documented |
| R2-6 | Med | test mock invents `candidate.currencyCode`, hiding R2-4 | Task 6: test mocks `AccountsService.findOne` instead |

**R2-5 residual (documented, accepted):** resolves do the atomic claim (a conditional `UPDATE … WHERE state='pending'`, `affected===1`) *before* the financial action, and revert to `pending` if that action throws before committing. A process crash *between* claim and action leaves a candidate stuck in `merged`/`kept` with no/partial financial effect — **recoverable and never a balance corruption** (a stuck candidate is strictly safer than a double-charge). Full cross-service atomicity would require a shared transaction across `ImportMatchService` and `TransactionsService`; out of scope for v1. Keep-both is a single vetted `create` call, so its only crash window is claim→create (leaves a stuck `kept` candidate, no row).

## Global Constraints

- **Branch:** `t-235-ofx-import-matching` (monize repo). Do all work here.
- **Migrations are custom SQL, NOT TypeORM.** Idempotent files `database/migrations/NNN_*.sql`; **next free = `090`**. `ADD COLUMN IF NOT EXISTS` / `CREATE TABLE IF NOT EXISTS` / `CREATE [UNIQUE] INDEX IF NOT EXISTS`. **Never** `npm run migration:generate`. Mirror every DDL change into `database/schema.sql`. Playbook: `database/CLAUDE.md`.
- **Apply migrations (bare-metal Manor):** `./scripts/rebuild.sh --migrate-only` or `--backend-only`.
- **Match gates (exact):** incoming row must derive to **CLEARED** (`qifTx.cleared && !qifTx.void && !qifTx.reconciled`); candidate rows same **target** account (`ctx.accountId`, never OFX `BANKACCTFROM`), `UNRECONCILED`, `is_split=false`, `is_transfer=false`, `linked_transaction_id IS NULL`; **exact `roundMoney`-canonicalized amount**; `|transaction_date − bank date| ≤ 7 days`. **Never** gate on payee.
- **Amount canonicalization:** `roundMoney(Number(qifTx.amount))` ONCE for matching + staging.
- **Merge rule:** flip user's row to `CLEARED`; **adopt the bank's posted date** (`transactionDate = bankDate`) via `TransactionsService.update` so balance recalculates correctly for a formerly-future row; copy `fitid` + `referenceNumber`; backfill `description` **only if empty**; **never overwrite `payeeName`/`payeeId`/`categoryId`**.
- **Keep-both rule:** create through `TransactionsService.create` with `status:CLEARED` + `fitid` set in the DTO (create spreads DTO fields into the entity), `currencyCode` fetched from the account. One atomic vetted call — balance (`updateBalance`, 4-dp) + `netWorthService.triggerDebouncedRecalc` fire like a normal create. **No post-insert stamp.**
- **Resolve atomicity:** each resolve revalidates the target (still `UNRECONCILED`, same account, non-split, non-transfer), then atomically **claims** the candidate (`UPDATE … WHERE id=? AND user_id=? AND state='pending'`, `affected===1` → else `ConflictException`) *before* the financial action; reverts to `pending` iff the balance-affecting action throws before commit. Balance-neutral marker copies (fitid/ref/description) that fail leave the claim as-is (row already correct; no retry → no double-process). See R2-5 residual.
- **Persistence idiom:** `repo.update(id, { ...partial })` / `manager.update(Transaction, id, {...})` (not `save`).
- **Test target is ES2021** — no `Array.prototype.at`; use `arr[arr.length - 1]`.
- **Legacy backlog:** UNRECONCILED-only matcher (Accept + backfill). `/built-in-reports/duplicate-transactions` is the fallback. Optional backfill = Task 7 (deferred).
- **Scope:** backend only. Frontend review UX = separate follow-on plan.
- **Test commands:** single file `npm test -- <path>`; single case `npx jest <path> -t "<name>"`.
- **Design spec:** `docs/superpowers/specs/2026-07-03-ofx-import-transaction-matching-design.md`.

## File Structure

**Create:** `database/migrations/090_transaction_fitid.sql`, `091_import_match_candidate.sql`; `backend/src/import/entities/import-match-candidate.entity.ts`; `backend/src/import/import-match.util.ts` + `.spec.ts`; `backend/src/import/import-match.service.ts` + `.spec.ts`; `backend/src/import/import-match.controller.ts`.

**Modify:** `database/schema.sql`; `backend/src/transactions/entities/transaction.entity.ts` (`fitid`); `backend/src/transactions/dto/create-transaction.dto.ts` (`fitid?`); `backend/src/import/qif-parser.ts` (`fitid?`); `backend/src/import/ofx-parser.ts` (+ spec); `backend/src/import/dto/import.dto.ts` (`ProposedMatchDto`, `MergeMatchDto`, `proposedMatches?`); `backend/src/import/import-context.ts` (`importBatchId?`, `stagedThisRow?`); `backend/src/import/import.service.ts` (batch id at both sites; per-row flush); `backend/src/import/import-regular-processor.service.ts` (+ spec); `backend/src/import/import.module.ts` (register + import TransactionsModule/AccountsModule).

---

### Task 1: `fitid` column on transactions

**Files:** Create `database/migrations/090_transaction_fitid.sql`; Modify `database/schema.sql:244-268`, `backend/src/transactions/entities/transaction.entity.ts:103-116`.

**Interfaces:** Produces `Transaction.fitid: string | null`, partial index `idx_transactions_user_account_fitid`.

- [ ] **Step 1: Migration** — `database/migrations/090_transaction_fitid.sql`:

```sql
-- 090_transaction_fitid.sql
-- OFX/QIF/CSV import matching (t-235): store the bank-provided FITID on
-- transactions so re-imports can be de-duplicated. NULL for hand-entered rows
-- and for QIF/CSV imports (no FITID in those formats).
ALTER TABLE transactions
    ADD COLUMN IF NOT EXISTS fitid VARCHAR(64) NULL;

CREATE INDEX IF NOT EXISTS idx_transactions_user_account_fitid
    ON transactions (user_id, account_id, fitid)
    WHERE fitid IS NOT NULL;
```

- [ ] **Step 2: Mirror `schema.sql`** — add `fitid VARCHAR(64),` in the `transactions` block (after `reference_number`), and the index alongside the other `transactions` indexes.
- [ ] **Step 3: Entity property** — after `referenceNumber` (line 109):

```ts
  @Column({ type: "varchar", name: "fitid", length: 64, nullable: true })
  fitid: string | null;
```

- [ ] **Step 4: Apply** — `cd ~/Gentoo_Dev/monize && ./scripts/rebuild.sh --migrate-only`.
- [ ] **Step 5: Verify** — `psql -U postgres -d monize -c "\d transactions" | grep -E "fitid|idx_transactions_user_account_fitid"`.
- [ ] **Step 6: Compile** — `cd ~/Gentoo_Dev/monize/backend && npx tsc --noEmit`.
- [ ] **Step 7: Commit** — `git commit -m "feat(t-235): add fitid column to transactions for import dedup"`.

---

### Task 2: Extract FITID in the OFX parser

**Files:** Modify `qif-parser.ts:27-53`, `ofx-parser.ts:205-240`; Test `ofx-parser.spec.ts`.

**Interfaces:** Produces `QifTransaction.fitid?: string`.

- [ ] **Step 1: Failing test** — `backend/src/import/ofx-parser.spec.ts`:

```ts
import { parseOfx } from "./ofx-parser";

const OFX_FIXTURE = `<OFX><BANKMSGSRSV1><STMTTRNRS><STMTRS>
<BANKACCTFROM><ACCTTYPE>CHECKING</BANKACCTFROM>
<BANKTRANLIST>
<STMTTRN><TRNTYPE>DEBIT<DTPOSTED>20260702040000.000<TRNAMT>-11.04<FITID>20260702000000011041<NAME>VISA DDA PUR AP 469216 GOOG<MEMO>GOOGLE CLOUD</STMTTRN>
</BANKTRANLIST></STMTRS></STMTTRNRS></BANKMSGSRSV1></OFX>`;

describe("parseOfx FITID extraction", () => {
  it("captures the FITID onto the parsed transaction", () => {
    const result = parseOfx(OFX_FIXTURE);
    expect(result.transactions).toHaveLength(1);
    expect(result.transactions[0].fitid).toBe("20260702000000011041");
    expect(result.transactions[0].amount).toBe(-11.04);
  });
});
```

- [ ] **Step 2: Fails** — `npm test -- src/import/ofx-parser.spec.ts -t "captures the FITID"`.
- [ ] **Step 3: Interface field** — in `qif-parser.ts`, after `number: string;`: `fitid?: string;` (with a doc comment).
- [ ] **Step 4: Extract** — in `ofx-parser.ts` after `const checkNum = getTagValue(block, "CHECKNUM");`:

```ts
    const fitidRaw = getTagValue(block, "FITID");
    const fitid = fitidRaw ? truncate(fitidRaw, 64) : undefined;
```

add `fitid,` to the `tx` literal.

- [ ] **Step 5: Passes** — `npm test -- src/import/ofx-parser.spec.ts -t "captures the FITID"`.
- [ ] **Step 6: Commit** — `git commit -m "feat(t-235): extract OFX FITID into parsed transaction"`.

---

### Task 3: `ImportMatchCandidate` staging table + entity

**Files:** Create `database/migrations/091_import_match_candidate.sql`, `backend/src/import/entities/import-match-candidate.entity.ts`; Modify `database/schema.sql`, `backend/src/import/import.module.ts:23-33`.

**Interfaces:** Produces `ImportMatchCandidate` (fields `id, userId, accountId, importBatchId, bankAmount, bankDate, fitid, bankName, bankMemo, bankReference, candidateTransactionIds: string[], state, createdAt, updatedAt`).

- [ ] **Step 1: Migration** — `database/migrations/091_import_match_candidate.sql`:

```sql
-- 091_import_match_candidate.sql
-- OFX/QIF/CSV import matching (t-235): staging store for proposed matches between
-- an incoming bank row and existing UNRECONCILED transaction(s). Survives dismissal
-- of the post-import review dialog. The bank row is NOT inserted until resolved.
CREATE TABLE IF NOT EXISTS import_match_candidate (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    account_id UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
    import_batch_id UUID NOT NULL,
    bank_amount NUMERIC(20, 4) NOT NULL,
    bank_date DATE NOT NULL,
    fitid VARCHAR(64),
    bank_name VARCHAR(255),
    bank_memo TEXT,
    bank_reference VARCHAR(100),
    candidate_transaction_ids JSONB NOT NULL DEFAULT '[]'::jsonb,
    state VARCHAR(20) NOT NULL DEFAULT 'pending',
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT import_match_candidate_state_check
      CHECK (state IN ('pending', 'merged', 'kept'))
);
CREATE INDEX IF NOT EXISTS idx_import_match_candidate_batch
    ON import_match_candidate (import_batch_id);
CREATE INDEX IF NOT EXISTS idx_import_match_candidate_user_state
    ON import_match_candidate (user_id, state);
-- Sequential dedupe fast-path (Task 5): look up pending candidates by acct+amount+date.
CREATE INDEX IF NOT EXISTS idx_import_match_candidate_dedupe
    ON import_match_candidate (account_id, state, bank_amount, bank_date);
-- Race guard (R2-3): at most one PENDING candidate per account+fitid. A second
-- concurrent import staging the same OFX fitid loses the insert (23505); its
-- per-row savepoint rolls back — money-safe (no double stage), tiny UX cost.
CREATE UNIQUE INDEX IF NOT EXISTS uq_import_match_candidate_pending_fitid
    ON import_match_candidate (account_id, fitid)
    WHERE state = 'pending' AND fitid IS NOT NULL;
```

- [ ] **Step 2: Mirror `schema.sql`** — append the full `CREATE TABLE` + **all four** index statements (three plain + the partial UNIQUE).

- [ ] **Step 3: Entity** — `backend/src/import/entities/import-match-candidate.entity.ts`:

```ts
import {
  Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, UpdateDateColumn,
} from "typeorm";

export type ImportMatchState = "pending" | "merged" | "kept";

@Entity("import_match_candidate")
export class ImportMatchCandidate {
  @PrimaryGeneratedColumn("uuid")
  id: string;

  @Column({ type: "uuid", name: "user_id" })
  userId: string;

  @Column({ type: "uuid", name: "account_id" })
  accountId: string;

  @Column({ type: "uuid", name: "import_batch_id" })
  importBatchId: string;

  @Column({ type: "decimal", precision: 20, scale: 4, name: "bank_amount" })
  bankAmount: number;

  @Column({ type: "date", name: "bank_date" })
  bankDate: string;

  @Column({ type: "varchar", length: 64, nullable: true })
  fitid: string | null;

  @Column({ type: "varchar", length: 255, name: "bank_name", nullable: true })
  bankName: string | null;

  @Column({ type: "text", name: "bank_memo", nullable: true })
  bankMemo: string | null;

  @Column({ type: "varchar", length: 100, name: "bank_reference", nullable: true })
  bankReference: string | null;

  @Column({ type: "jsonb", name: "candidate_transaction_ids", default: () => "'[]'" })
  candidateTransactionIds: string[];

  @Column({ type: "varchar", length: 20, default: "pending" })
  state: ImportMatchState;

  @CreateDateColumn({ name: "created_at" })
  createdAt: Date;

  @UpdateDateColumn({ name: "updated_at" })
  updatedAt: Date;
}
```

- [ ] **Step 4: Register** — `import.module.ts`: import + add `ImportMatchCandidate` to `TypeOrmModule.forFeature([...])`.
- [ ] **Step 5: Apply** — `./scripts/rebuild.sh --migrate-only`.
- [ ] **Step 6: Verify** — `psql -U postgres -d monize -c "\d import_match_candidate"` (columns, 4 indexes incl. the unique, check constraint).
- [ ] **Step 7: Compile** — `npx tsc --noEmit`.
- [ ] **Step 8: Commit** — `git commit -m "feat(t-235): add import_match_candidate staging table + entity"`.

---

### Task 4: FITID re-import dedup + stamp fitid on inserts

> **Crit #1 fold:** dedup runs **after** the transfer checks.

**Files:** Modify `import-regular-processor.service.ts:19-83`; Test its spec.

**Interfaces:** Produces private `isFitidDuplicate(ctx, qifTx)`; inserts carry `fitid`.

- [ ] **Step 1: Failing tests** — add to `import-regular-processor.service.spec.ts`:

```ts
describe("FITID dedup", () => {
  it("skips an incoming row whose FITID already exists in the account", async () => {
    const ctx = makeContext();
    (ctx.queryRunner.manager.createQueryBuilder as jest.Mock).mockReturnValue(
      makeMockQueryBuilder({}), // getCount -> 1
    );
    await service.processTransaction(ctx, {
      date: "2026-07-02", amount: -11.04, payee: "Google", memo: "",
      number: "", fitid: "20260702000000011041",
      cleared: true, reconciled: false, isTransfer: false,
      transferAccount: "", splits: [], tagNames: [],
    });
    expect(ctx.importResult.skipped).toBe(1);
    expect(ctx.importResult.imported).toBe(0);
    expect(ctx.queryRunner.manager.save).not.toHaveBeenCalled();
  });

  it("stamps the FITID onto a newly inserted transaction", async () => {
    const ctx = makeContext();
    await service.processTransaction(ctx, {
      date: "2026-07-02", amount: -11.04, payee: "Google", memo: "GOOGLE CLOUD",
      number: "", fitid: "20260702000000011041",
      cleared: true, reconciled: false, isTransfer: false,
      transferAccount: "", splits: [], tagNames: [],
    });
    const calls = (ctx.queryRunner.manager.create as jest.Mock).mock.calls;
    const created = calls[calls.length - 1];
    expect(created[1]).toEqual(expect.objectContaining({ fitid: "20260702000000011041" }));
    expect(ctx.importResult.imported).toBe(1);
  });
});
```

- [ ] **Step 2: Fails** — `npm test -- src/import/import-regular-processor.service.spec.ts -t "FITID dedup"`.
- [ ] **Step 3: Method** — near `isDuplicateTransfer` (line 112):

```ts
  private async isFitidDuplicate(
    ctx: ImportContext,
    qifTx: any,
  ): Promise<boolean> {
    if (!qifTx.fitid) return false;
    const existingCount = await ctx.queryRunner.manager
      .createQueryBuilder(Transaction, "t")
      .where("t.user_id = :userId", { userId: ctx.userId })
      .andWhere("t.account_id = :accountId", { accountId: ctx.accountId })
      .andWhere("t.fitid = :fitid", { fitid: qifTx.fitid })
      .getCount();
    return existingCount > 0;
  }
```

- [ ] **Step 4: Call after transfers + stamp on insert** — in `processTransaction`, after the `matchPendingTransfer` block (after line 30):

```ts
    // Re-import guard: skip a row already imported under the same bank FITID.
    // MUST run after the transfer checks so it never short-circuits transfer
    // duplicate-counting (which must observe every same-signature row).
    if (await this.isFitidDuplicate(ctx, qifTx)) {
      ctx.importResult.skipped++;
      return;
    }
```

In the `create(Transaction, { ... })` literal (line 66), after `referenceNumber: qifTx.number,`: `fitid: qifTx.fitid ?? null,`.

- [ ] **Step 5: Passes** — `npm test -- src/import/import-regular-processor.service.spec.ts -t "FITID dedup"`.
- [ ] **Step 6: Full processor spec** — `npm test -- src/import/import-regular-processor.service.spec.ts` (transfer-dedup tests still green).
- [ ] **Step 7: Commit** — `git commit -m "feat(t-235): FITID re-import dedup (post-transfer) + stamp fitid on inserts"`.

---

### Task 5: CLEARED-gated candidate detection, dedupe-guarded staging, buffered payload

> Folds Crit #5, High #6/#7/#8/#9, Med #10. Concurrency backstop = the partial UNIQUE index from Task 3 (R2-3).

**Files:** Create `import-match.util.ts` + `.spec.ts`; Modify `dto/import.dto.ts`, `import-context.ts`, `import.service.ts`, `import-regular-processor.service.ts` (+ spec).

- [ ] **Step 1: Failing window test** — `backend/src/import/import-match.util.spec.ts`:

```ts
import { matchDateWindow } from "./import-match.util";

describe("matchDateWindow", () => {
  it("returns a symmetric ±7-day window by default", () => {
    expect(matchDateWindow("2026-07-01")).toEqual({ lo: "2026-06-24", hi: "2026-07-08" });
  });
  it("crosses month boundaries correctly", () => {
    expect(matchDateWindow("2026-03-03")).toEqual({ lo: "2026-02-24", hi: "2026-03-10" });
  });
  it("honours a custom day count", () => {
    expect(matchDateWindow("2026-07-01", 3)).toEqual({ lo: "2026-06-28", hi: "2026-07-04" });
  });
});
```

- [ ] **Step 2: Fails** — `npm test -- src/import/import-match.util.spec.ts`.
- [ ] **Step 3: Helper** — `backend/src/import/import-match.util.ts`:

```ts
/** Inclusive ±`days` window around an ISO YYYY-MM-DD date, as ISO strings.
 *  UTC math avoids local-timezone drift. */
export function matchDateWindow(
  date: string,
  days = 7,
): { lo: string; hi: string } {
  const base = new Date(`${date}T00:00:00Z`);
  const lo = new Date(base);
  lo.setUTCDate(base.getUTCDate() - days);
  const hi = new Date(base);
  hi.setUTCDate(base.getUTCDate() + days);
  const fmt = (d: Date): string => d.toISOString().slice(0, 10);
  return { lo: fmt(lo), hi: fmt(hi) };
}
```

- [ ] **Step 4: Passes** — `npm test -- src/import/import-match.util.spec.ts`.

- [ ] **Step 5: DTOs** — in `dto/import.dto.ts`, before `ImportResultDto`:

```ts
export class ProposedMatchDto {
  @ApiProperty()
  candidateId: string;

  @ApiProperty()
  bankAmount: number;

  @ApiProperty()
  bankDate: string;

  @ApiPropertyOptional()
  bankName?: string;

  @ApiProperty({
    description: "Existing UNRECONCILED transactions this bank row may match",
    type: [Object],
  })
  candidates: Array<{
    id: string;
    transactionDate: string;
    amount: number;
    payeeName: string | null;
    description: string | null;
  }>;
}
```

Inside `ImportResultDto`:

```ts
  @ApiPropertyOptional({
    type: [ProposedMatchDto],
    description:
      "Incoming CLEARED rows matched against existing UNRECONCILED transactions, staged for review instead of inserted",
  })
  proposedMatches?: ProposedMatchDto[];
```

- [ ] **Step 6: Context + orchestrator** — in `import-context.ts` add (both optional; add `import type { ProposedMatchDto } from "./dto/import.dto";`):

```ts
  /** Groups all staged match candidates produced by one import run. */
  importBatchId?: string;
  /** Per-transaction staging buffer, flushed to importResult.proposedMatches
   *  only after the row's savepoint is released (avoids rollback desync). */
  stagedThisRow?: ProposedMatchDto[];
```

In `import.service.ts`: `import { randomUUID } from "crypto";`; set `importBatchId = randomUUID()` into the **single-account** context (~1232) **and** the **multi-account** context (~378). In the per-row loop (~1297-1330): before `processTransaction`, `ctx.stagedThisRow = [];`. After the successful `RELEASE SAVEPOINT`:

```ts
        if (ctx.stagedThisRow && ctx.stagedThisRow.length > 0) {
          importResult.proposedMatches = [
            ...(importResult.proposedMatches ?? []),
            ...ctx.stagedThisRow,
          ];
        }
```

Do **not** flush in the `ROLLBACK TO SAVEPOINT` catch.

- [ ] **Step 7: Failing staging test** — add to the processor spec (extend `makeImportResult` with `proposedMatches: []`, `makeContext` with `importBatchId: "batch-1"`, `stagedThisRow: []`):

```ts
describe("heuristic match staging", () => {
  const clearedBankRow = (over = {}) => ({
    date: "2026-07-02", amount: -11.04, payee: "Google", memo: "GOOGLE CLOUD",
    number: "", fitid: "20260702000000011041",
    cleared: true, reconciled: false, void: false, isTransfer: false,
    transferAccount: "", splits: [], tagNames: [], ...over,
  });

  it("stages a candidate and does NOT insert a Transaction when an UNRECONCILED row matches", async () => {
    const existing = { id: "txn-existing", transactionDate: "2026-07-02", amount: -11.04, payeeName: "Google", description: null };
    const ctx = makeContext();
    const dedupeQb = makeMockQueryBuilder();       // isFitidDuplicate getCount -> 0
    const candQb = makeMockQueryBuilder(existing); // findMatchCandidates getMany -> [existing]
    const stageDedupeQb = makeMockQueryBuilder();  // pre-stage dedupe getCount -> 0
    (ctx.queryRunner.manager.createQueryBuilder as jest.Mock)
      .mockReturnValueOnce(dedupeQb).mockReturnValueOnce(candQb).mockReturnValueOnce(stageDedupeQb);
    await service.processTransaction(ctx, clearedBankRow());
    expect(ctx.stagedThisRow).toHaveLength(1);
    expect(ctx.stagedThisRow![0].candidates[0].id).toBe("txn-existing");
    expect(ctx.importResult.imported).toBe(0);
    const createdTypes = (ctx.queryRunner.manager.create as jest.Mock).mock.calls.map((c) => c[0]?.name);
    expect(createdTypes).not.toContain("Transaction");
    expect(createdTypes).toContain("ImportMatchCandidate");
  });

  it("does NOT stage a non-CLEARED (void) incoming row", async () => {
    const ctx = makeContext();
    await service.processTransaction(ctx, clearedBankRow({ void: true, cleared: false }));
    expect(ctx.stagedThisRow).toHaveLength(0);
  });
});
```

- [ ] **Step 8: Fails** — `npm test -- src/import/import-regular-processor.service.spec.ts -t "heuristic match staging"`.

- [ ] **Step 9: Detection + guarded staging** — add imports (`ImportMatchCandidate`, `matchDateWindow`, `roundMoney`) and methods:

```ts
  private async findMatchCandidates(
    ctx: ImportContext,
    qifTx: any,
  ): Promise<Transaction[]> {
    if (!ctx.importBatchId) return [];
    // Only incoming rows that would become CLEARED (bank-posted). Never
    // VOID/RECONCILED/uncleared, transfers, or splits.
    if (!qifTx.cleared || qifTx.void || qifTx.reconciled) return [];
    if (qifTx.isTransfer || (qifTx.splits && qifTx.splits.length > 0)) return [];
    const amount = roundMoney(Number(qifTx.amount));
    const { lo, hi } = matchDateWindow(qifTx.date, 7);
    return ctx.queryRunner.manager
      .createQueryBuilder(Transaction, "t")
      .where("t.user_id = :userId", { userId: ctx.userId })
      .andWhere("t.account_id = :accountId", { accountId: ctx.accountId })
      .andWhere("t.status = :status", { status: TransactionStatus.UNRECONCILED })
      .andWhere("t.is_split = false")
      .andWhere("t.is_transfer = false")
      .andWhere("t.linked_transaction_id IS NULL")
      .andWhere("t.amount = :amount", { amount })
      .andWhere("t.transaction_date BETWEEN :lo AND :hi", { lo, hi })
      .getMany();
  }

  private async stageMatchCandidate(
    ctx: ImportContext,
    qifTx: any,
    candidates: Transaction[],
  ): Promise<void> {
    const amount = roundMoney(Number(qifTx.amount));
    // Sequential dedupe fast-path: skip a second pending candidate for the same
    // account/amount/date(/fitid). (Concurrent imports are backstopped by the
    // partial UNIQUE index uq_import_match_candidate_pending_fitid — a losing
    // insert 23505s and its per-row savepoint rolls back: money-safe.)
    const existingQb = ctx.queryRunner.manager
      .createQueryBuilder(ImportMatchCandidate, "c")
      .where("c.account_id = :accountId", { accountId: ctx.accountId })
      .andWhere("c.state = :state", { state: "pending" })
      .andWhere("c.bank_amount = :amount", { amount })
      .andWhere("c.bank_date = :date", { date: qifTx.date });
    if (qifTx.fitid) existingQb.andWhere("c.fitid = :fitid", { fitid: qifTx.fitid });
    if ((await existingQb.getCount()) > 0) return;

    const candidate = ctx.queryRunner.manager.create(ImportMatchCandidate, {
      userId: ctx.userId,
      accountId: ctx.accountId,
      importBatchId: ctx.importBatchId,
      bankAmount: amount,
      bankDate: qifTx.date,
      fitid: qifTx.fitid ?? null,
      bankName: qifTx.payee || null,
      bankMemo: qifTx.memo || null,
      bankReference: qifTx.number || null,
      candidateTransactionIds: candidates.map((c) => c.id),
      state: "pending",
    });
    const saved = await ctx.queryRunner.manager.save(candidate);
    if (!ctx.stagedThisRow) ctx.stagedThisRow = [];
    ctx.stagedThisRow.push({
      candidateId: saved.id,
      bankAmount: amount,
      bankDate: qifTx.date,
      bankName: qifTx.payee || undefined,
      candidates: candidates.map((c) => ({
        id: c.id,
        transactionDate: c.transactionDate,
        amount: Number(c.amount),
        payeeName: c.payeeName,
        description: c.description,
      })),
    });
  }
```

Wire into `processTransaction`, after FITID dedup (Task 4) and before `resolvePayee`:

```ts
    // Match incoming CLEARED bank rows against hand-entered UNRECONCILED rows.
    const matchCandidates = await this.findMatchCandidates(ctx, qifTx);
    if (matchCandidates.length > 0) {
      await this.stageMatchCandidate(ctx, qifTx, matchCandidates);
      return;
    }
```

- [ ] **Step 10: Passes** — `npm test -- src/import/import-regular-processor.service.spec.ts -t "heuristic match staging"`.
- [ ] **Step 11: Full import specs + compile** — `npm test -- src/import && npx tsc --noEmit`.
- [ ] **Step 12: Commit** — `git commit -m "feat(t-235): stage CLEARED matches for review (dedupe-guarded, rollback-safe)"`.

---

### Task 6: Resolve API — merge / keep-both / list (vetted-path delegation, atomic claim)

> Folds Crit #2/#3/#4 and R2-1..R2-6. **keepBoth** = one atomic `create` (status+fitid in the DTO). **merge** = `update` (status + adopt bank date → balance recalc) + balance-neutral marker copy.

**Files:** Create `import-match.service.ts` + `.spec.ts`, `import-match.controller.ts`; Modify `dto/import.dto.ts` (`MergeMatchDto`), `dto/create-transaction.dto.ts` (`fitid?`), `import.module.ts`.

**Interfaces:** Consumes `ImportMatchCandidate`, `Transaction`, `TransactionStatus`, `TransactionsService.create`/`.update`, `AccountsService.findOne`. Produces `listPending`/`merge`/`keepBoth`; routes `GET import/matches`, `POST import/matches/:id/merge`, `POST import/matches/:id/keep-both`.

- [ ] **Step 1: Add `fitid` to `CreateTransactionDto`** — in `backend/src/transactions/dto/create-transaction.dto.ts` (imports `IsOptional`, `IsString`, `MaxLength` from `class-validator`; `ApiPropertyOptional` from `@nestjs/swagger`):

```ts
  @ApiPropertyOptional({ description: "Bank FITID (import dedup); normally set only by import matching" })
  @IsOptional()
  @IsString()
  @MaxLength(64)
  fitid?: string;
```

`create()` spreads `...transactionData` into the entity, so this persists `fitid` at insert with no extra step. (`UpdateTransactionDto = PartialType(CreateTransactionDto)` inherits it, but `update()` enumerates fields, so `merge` copies `fitid` via the balance-neutral marker update, not through `update()`.)

- [ ] **Step 2: Add `MergeMatchDto`** — in `dto/import.dto.ts` (`IsUUID` from `class-validator`):

```ts
export class MergeMatchDto {
  @ApiProperty({ description: "The UNRECONCILED transaction to merge the bank row into" })
  @IsUUID()
  transactionId: string;
}
```

- [ ] **Step 3: Failing service tests** — `backend/src/import/import-match.service.spec.ts`:

```ts
import { Test, TestingModule } from "@nestjs/testing";
import { getRepositoryToken } from "@nestjs/typeorm";
import { ConflictException } from "@nestjs/common";
import { ImportMatchService } from "./import-match.service";
import { ImportMatchCandidate } from "./entities/import-match-candidate.entity";
import { Transaction, TransactionStatus } from "../transactions/entities/transaction.entity";
import { TransactionsService } from "../transactions/transactions.service";
import { AccountsService } from "../accounts/accounts.service";

describe("ImportMatchService", () => {
  let service: ImportMatchService;
  let candidateRepo: any;
  let transactionsRepo: any;
  let txService: any;
  let accountsService: any;

  beforeEach(async () => {
    candidateRepo = {
      find: jest.fn(),
      findOne: jest.fn(),
      update: jest.fn().mockResolvedValue({ affected: 1 }), // conditional claim wins
    };
    transactionsRepo = {
      findOne: jest.fn(),
      update: jest.fn().mockResolvedValue({ affected: 1 }),
    };
    txService = {
      create: jest.fn().mockResolvedValue({ id: "new-txn", status: TransactionStatus.CLEARED }),
      update: jest.fn().mockResolvedValue({ id: "txn-1", status: TransactionStatus.CLEARED }),
    };
    accountsService = { findOne: jest.fn().mockResolvedValue({ id: "acc-1", currencyCode: "USD" }) };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ImportMatchService,
        { provide: getRepositoryToken(ImportMatchCandidate), useValue: candidateRepo },
        { provide: getRepositoryToken(Transaction), useValue: transactionsRepo },
        { provide: TransactionsService, useValue: txService },
        { provide: AccountsService, useValue: accountsService },
      ],
    }).compile();
    service = module.get(ImportMatchService);
  });

  const pendingCandidate = (over = {}) => ({
    id: "cand-1", userId: "u1", accountId: "acc-1", state: "pending",
    bankAmount: -11.04, bankDate: "2026-07-02", fitid: "F1",
    bankName: "Google", bankMemo: "BANK MEMO", bankReference: "R1",
    candidateTransactionIds: ["txn-1"], ...over,
  });
  const targetTxn = (over = {}) => ({
    id: "txn-1", userId: "u1", accountId: "acc-1", status: TransactionStatus.UNRECONCILED,
    isSplit: false, isTransfer: false, description: null, referenceNumber: null, ...over,
  });

  it("merge: claims, updates status+bankDate via TransactionsService.update, copies markers (keeps payee)", async () => {
    candidateRepo.findOne.mockResolvedValue(pendingCandidate());
    transactionsRepo.findOne.mockResolvedValue(targetTxn());
    await service.merge("u1", "cand-1", "txn-1");
    expect(candidateRepo.update).toHaveBeenCalledWith({ id: "cand-1", userId: "u1", state: "pending" }, { state: "merged" });
    expect(txService.update).toHaveBeenCalledWith("u1", "txn-1",
      expect.objectContaining({ status: TransactionStatus.CLEARED, transactionDate: "2026-07-02" }));
    // marker copy is balance-neutral and never touches payee/category:
    expect(transactionsRepo.update).toHaveBeenCalledWith("txn-1",
      expect.objectContaining({ fitid: "F1", referenceNumber: "R1", description: "BANK MEMO" }));
    expect(txService.update.mock.calls[0][2]).not.toHaveProperty("payeeName");
    expect(transactionsRepo.update.mock.calls[0][1]).not.toHaveProperty("payeeName");
  });

  it("merge does NOT overwrite an existing description", async () => {
    candidateRepo.findOne.mockResolvedValue(pendingCandidate());
    transactionsRepo.findOne.mockResolvedValue(targetTxn({ description: "my note" }));
    await service.merge("u1", "cand-1", "txn-1");
    expect(transactionsRepo.update.mock.calls[0][1].description).toBe("my note");
  });

  it("merge throws Conflict when the claim is lost (affected=0)", async () => {
    candidateRepo.findOne.mockResolvedValue(pendingCandidate());
    transactionsRepo.findOne.mockResolvedValue(targetTxn());
    candidateRepo.update.mockResolvedValueOnce({ affected: 0 });
    await expect(service.merge("u1", "cand-1", "txn-1")).rejects.toBeInstanceOf(ConflictException);
    expect(txService.update).not.toHaveBeenCalled();
  });

  it("merge revalidates: throws if the target is no longer UNRECONCILED (before claiming)", async () => {
    candidateRepo.findOne.mockResolvedValue(pendingCandidate());
    transactionsRepo.findOne.mockResolvedValue(targetTxn({ status: TransactionStatus.VOID }));
    await expect(service.merge("u1", "cand-1", "txn-1")).rejects.toBeInstanceOf(ConflictException);
    expect(candidateRepo.update).not.toHaveBeenCalled();
  });

  it("merge rejects a transactionId not in the candidate set", async () => {
    candidateRepo.findOne.mockResolvedValue(pendingCandidate());
    await expect(service.merge("u1", "cand-1", "txn-OTHER")).rejects.toBeInstanceOf(ConflictException);
  });

  it("keepBoth: claims, fetches currency, creates CLEARED+fitid in ONE create call", async () => {
    candidateRepo.findOne.mockResolvedValue(pendingCandidate({ bankAmount: -59.03, fitid: "F2", bankName: "DoorDash" }));
    await service.keepBoth("u1", "cand-1");
    expect(accountsService.findOne).toHaveBeenCalledWith("u1", "acc-1");
    expect(candidateRepo.update).toHaveBeenCalledWith({ id: "cand-1", userId: "u1", state: "pending" }, { state: "kept" });
    expect(txService.create).toHaveBeenCalledWith("u1", expect.objectContaining({
      accountId: "acc-1", amount: -59.03, transactionDate: "2026-07-02",
      currencyCode: "USD", status: TransactionStatus.CLEARED, fitid: "F2",
    }));
    // no post-insert stamp:
    expect(transactionsRepo.update).not.toHaveBeenCalled();
  });

  it("keepBoth reverts the claim to pending if create throws", async () => {
    candidateRepo.findOne.mockResolvedValue(pendingCandidate());
    txService.create.mockRejectedValueOnce(new Error("boom"));
    await expect(service.keepBoth("u1", "cand-1")).rejects.toThrow("boom");
    expect(candidateRepo.update).toHaveBeenLastCalledWith({ id: "cand-1" }, { state: "pending" });
  });

  it("listPending returns only this user's pending candidates", async () => {
    candidateRepo.find.mockResolvedValue([{ id: "c1" }]);
    const rows = await service.listPending("u1");
    expect(candidateRepo.find).toHaveBeenCalledWith({ where: { userId: "u1", state: "pending" }, order: { createdAt: "DESC" } });
    expect(rows).toHaveLength(1);
  });
});
```

- [ ] **Step 4: Fails** — `npm test -- src/import/import-match.service.spec.ts`.

- [ ] **Step 5: Implement the service** — `backend/src/import/import-match.service.ts`:

```ts
import {
  Injectable, NotFoundException, ConflictException, Inject, forwardRef, Logger,
} from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { Repository } from "typeorm";
import { ImportMatchCandidate, ImportMatchState } from "./entities/import-match-candidate.entity";
import { Transaction, TransactionStatus } from "../transactions/entities/transaction.entity";
import { TransactionsService } from "../transactions/transactions.service";
import { AccountsService } from "../accounts/accounts.service";

@Injectable()
export class ImportMatchService {
  private readonly logger = new Logger(ImportMatchService.name);

  constructor(
    @InjectRepository(ImportMatchCandidate)
    private readonly candidateRepo: Repository<ImportMatchCandidate>,
    @InjectRepository(Transaction)
    private readonly transactionsRepo: Repository<Transaction>,
    @Inject(forwardRef(() => TransactionsService))
    private readonly transactionsService: TransactionsService,
    private readonly accountsService: AccountsService,
  ) {}

  async listPending(userId: string): Promise<ImportMatchCandidate[]> {
    return this.candidateRepo.find({
      where: { userId, state: "pending" },
      order: { createdAt: "DESC" },
    });
  }

  private async loadOwned(userId: string, candidateId: string): Promise<ImportMatchCandidate> {
    const c = await this.candidateRepo.findOne({ where: { id: candidateId } });
    if (!c || c.userId !== userId) throw new NotFoundException("Match candidate not found");
    return c;
  }

  /** Atomically transition a pending candidate. True iff THIS call won the race. */
  private async claim(userId: string, candidateId: string, next: ImportMatchState): Promise<boolean> {
    const res = await this.candidateRepo.update(
      { id: candidateId, userId, state: "pending" },
      { state: next },
    );
    return res.affected === 1;
  }

  async merge(userId: string, candidateId: string, transactionId: string): Promise<void> {
    const candidate = await this.loadOwned(userId, candidateId);
    if (!candidate.candidateTransactionIds.includes(transactionId)) {
      throw new ConflictException("transactionId is not a candidate for this match");
    }
    // Revalidate BEFORE claiming (cheap fail-fast, avoids a needless claim/revert).
    const existing = await this.transactionsRepo.findOne({ where: { id: transactionId, userId } });
    if (
      !existing ||
      existing.accountId !== candidate.accountId ||
      existing.status !== TransactionStatus.UNRECONCILED ||
      existing.isSplit ||
      existing.isTransfer
    ) {
      throw new ConflictException("Transaction is no longer eligible to merge");
    }
    if (!(await this.claim(userId, candidateId, "merged"))) {
      throw new ConflictException("Match candidate already resolved");
    }
    try {
      // Balance-affecting change through the vetted path. Adopting the bank's
      // posted date fixes the future-dated current-balance exclusion (R2-2);
      // update() recalculates balance on the status/date change.
      await this.transactionsService.update(userId, transactionId, {
        status: TransactionStatus.CLEARED,
        transactionDate: candidate.bankDate,
      });
    } catch (err) {
      await this.candidateRepo.update({ id: candidateId }, { state: "pending" }); // revert; nothing committed
      throw err;
    }
    // Balance-neutral marker copy. If this fails, the row is already CLEARED and
    // balance-correct; leave the candidate 'merged' (retrying would double-process).
    try {
      await this.transactionsRepo.update(transactionId, {
        fitid: candidate.fitid,
        referenceNumber: candidate.bankReference ?? existing.referenceNumber,
        description: existing.description || candidate.bankMemo,
      });
    } catch (err) {
      this.logger.warn(`merge: marker copy failed for txn ${transactionId} (row CLEARED, balance correct): ${err}`);
    }
  }

  async keepBoth(userId: string, candidateId: string): Promise<Transaction> {
    const candidate = await this.loadOwned(userId, candidateId);
    const account = await this.accountsService.findOne(userId, candidate.accountId);
    if (!(await this.claim(userId, candidateId, "kept"))) {
      throw new ConflictException("Match candidate already resolved");
    }
    try {
      // Single atomic vetted call: create() spreads DTO fields into the entity,
      // so status=CLEARED and fitid are set at insert; balance + net-worth recalc
      // fire like a normal create. No post-insert stamp -> no double-count window.
      return await this.transactionsService.create(userId, {
        accountId: candidate.accountId,
        transactionDate: candidate.bankDate,
        amount: Number(candidate.bankAmount),
        currencyCode: account.currencyCode,
        payeeName: candidate.bankName ?? undefined,
        description: candidate.bankMemo ?? undefined,
        referenceNumber: candidate.bankReference ?? undefined,
        status: TransactionStatus.CLEARED,
        fitid: candidate.fitid ?? undefined,
      });
    } catch (err) {
      await this.candidateRepo.update({ id: candidateId }, { state: "pending" }); // revert; nothing created
      throw err;
    }
  }
}
```

- [ ] **Step 6: Passes** — `npm test -- src/import/import-match.service.spec.ts`.

- [ ] **Step 7: Controller (UUID-validated)** — `backend/src/import/import-match.controller.ts`:

```ts
import { Controller, Get, Post, Param, Body, Req, UseGuards, ParseUUIDPipe } from "@nestjs/common";
import { AuthGuard } from "@nestjs/passport";
import { ApiTags, ApiBearerAuth } from "@nestjs/swagger";
import { ImportMatchService } from "./import-match.service";
import { MergeMatchDto } from "./dto/import.dto";

@ApiTags("import")
@ApiBearerAuth()
@UseGuards(AuthGuard("jwt"))
@Controller("import/matches")
export class ImportMatchController {
  constructor(private readonly matchService: ImportMatchService) {}

  @Get()
  listPending(@Req() req: any) {
    return this.matchService.listPending(req.user.id);
  }

  @Post(":id/merge")
  merge(@Req() req: any, @Param("id", ParseUUIDPipe) id: string, @Body() body: MergeMatchDto) {
    return this.matchService.merge(req.user.id, id, body.transactionId);
  }

  @Post(":id/keep-both")
  keepBoth(@Req() req: any, @Param("id", ParseUUIDPipe) id: string) {
    return this.matchService.keepBoth(req.user.id, id);
  }
}
```

- [ ] **Step 8: Register + wire deps** — in `import.module.ts`: import `ImportMatchService` + `ImportMatchController`; add to `providers` / `controllers`. Ensure `TransactionsService` and `AccountsService` inject — import `TransactionsModule` (with `forwardRef(() => TransactionsModule)` if circular) and `AccountsModule`, and confirm each **exports** its service. `Transaction` is already in `forFeature` (Task 3) so `@InjectRepository(Transaction)` resolves.
- [ ] **Step 9: Full import specs + compile** — `npm test -- src/import && npx tsc --noEmit`. Expected: all pass; no type errors (verify no circular-DI boot failure — run the app once: `npm run build` succeeds).
- [ ] **Step 10: Commit** — `git commit -m "feat(t-235): resolve API — vetted-path merge/keep-both with atomic claim"`.

---

### Task 7 (OPTIONAL, deferrable): one-time FITID backfill

> Accept + backfill decision; `/built-in-reports/duplicate-transactions` is the fallback. Bounded one-time re-stamp of FITIDs onto FITID-less rows from a re-imported OFX — NOT a permanent-path change. Design when needed; no speculative build (YAGNI).

- [ ] Deferred. No code in this plan.

---

### Task 8: Live verification (mandatory before "done")

> Unit tests mock repos/services — they prove branch behavior, NOT real SQL filtering or real balance/net-worth effects. This exercises the real DB.

- [ ] **Step 1:** Dev instance: create a throwaway checking account; add a manual `-11.04`, date `2026-07-01`, payee "Google", UNRECONCILED. Record `current_balance`.
- [ ] **Step 2:** Import `~/Downloads/transactions.ofx` → the scratch account. Expected: `proposedMatches` has the `-11.04` match; it is NOT inserted; `-59.03` and `+1948.45` import as CLEARED; balance reflects only the two new rows.
- [ ] **Step 3:** Re-import the same file. Expected: the two inserted FITID rows `skipped`; the pending `-11.04` does NOT stage a second candidate.
- [ ] **Step 4:** `GET import/matches` → one pending. `POST import/matches/:id/merge` with the UNRECONCILED id. Expected: row now CLEARED, `fitid` set, payee still "Google", `transactionDate` = `2026-07-02` (bank date); a third import skips `-11.04`.
- [ ] **Step 5:** **Future-date check (R2-2):** new UNRECONCILED `-42.00` dated *7 days ahead*; import a matching bank OFX row dated today; merge. Expected: row becomes CLEARED **and** re-dated to today; `current_balance` now *includes* the `-42.00` (it was excluded while future-dated).
- [ ] **Step 6:** Fresh UNRECONCILED `-59.03`, re-stage, `POST .../keep-both`. Expected: new CLEARED `-59.03` (with fitid); balance −59.03; net-worth recalc; candidate `kept`.
- [ ] **Step 7:** Double-submit `keep-both` for one candidate. Expected: exactly one insert; the second call 409s.
- [ ] **Step 8:** Delete the scratch account; commit any fixups.

---

## Self-Review

**1. Spec coverage.** Data model → T1. Parser → T2. Staging store (+ race-guard unique index) → T3. FITID dedup + insert stamping → T4. CLEARED-gated heuristic (±7d, UNRECONCILED-only, split/transfer-excluded, target-account, canonicalized) + buffered payload → T5. Atomic merge (adopt bank date via `update`, keep payee, marker copy) + keep-both (single vetted `create` with status+fitid) + list → T6. Backfill → T7 (deferred). Live gate incl. future-date + race checks → T8. **All spec sections covered.**

**2. Placeholder scan.** No TBD/TODO. T7 is a decision-backed deferral. Every code step has real code; every run step a command + expected result.

**3. Type consistency.** `matchDateWindow` (T5) used only in T5. `ImportMatchCandidate` fields (T3) identical in T5/T6. `ProposedMatchDto`/`proposedMatches` (T5) consumed T8. `ImportContext.importBatchId?`/`stagedThisRow?` optional, set by orchestrator, guarded. `CreateTransactionDto.fitid?` (T6 Step 1) consumed by keep-both's `create`. `MergeMatchDto` (T6) used by controller. Service methods `listPending`/`merge`/`keepBoth`/`claim`/`loadOwned` consistent across service, controller, tests. Persistence via `repo.update`/`manager.update`. Tests use `calls[calls.length-1]`. **Consistent.**

**4. Codex findings.** Round 1 (12) all RESOLVED; Round 2 (6) all folded (see Codex Review). R2-5 is a documented, accepted residual (money-safe). Re-gate (round 3) pending.
