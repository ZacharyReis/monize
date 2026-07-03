# OFX/QIF/CSV Import Transaction Matching — Backend Spine Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give the import pipeline a matching engine so a bank `CLEARED` row is matched against a hand-entered `UNRECONCILED` row (amount + date window), staged for human review, and merged on confirm — instead of blindly inserting a duplicate.

**Architecture:** A `fitid` column + OFX parser extraction enables deterministic re-import dedup. In `ImportRegularProcessorService.processTransaction`, *after* the existing transfer checks, two new gates run: (1) FITID exact-dedup skips re-imports; (2) for incoming **CLEARED** rows only, an amount+date+account heuristic finds `UNRECONCILED` candidates and, on a hit, stages an `ImportMatchCandidate` row (buffered onto the import response, flushed only after the row's savepoint releases) instead of inserting. A separate `ImportMatchService` + controller resolves each staged match — **merge** (atomically claim the candidate, revalidate, flip the user's row to `CLEARED`, copy FITID/reference, keep their payee) or **keep both** (atomically claim, then create the bank row through the vetted `TransactionsService.create` path and stamp its FITID).

**Tech Stack:** NestJS, TypeORM (runtime-only, `synchronize: false`), PostgreSQL, custom SQL migrations, Jest (`ts-jest`, colocated `*.spec.ts`, **ES2021 target**).

## Codex Review

Adversarial plan-review by Codex/Wren, session `019f2974-dad8-7591-8bdb-a932dd0158df` (resume to re-gate after folding). It raised **5 Critical, 4 High, 3 Medium** — all verified real against the source and **all folded into this revision**:

| # | Sev | Finding | Folded into |
|---|-----|---------|-------------|
| 1 | Crit | FITID dedup placed first breaks transfer dedup counting | Task 4 (moved after transfer checks) |
| 2 | Crit | merge/keepBoth not atomic with candidate state → double-insert | Task 6 (atomic conditional claim) |
| 3 | Crit | merge doesn't revalidate the row is still UNRECONCILED/current | Task 6 (revalidate at resolve) |
| 4 | Crit | keepBoth balance diverges from normal paths (no net-worth recalc, 2-dp) | Task 6 (reuse `TransactionsService.create`) |
| 5 | Crit | matcher stages any row incl. VOID; keepBoth always inserts CLEARED | Task 5 (gate to incoming CLEARED only) |
| 6 | High | `importBatchId` required breaks multi-account + investment spec sites | Task 5 (optional + set at all orchestrator sites) |
| 7 | High | candidate query excludes splits but not transfers | Task 5 (`is_transfer=false`, `linked_transaction_id IS NULL`) |
| 8 | High | duplicate pending staging not prevented | Task 5 (pre-stage dedupe guard) |
| 9 | High | `proposedMatches` pushed inside savepoint can desync on rollback | Task 5 (buffer + flush after RELEASE) |
| 10 | Med | amount canonicalization across OFX/QIF/CSV | Task 5 (`roundMoney` once for match path) |
| 11 | Med | tests use `.at(-1)` but target is ES2021 | Tasks 4/5/6 (`calls[calls.length-1]`) |
| 12 | Med | controller needs `ParseUUIDPipe` + `@IsUUID()` DTO | Task 6 (`MergeMatchDto`) |

## Global Constraints

- **Branch:** `t-235-ofx-import-matching` (monize repo). Do all work here.
- **Migrations are custom SQL, NOT TypeORM.** Author hand-numbered idempotent files in `database/migrations/NNN_*.sql`. **Next free number is `090`.** Use `ADD COLUMN IF NOT EXISTS` / `CREATE TABLE IF NOT EXISTS` / `CREATE INDEX IF NOT EXISTS`. **Never** run `npm run migration:generate` (dead upstream script — no DataSource exists). Mirror every DDL change into `database/schema.sql`. Playbook: `database/CLAUDE.md`.
- **Apply migrations (bare-metal Manor):** `./scripts/rebuild.sh --migrate-only` or `--backend-only`.
- **Match gates (exact):** the incoming row must derive to **CLEARED** (`qifTx.cleared && !qifTx.void && !qifTx.reconciled`); candidate rows are same **target** account (`ctx.accountId`, never OFX `BANKACCTFROM`), `UNRECONCILED`, `is_split = false`, `is_transfer = false`, `linked_transaction_id IS NULL`; **exact `roundMoney`-canonicalized amount**; `|transaction_date − bank date| ≤ 7 days`. **Never** gate on payee.
- **Amount canonicalization:** compute `roundMoney(Number(qifTx.amount))` ONCE and use it for matching, staging (`bankAmount`), and the keep-both insert. OFX pre-rounds; QIF/CSV do not — this prevents `NUMERIC(20,4)` vs raw-float match misses.
- **Merge rule:** flip the user's row to `CLEARED`; copy `fitid` + `referenceNumber`; backfill `description` **only if empty**; **never overwrite `payeeName`/`payeeId`/`categoryId`**.
- **Resolve atomicity:** every resolve (`merge`/`keepBoth`) FIRST atomically claims the candidate with a conditional `UPDATE ... WHERE id=? AND user_id=? AND state='pending'` and asserts `affected === 1` (throw `ConflictException` otherwise) BEFORE any insert/update — prevents double-click double-processing. Revalidate the target row at resolve time (still `UNRECONCILED`, same account, non-split, non-transfer).
- **Balance safety:** staging inserts nothing and touches no balance. Merge is balance-neutral (UNRECONCILED already counts toward `current_balance`; UNRECONCILED→CLEARED changes nothing). Keep-both MUST create through `TransactionsService.create` so balance (`AccountsService.updateBalance`, 4-dp) and `netWorthService.triggerDebouncedRecalc` fire exactly like a normal create; then stamp `fitid` + `status=CLEARED` via `manager.update` (balance-neutral flip).
- **Persistence idiom:** `queryRunner.manager.update(Transaction, id, { ...partial })` (not `save`), matching `TransactionReconciliationService`.
- **Test target is ES2021** (`backend/tsconfig.json`). Do **not** use `Array.prototype.at`; use `arr[arr.length - 1]`.
- **Legacy backlog:** UNRECONCILED-only matcher (Zach's Accept + backfill decision). Legacy FITID-less `CLEARED` rows aren't re-import-protected; `/built-in-reports/duplicate-transactions` is the fallback. Optional one-time backfill = Task 7 (deferred).
- **Scope:** backend only. Frontend review UX is a **separate follow-on plan** consuming `proposedMatches` + the `import/matches` endpoints.
- **Test commands:** single file `npm test -- <path>`; single case `npx jest <path> -t "<name>"`.
- **Design spec:** `docs/superpowers/specs/2026-07-03-ofx-import-transaction-matching-design.md`.

## File Structure

**Create:**
- `database/migrations/090_transaction_fitid.sql`, `database/migrations/091_import_match_candidate.sql`
- `backend/src/import/entities/import-match-candidate.entity.ts`
- `backend/src/import/import-match.util.ts` + `.spec.ts` (pure `matchDateWindow`)
- `backend/src/import/import-match.service.ts` + `.spec.ts` (`listPending`/`merge`/`keepBoth`)
- `backend/src/import/import-match.controller.ts`

**Modify:**
- `database/schema.sql` — mirror both DDL changes.
- `backend/src/transactions/entities/transaction.entity.ts` — `fitid` property.
- `backend/src/import/qif-parser.ts` — `fitid?: string` on `QifTransaction`.
- `backend/src/import/ofx-parser.ts` (+ `ofx-parser.spec.ts`) — extract `<FITID>`.
- `backend/src/import/dto/import.dto.ts` — `ProposedMatchDto`, `MergeMatchDto`, `ImportResultDto.proposedMatches?`.
- `backend/src/import/import-context.ts` — `importBatchId?: string`, `stagedThisRow?: ProposedMatchDto[]`.
- `backend/src/import/import.service.ts` — generate `importBatchId` (single **and** multi-account context sites); per-row `stagedThisRow` reset + flush after `RELEASE SAVEPOINT`.
- `backend/src/import/import-regular-processor.service.ts` (+ spec) — dedup after transfers, CLEARED-gated candidate detection, dedupe-guarded staging, `fitid` on inserts.
- `backend/src/import/import.module.ts` — register entity, service, controller; ensure `TransactionsModule`/`TransactionsService` available for `keepBoth` (forwardRef if circular).

---

### Task 1: `fitid` column on transactions

**Files:**
- Create: `database/migrations/090_transaction_fitid.sql`
- Modify: `database/schema.sql:244-268`
- Modify: `backend/src/transactions/entities/transaction.entity.ts:103-116`

**Interfaces:**
- Produces: `Transaction.fitid: string | null` (`fitid VARCHAR(64)`), partial index `idx_transactions_user_account_fitid`.

- [ ] **Step 1: Write the migration** — create `database/migrations/090_transaction_fitid.sql`:

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

- [ ] **Step 2: Mirror into `database/schema.sql`** — in the `CREATE TABLE transactions (...)` block (after `reference_number VARCHAR(100)`, ~line 254) add:

```sql
    fitid VARCHAR(64), -- bank-provided OFX FITID for import dedup; NULL for manual/QIF/CSV
```

and add the index next to the other `transactions` indexes:

```sql
CREATE INDEX IF NOT EXISTS idx_transactions_user_account_fitid
    ON transactions (user_id, account_id, fitid) WHERE fitid IS NOT NULL;
```

- [ ] **Step 3: Add the entity property** — in `transaction.entity.ts`, after `referenceNumber` (line 109):

```ts
  @Column({ type: "varchar", name: "fitid", length: 64, nullable: true })
  fitid: string | null;
```

- [ ] **Step 4: Apply** — `cd ~/Gentoo_Dev/monize && ./scripts/rebuild.sh --migrate-only`. Expected: `090` applies with no error.
- [ ] **Step 5: Verify** — `psql -U postgres -d monize -c "\d transactions" | grep -E "fitid|idx_transactions_user_account_fitid"`. Expected: column + partial index present.
- [ ] **Step 6: Compile** — `cd ~/Gentoo_Dev/monize/backend && npx tsc --noEmit`. Expected: no new errors.
- [ ] **Step 7: Commit**

```bash
git add database/migrations/090_transaction_fitid.sql database/schema.sql backend/src/transactions/entities/transaction.entity.ts
git commit -m "feat(t-235): add fitid column to transactions for import dedup"
```

---

### Task 2: Extract FITID in the OFX parser

**Files:**
- Modify: `backend/src/import/qif-parser.ts:27-53`
- Modify: `backend/src/import/ofx-parser.ts:205-240`
- Test: `backend/src/import/ofx-parser.spec.ts` (create if absent)

**Interfaces:**
- Produces: `QifTransaction.fitid?: string` — set by `parseOfx` from `<FITID>`; `undefined` for QIF/CSV.

- [ ] **Step 1: Write the failing test** — in `backend/src/import/ofx-parser.spec.ts`:

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

- [ ] **Step 2: Run to verify it fails** — `npm test -- src/import/ofx-parser.spec.ts -t "captures the FITID"`. Expected: FAIL (`fitid` undefined).
- [ ] **Step 3: Add the field** — in `qif-parser.ts`, after `number: string;`:

```ts
  /** OFX financial-institution transaction id. Present only for OFX imports;
   *  undefined for QIF/CSV. Used for import re-dedup. */
  fitid?: string;
```

- [ ] **Step 4: Extract it** — in `ofx-parser.ts`, after `const checkNum = getTagValue(block, "CHECKNUM");` (line 205):

```ts
    const fitidRaw = getTagValue(block, "FITID");
    const fitid = fitidRaw ? truncate(fitidRaw, 64) : undefined;
```

and add `fitid,` to the `const tx: QifTransaction = { ... }` literal (after `number: truncate(checkNum, 100),`).

- [ ] **Step 5: Run to verify pass** — `npm test -- src/import/ofx-parser.spec.ts -t "captures the FITID"`. Expected: PASS.
- [ ] **Step 6: Commit**

```bash
git add backend/src/import/qif-parser.ts backend/src/import/ofx-parser.ts backend/src/import/ofx-parser.spec.ts
git commit -m "feat(t-235): extract OFX FITID into parsed transaction"
```

---

### Task 3: `ImportMatchCandidate` staging table + entity

**Files:**
- Create: `database/migrations/091_import_match_candidate.sql`
- Modify: `database/schema.sql`
- Create: `backend/src/import/entities/import-match-candidate.entity.ts`
- Modify: `backend/src/import/import.module.ts:23-33`

**Interfaces:**
- Produces: entity `ImportMatchCandidate` (table `import_match_candidate`), fields `id, userId, accountId, importBatchId, bankAmount, bankDate, fitid, bankName, bankMemo, bankReference, candidateTransactionIds: string[], state: "pending"|"merged"|"kept", createdAt, updatedAt`.

- [ ] **Step 1: Write the migration** — `database/migrations/091_import_match_candidate.sql`:

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
-- Dedup guard support (Task 5): look up pending candidates by account + amount + date.
CREATE INDEX IF NOT EXISTS idx_import_match_candidate_dedupe
    ON import_match_candidate (account_id, state, bank_amount, bank_date);
```

- [ ] **Step 2: Mirror into `database/schema.sql`** — append the full `CREATE TABLE` + all three `CREATE INDEX` statements near the other import/transaction tables.

- [ ] **Step 3: Create the entity** — `backend/src/import/entities/import-match-candidate.entity.ts`:

```ts
import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
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

- [ ] **Step 4: Register in the module** — in `import.module.ts` add `import { ImportMatchCandidate } from "./entities/import-match-candidate.entity";` and add it to `TypeOrmModule.forFeature([...])`.
- [ ] **Step 5: Apply** — `./scripts/rebuild.sh --migrate-only`. Expected: `091` applies.
- [ ] **Step 6: Verify** — `psql -U postgres -d monize -c "\d import_match_candidate"`. Expected: all columns, indexes, and the state check constraint.
- [ ] **Step 7: Compile** — `cd ~/Gentoo_Dev/monize/backend && npx tsc --noEmit`. Expected: no new errors.
- [ ] **Step 8: Commit**

```bash
git add database/migrations/091_import_match_candidate.sql database/schema.sql backend/src/import/entities/import-match-candidate.entity.ts backend/src/import/import.module.ts
git commit -m "feat(t-235): add import_match_candidate staging table + entity"
```

---

### Task 4: FITID re-import dedup + stamp fitid on inserts

> **Crit #1 fold:** the dedup check runs **after** the transfer checks, so it never short-circuits the transfer duplicate-counting logic (which must observe every same-signature row).

**Files:**
- Modify: `backend/src/import/import-regular-processor.service.ts:19-83`
- Test: `backend/src/import/import-regular-processor.service.spec.ts`

**Interfaces:**
- Consumes: `Transaction.fitid` (Task 1), `QifTransaction.fitid` (Task 2).
- Produces: private `isFitidDuplicate(ctx, qifTx): Promise<boolean>`; inserted transactions carry `fitid`.

- [ ] **Step 1: Write the failing tests** — add to `import-regular-processor.service.spec.ts` (reuse existing `makeContext`/`makeMockManager`/`makeMockQueryBuilder`):

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
    const ctx = makeContext(); // default: getCount -> 0, getMany -> []
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

- [ ] **Step 2: Run to verify failure** — `npm test -- src/import/import-regular-processor.service.spec.ts -t "FITID dedup"`. Expected: FAIL.
- [ ] **Step 3: Add the dedup method** — near `isDuplicateTransfer` (line 112):

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

- [ ] **Step 4: Call it AFTER the transfer checks + stamp fitid on insert** — in `processTransaction`, add immediately after the `matchPendingTransfer` block (after line 30), BEFORE `resolvePayee` (line 33):

```ts
    // Re-import guard: skip a row already imported under the same bank FITID.
    // MUST run after the transfer checks so it never short-circuits transfer
    // duplicate-counting (which must observe every same-signature row).
    if (await this.isFitidDuplicate(ctx, qifTx)) {
      ctx.importResult.skipped++;
      return;
    }
```

In the `ctx.queryRunner.manager.create(Transaction, { ... })` literal (line 66), add (after `referenceNumber: qifTx.number,`):

```ts
        fitid: qifTx.fitid ?? null,
```

- [ ] **Step 5: Run to verify pass** — `npm test -- src/import/import-regular-processor.service.spec.ts -t "FITID dedup"`. Expected: PASS.
- [ ] **Step 6: Full processor spec** — `npm test -- src/import/import-regular-processor.service.spec.ts`. Expected: all pass (confirms transfer-dedup tests still green).
- [ ] **Step 7: Commit**

```bash
git add backend/src/import/import-regular-processor.service.ts backend/src/import/import-regular-processor.service.spec.ts
git commit -m "feat(t-235): FITID re-import dedup (post-transfer) + stamp fitid on inserts"
```

---

### Task 5: CLEARED-gated candidate detection, dedupe-guarded staging, buffered payload

> Folds Crit #5 (CLEARED-only), High #6/#7/#8/#9, Med #10.

**Files:**
- Create: `backend/src/import/import-match.util.ts` + `.spec.ts`
- Modify: `backend/src/import/dto/import.dto.ts` (`ProposedMatchDto`, `ImportResultDto.proposedMatches?`)
- Modify: `backend/src/import/import-context.ts` (`importBatchId?`, `stagedThisRow?`)
- Modify: `backend/src/import/import.service.ts` (generate `importBatchId` at BOTH context sites; per-row `stagedThisRow` reset + flush after RELEASE SAVEPOINT)
- Modify: `backend/src/import/import-regular-processor.service.ts` (+ spec)

**Interfaces:**
- Produces: `matchDateWindow(date, days?)`; `ProposedMatchDto`; `ImportResultDto.proposedMatches?`; `ImportContext.importBatchId?`/`stagedThisRow?`; private `findMatchCandidates`, `stageMatchCandidate`.

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

- [ ] **Step 2: Run to verify failure** — `npm test -- src/import/import-match.util.spec.ts`. Expected: FAIL (module not found).
- [ ] **Step 3: Implement the pure helper** — `backend/src/import/import-match.util.ts`:

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

- [ ] **Step 4: Run to verify pass** — `npm test -- src/import/import-match.util.spec.ts`. Expected: PASS.

- [ ] **Step 5: DTO** — in `dto/import.dto.ts`, before `ImportResultDto`:

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

- [ ] **Step 6: Context fields (optional, low blast-radius) + orchestrator wiring** — in `import-context.ts`, add to `ImportContext` (both **optional**, so the multi-account + investment-spec context literals still compile — Crit #6):

```ts
  /** Groups all staged match candidates produced by one import run. */
  importBatchId?: string;
  /** Per-transaction staging buffer, flushed to importResult.proposedMatches
   *  only after the row's savepoint is released (avoids rollback desync). */
  stagedThisRow?: ProposedMatchDto[];
```

Add `import type { ProposedMatchDto } from "./dto/import.dto";` to `import-context.ts`.

In `import.service.ts`:
- Add `import { randomUUID } from "crypto";` if absent.
- In the **single-account** orchestrator `importParsedTransactions` (before building `ctx`, ~line 1207): `const importBatchId = randomUUID();` and include `importBatchId,` in the `ctx` literal (~1232-1247).
- In the **multi-account** path that also builds an `ImportContext` (~line 378): generate and set `importBatchId` there too.
- In the per-transaction loop (~1297-1330): immediately before the `processTransaction` call, `ctx.stagedThisRow = [];`. Immediately after the successful `RELEASE SAVEPOINT ${savepointName}`:

```ts
        if (ctx.stagedThisRow && ctx.stagedThisRow.length > 0) {
          importResult.proposedMatches = [
            ...(importResult.proposedMatches ?? []),
            ...ctx.stagedThisRow,
          ];
        }
```

  Do **not** flush in the `ROLLBACK TO SAVEPOINT` catch branch (leave `proposedMatches` untouched — the staged row was rolled back).

- [ ] **Step 7: Failing staging test** — add to `import-regular-processor.service.spec.ts`. First extend the spec's `makeImportResult` to include `proposedMatches: []` and `makeContext` to include `importBatchId: "batch-1"` and `stagedThisRow: []`. Then:

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
    const dedupeQb = makeMockQueryBuilder();          // isFitidDuplicate getCount -> 0
    const candQb = makeMockQueryBuilder(existing);    // findMatchCandidates getMany -> [existing]
    const stageDedupeQb = makeMockQueryBuilder();     // pre-stage dedupe getCount -> 0
    (ctx.queryRunner.manager.createQueryBuilder as jest.Mock)
      .mockReturnValueOnce(dedupeQb)
      .mockReturnValueOnce(candQb)
      .mockReturnValueOnce(stageDedupeQb);
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

- [ ] **Step 8: Run to verify failure** — `npm test -- src/import/import-regular-processor.service.spec.ts -t "heuristic match staging"`. Expected: FAIL.

- [ ] **Step 9: Implement detection + guarded staging** — in `import-regular-processor.service.ts` add imports:

```ts
import { ImportMatchCandidate } from "./entities/import-match-candidate.entity";
import { matchDateWindow } from "./import-match.util";
import { roundMoney } from "../common/round.util";
```

Add methods (near `matchPendingTransfer`):

```ts
  private async findMatchCandidates(
    ctx: ImportContext,
    qifTx: any,
  ): Promise<Transaction[]> {
    // Only stage when we have a batch id, and only for incoming rows that would
    // become CLEARED (i.e. bank-posted). Never for VOID/RECONCILED/uncleared,
    // transfers, or splits.
    if (!ctx.importBatchId) return [];
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
    // Dedupe guard: don't stage a second pending candidate for the same
    // account/amount/date (two identical bank rows, or a re-import before
    // resolution). Match by fitid when present, else by amount+date.
    const existingQb = ctx.queryRunner.manager
      .createQueryBuilder(ImportMatchCandidate, "c")
      .where("c.account_id = :accountId", { accountId: ctx.accountId })
      .andWhere("c.state = :state", { state: "pending" })
      .andWhere("c.bank_amount = :amount", { amount })
      .andWhere("c.bank_date = :date", { date: qifTx.date });
    if (qifTx.fitid) {
      existingQb.andWhere("c.fitid = :fitid", { fitid: qifTx.fitid });
    }
    const existing = await existingQb.getCount();
    if (existing > 0) return;

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

Wire into `processTransaction`, after the FITID dedup (Task 4) and before `resolvePayee`:

```ts
    // Match incoming CLEARED bank rows against hand-entered UNRECONCILED rows.
    // On a hit, stage for review instead of inserting a duplicate.
    const matchCandidates = await this.findMatchCandidates(ctx, qifTx);
    if (matchCandidates.length > 0) {
      await this.stageMatchCandidate(ctx, qifTx, matchCandidates);
      return;
    }
```

- [ ] **Step 10: Run to verify pass** — `npm test -- src/import/import-regular-processor.service.spec.ts -t "heuristic match staging"`. Expected: PASS.
- [ ] **Step 11: Full import specs + compile** — `npm test -- src/import && cd ~/Gentoo_Dev/monize/backend && npx tsc --noEmit`. Expected: all import specs pass; no type errors (confirm the multi-account context site + investment spec still compile with the optional fields).
- [ ] **Step 12: Commit**

```bash
git add backend/src/import/import-match.util.ts backend/src/import/import-match.util.spec.ts backend/src/import/dto/import.dto.ts backend/src/import/import-context.ts backend/src/import/import.service.ts backend/src/import/import-regular-processor.service.ts backend/src/import/import-regular-processor.service.spec.ts
git commit -m "feat(t-235): stage CLEARED matches for review (dedupe-guarded, rollback-safe)"
```

---

### Task 6: Resolve API — merge / keep-both / list (atomic + revalidated)

> Folds Crit #2/#3/#4, Med #11/#12.

**Files:**
- Create: `backend/src/import/import-match.service.ts` + `.spec.ts`
- Create: `backend/src/import/import-match.controller.ts`
- Modify: `backend/src/import/dto/import.dto.ts` (`MergeMatchDto`)
- Modify: `backend/src/import/import.module.ts` (providers, controllers, `TransactionsService` availability)

**Interfaces:**
- Consumes: `ImportMatchCandidate`, `Transaction`, `TransactionStatus`, `TransactionsService.create`.
- Produces: `ImportMatchService.listPending(userId)`, `.merge(userId, candidateId, transactionId)`, `.keepBoth(userId, candidateId)`; routes `GET import/matches`, `POST import/matches/:id/merge`, `POST import/matches/:id/keep-both`.

- [ ] **Step 1: Add `MergeMatchDto`** — in `dto/import.dto.ts` (imports `IsUUID` from `class-validator`):

```ts
export class MergeMatchDto {
  @ApiProperty({ description: "The UNRECONCILED transaction to merge the bank row into" })
  @IsUUID()
  transactionId: string;
}
```

- [ ] **Step 2: Failing service tests** — `backend/src/import/import-match.service.spec.ts` (mirror the `TransactionReconciliationService` spec style):

```ts
import { Test, TestingModule } from "@nestjs/testing";
import { getRepositoryToken } from "@nestjs/typeorm";
import { DataSource } from "typeorm";
import { ConflictException } from "@nestjs/common";
import { ImportMatchService } from "./import-match.service";
import { ImportMatchCandidate } from "./entities/import-match-candidate.entity";
import { Transaction, TransactionStatus } from "../transactions/entities/transaction.entity";
import { TransactionsService } from "../transactions/transactions.service";

describe("ImportMatchService", () => {
  let service: ImportMatchService;
  let candidateRepo: any;
  let txService: any;
  let managerUpdate: jest.Mock;
  let managerFindOne: jest.Mock;
  let queryRunner: any;

  beforeEach(async () => {
    managerUpdate = jest.fn().mockResolvedValue({ affected: 1 });
    managerFindOne = jest.fn();
    queryRunner = {
      connect: jest.fn(), startTransaction: jest.fn(),
      commitTransaction: jest.fn(), rollbackTransaction: jest.fn(), release: jest.fn(),
      manager: { update: managerUpdate, findOne: managerFindOne },
    };
    candidateRepo = {
      find: jest.fn(),
      findOne: jest.fn(),
      update: jest.fn().mockResolvedValue({ affected: 1 }), // conditional claim -> claimed
    };
    txService = { create: jest.fn().mockResolvedValue({ id: "new-txn" }) };
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ImportMatchService,
        { provide: getRepositoryToken(ImportMatchCandidate), useValue: candidateRepo },
        { provide: DataSource, useValue: { createQueryRunner: () => queryRunner } },
        { provide: TransactionsService, useValue: txService },
      ],
    }).compile();
    service = module.get(ImportMatchService);
  });

  it("merge claims atomically, flips to CLEARED, copies fitid/reference, keeps payee", async () => {
    candidateRepo.findOne.mockResolvedValue({
      id: "cand-1", userId: "u1", accountId: "acc-1", state: "pending",
      fitid: "F1", bankReference: "R1", bankMemo: "BANK MEMO",
      candidateTransactionIds: ["txn-1"],
    });
    managerFindOne.mockResolvedValue({
      id: "txn-1", userId: "u1", accountId: "acc-1", status: TransactionStatus.UNRECONCILED,
      isSplit: false, isTransfer: false, description: null, payeeName: "Google",
    });
    await service.merge("u1", "cand-1", "txn-1");
    // atomic claim first:
    expect(candidateRepo.update).toHaveBeenCalledWith(
      { id: "cand-1", userId: "u1", state: "pending" }, { state: "merged" });
    // row update keeps payee, copies fitid/ref, backfills description:
    expect(managerUpdate).toHaveBeenCalledWith(
      Transaction, "txn-1",
      expect.objectContaining({
        status: TransactionStatus.CLEARED, fitid: "F1", referenceNumber: "R1", description: "BANK MEMO",
      }));
    expect(managerUpdate.mock.calls[0][2]).not.toHaveProperty("payeeName");
  });

  it("merge throws Conflict when the candidate is already resolved (claim affected=0)", async () => {
    candidateRepo.findOne.mockResolvedValue({ id: "cand-1", userId: "u1", state: "pending", candidateTransactionIds: ["txn-1"] });
    candidateRepo.update.mockResolvedValue({ affected: 0 }); // lost the race
    await expect(service.merge("u1", "cand-1", "txn-1")).rejects.toBeInstanceOf(ConflictException);
  });

  it("merge revalidates: throws if the target row is no longer UNRECONCILED", async () => {
    candidateRepo.findOne.mockResolvedValue({ id: "cand-1", userId: "u1", accountId: "acc-1", state: "pending", candidateTransactionIds: ["txn-1"] });
    managerFindOne.mockResolvedValue({ id: "txn-1", userId: "u1", accountId: "acc-1", status: TransactionStatus.VOID, isSplit: false, isTransfer: false });
    await expect(service.merge("u1", "cand-1", "txn-1")).rejects.toBeInstanceOf(ConflictException);
  });

  it("merge does NOT overwrite an existing description", async () => {
    candidateRepo.findOne.mockResolvedValue({ id: "cand-1", userId: "u1", accountId: "acc-1", state: "pending", fitid: "F1", bankReference: null, bankMemo: "BANK MEMO", candidateTransactionIds: ["txn-1"] });
    managerFindOne.mockResolvedValue({ id: "txn-1", userId: "u1", accountId: "acc-1", status: TransactionStatus.UNRECONCILED, isSplit: false, isTransfer: false, description: "my note", payeeName: "Google" });
    await service.merge("u1", "cand-1", "txn-1");
    expect(managerUpdate.mock.calls[0][2].description).toBe("my note");
  });

  it("merge rejects a transactionId not in the candidate set", async () => {
    candidateRepo.findOne.mockResolvedValue({ id: "cand-1", userId: "u1", state: "pending", candidateTransactionIds: ["txn-1"] });
    await expect(service.merge("u1", "cand-1", "txn-OTHER")).rejects.toBeInstanceOf(ConflictException);
  });

  it("keepBoth claims, creates via TransactionsService, then stamps fitid + CLEARED", async () => {
    candidateRepo.findOne.mockResolvedValue({
      id: "cand-1", userId: "u1", accountId: "acc-1", state: "pending",
      bankAmount: -59.03, bankDate: "2026-07-02", fitid: "F2",
      bankName: "DoorDash", bankMemo: "DD", bankReference: null, currencyCode: "USD",
      candidateTransactionIds: ["txn-1"],
    });
    await service.keepBoth("u1", "cand-1");
    expect(candidateRepo.update).toHaveBeenCalledWith(
      { id: "cand-1", userId: "u1", state: "pending" }, { state: "kept" });
    expect(txService.create).toHaveBeenCalledWith("u1", expect.objectContaining({
      accountId: "acc-1", amount: -59.03, transactionDate: "2026-07-02",
    }));
    expect(managerUpdate).toHaveBeenCalledWith(
      Transaction, "new-txn",
      expect.objectContaining({ status: TransactionStatus.CLEARED, fitid: "F2" }));
  });

  it("listPending returns only this user's pending candidates", async () => {
    candidateRepo.find.mockResolvedValue([{ id: "c1" }]);
    const rows = await service.listPending("u1");
    expect(candidateRepo.find).toHaveBeenCalledWith({
      where: { userId: "u1", state: "pending" }, order: { createdAt: "DESC" } });
    expect(rows).toHaveLength(1);
  });
});
```

- [ ] **Step 3: Run to verify failure** — `npm test -- src/import/import-match.service.spec.ts`. Expected: FAIL (module not found).

- [ ] **Step 4: Implement the service** — `backend/src/import/import-match.service.ts`. **Atomic claim first, revalidate, then act. Keep-both reuses `TransactionsService.create` for correct balance + net-worth, then stamps fitid.** The claim uses a conditional repo `update` whose `affected` count guarantees exactly one winner; on any downstream failure the claim is reverted to `pending`.

```ts
import {
  Injectable, NotFoundException, BadRequestException,
  ConflictException, Inject, forwardRef,
} from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { DataSource, Repository } from "typeorm";
import { ImportMatchCandidate, ImportMatchState } from "./entities/import-match-candidate.entity";
import { Transaction, TransactionStatus } from "../transactions/entities/transaction.entity";
import { TransactionsService } from "../transactions/transactions.service";

@Injectable()
export class ImportMatchService {
  constructor(
    @InjectRepository(ImportMatchCandidate)
    private readonly candidateRepo: Repository<ImportMatchCandidate>,
    private readonly dataSource: DataSource,
    @Inject(forwardRef(() => TransactionsService))
    private readonly transactionsService: TransactionsService,
  ) {}

  async listPending(userId: string): Promise<ImportMatchCandidate[]> {
    return this.candidateRepo.find({
      where: { userId, state: "pending" },
      order: { createdAt: "DESC" },
    });
  }

  /** Atomically transition a pending candidate to `next`. Returns true iff THIS
   *  call won the race (affected === 1). */
  private async claim(userId: string, candidateId: string, next: ImportMatchState): Promise<boolean> {
    const res = await this.candidateRepo.update(
      { id: candidateId, userId, state: "pending" },
      { state: next },
    );
    return res.affected === 1;
  }

  async merge(userId: string, candidateId: string, transactionId: string): Promise<void> {
    const candidate = await this.candidateRepo.findOne({ where: { id: candidateId } });
    if (!candidate || candidate.userId !== userId) {
      throw new NotFoundException("Match candidate not found");
    }
    if (!candidate.candidateTransactionIds.includes(transactionId)) {
      throw new ConflictException("transactionId is not a candidate for this match");
    }
    if (!(await this.claim(userId, candidateId, "merged"))) {
      throw new ConflictException("Match candidate already resolved");
    }
    const queryRunner = this.dataSource.createQueryRunner();
    await queryRunner.connect();
    await queryRunner.startTransaction();
    try {
      const existing = await queryRunner.manager.findOne(Transaction, {
        where: { id: transactionId, userId },
      });
      // Revalidate: must still be a current, matchable row (Crit #3).
      if (
        !existing ||
        existing.accountId !== candidate.accountId ||
        existing.status !== TransactionStatus.UNRECONCILED ||
        existing.isSplit ||
        existing.isTransfer
      ) {
        throw new ConflictException("Transaction is no longer eligible to merge");
      }
      // UNRECONCILED -> CLEARED is balance-neutral (both count toward current balance).
      await queryRunner.manager.update(Transaction, transactionId, {
        status: TransactionStatus.CLEARED,
        fitid: candidate.fitid,
        referenceNumber: candidate.bankReference ?? existing.referenceNumber,
        description: existing.description || candidate.bankMemo,
      });
      await queryRunner.commitTransaction();
    } catch (err) {
      await queryRunner.rollbackTransaction();
      await this.candidateRepo.update({ id: candidateId }, { state: "pending" }); // revert claim
      throw err;
    } finally {
      await queryRunner.release();
    }
  }

  async keepBoth(userId: string, candidateId: string): Promise<Transaction> {
    const candidate = await this.candidateRepo.findOne({ where: { id: candidateId } });
    if (!candidate || candidate.userId !== userId) {
      throw new NotFoundException("Match candidate not found");
    }
    if (!(await this.claim(userId, candidateId, "kept"))) {
      throw new ConflictException("Match candidate already resolved");
    }
    try {
      // Reuse the vetted create path so balance (4-dp) + net-worth recalc fire
      // exactly like a normal transaction create (Crit #4). Created UNRECONCILED,
      // then flipped to CLEARED (balance-neutral) with the bank FITID stamped.
      const created = await this.transactionsService.create(userId, {
        accountId: candidate.accountId,
        transactionDate: candidate.bankDate,
        amount: Number(candidate.bankAmount),
        currencyCode: candidate.currencyCode ?? undefined,
        payeeName: candidate.bankName ?? undefined,
        description: candidate.bankMemo ?? undefined,
        referenceNumber: candidate.bankReference ?? undefined,
      } as any);
      await this.dataSource.getRepository(Transaction).update(created.id, {
        status: TransactionStatus.CLEARED,
        fitid: candidate.fitid,
      });
      return { ...created, status: TransactionStatus.CLEARED, fitid: candidate.fitid };
    } catch (err) {
      await this.candidateRepo.update({ id: candidateId }, { state: "pending" }); // revert claim
      throw err;
    }
  }
}
```

> **Implementer notes:** (a) `TransactionsService.create(userId, dto)` — read its real `CreateTransactionDto` (`backend/src/transactions/dto/create-transaction.dto.ts`); `currencyCode` is required there, so resolve it from the account if the candidate has none (`candidate.currencyCode` is **not** a stored column — fetch the account's `currencyCode` before calling, e.g. via `transactionsService`/`accountsService`, and pass it). Remove the `as any` once fields line up. (b) If `ImportModule`↔`TransactionsModule` is circular, the `forwardRef` handles it; also ensure `TransactionsModule` exports `TransactionsService` and `ImportModule` imports it.

- [ ] **Step 5: Run to verify pass** — `npm test -- src/import/import-match.service.spec.ts`. Expected: PASS.

- [ ] **Step 6: Controller (UUID-validated)** — `backend/src/import/import-match.controller.ts`:

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

- [ ] **Step 7: Register in the module** — in `import.module.ts`: import `ImportMatchService` + `ImportMatchController`; add `ImportMatchService` to `providers`, `ImportMatchController` to `controllers`; import `TransactionsModule` (with `forwardRef` if needed) so `TransactionsService` injects.
- [ ] **Step 8: Full import specs + compile** — `npm test -- src/import && cd ~/Gentoo_Dev/monize/backend && npx tsc --noEmit`. Expected: all pass; no type errors.
- [ ] **Step 9: Commit**

```bash
git add backend/src/import/import-match.service.ts backend/src/import/import-match.service.spec.ts backend/src/import/import-match.controller.ts backend/src/import/dto/import.dto.ts backend/src/import/import.module.ts
git commit -m "feat(t-235): resolve API — atomic merge / keep-both / list for import matches"
```

---

### Task 7 (OPTIONAL, deferrable): one-time FITID backfill

> Zach chose **Accept + backfill**; `/built-in-reports/duplicate-transactions` is the accepted fallback, so this is optional and may ship later. A bounded one-time re-stamp of FITIDs onto existing FITID-less rows from a re-imported OFX — NOT a change to the permanent import path. Design as its own small task when needed; do not build speculatively (YAGNI).

- [ ] Deferred. Track as a follow-up; no code in this plan.

---

### Task 8: Live verification (mandatory before "done")

> Unit tests mock `queryRunner` — they prove branch behavior, NOT real SQL filtering (amount-exact, ±7-day `BETWEEN`, UNRECONCILED/CLEARED/split/transfer filters) or real balance/net-worth effects. This exercises the real DB, per the Manor "live verification is mandatory" standard.

- [ ] **Step 1:** In the dev Monize instance, create a throwaway checking account. Add a manual transaction: `-11.04`, date `2026-07-01`, payee "Google", status UNRECONCILED. Note the account's `current_balance`.
- [ ] **Step 2:** Import `~/Downloads/transactions.ofx` targeting the scratch account. Expected: response `proposedMatches` contains the `-11.04` row matched to your UNRECONCILED entry; `-11.04` NOT inserted; `-59.03` and `+1948.45` import as new CLEARED; balance reflects only the two new rows (not the staged one).
- [ ] **Step 3:** Import the same file again. Expected: the two inserted FITID rows are `skipped`; the still-pending `-11.04` does NOT stage a second candidate (dedupe guard).
- [ ] **Step 4:** `GET import/matches` → confirm one pending candidate. `POST import/matches/:id/merge` with the UNRECONCILED transactionId. Expected: your row now CLEARED, `fitid=20260702000000011041`, payee still "Google"; balance unchanged by the merge; a third import skips `-11.04` via FITID dedup.
- [ ] **Step 5:** Fresh UNRECONCILED `-59.03` row + re-stage, then `POST import/matches/:id/keep-both`. Expected: a new CLEARED `-59.03` inserted (with fitid); balance decreases by 59.03; net-worth recalc triggered; candidate `kept`.
- [ ] **Step 6:** Double-submit `keep-both` for one candidate (race check). Expected: exactly one insert; the second call returns 409 Conflict.
- [ ] **Step 7:** Delete the scratch account (cleanup). Commit any fixups discovered.

---

## Self-Review

**1. Spec coverage.** Data model → T1. Parser → T2. Staging store → T3. FITID dedup + insert stamping → T4. CLEARED-gated amount+date heuristic (±7d, UNRECONCILED-only, split/transfer-excluded, target-account, canonicalized) + buffered payload → T5. Atomic merge (keep payee, copy fitid/ref, backfill-if-empty, revalidated) + keep-both (vetted create path) + list → T6. Legacy backfill → T7 (deferred, per decision). Live gate → T8. **All spec sections covered.**

**2. Placeholder scan.** No TBD/TODO. T7 is a decision-backed deferral. Implementer notes in T6 point to real files to read (not placeholders). Every code step shows real code; every run step shows command + expected result.

**3. Type consistency.** `matchDateWindow` (T5) used only in T5. `ImportMatchCandidate` fields (T3) used identically in T5/T6. `ProposedMatchDto`/`proposedMatches` defined T5, consumed T8. `ImportContext.importBatchId?`/`stagedThisRow?` optional (T5), set by orchestrator, guarded in `findMatchCandidates`. `MergeMatchDto` defined T6, used by controller. Service methods `listPending`/`merge`/`keepBoth`/`claim` consistent across service, controller, and tests. Persistence via `manager.update(Transaction, id, {...})`; keep-both via `TransactionsService.create` then stamp. Tests use `calls[calls.length-1]` (ES2021-safe). **Consistent.**

**4. Codex findings.** All 12 (5 Crit / 4 High / 3 Med) folded — see the Codex Review table. Re-gate pending.
