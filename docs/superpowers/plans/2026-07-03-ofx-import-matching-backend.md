# OFX/QIF/CSV Import Transaction Matching — Backend Spine Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give the import pipeline a matching engine so a bank `CLEARED` row is matched against a hand-entered `UNRECONCILED` row (amount + date window), staged for human review, and merged on confirm — instead of blindly inserting a duplicate.

**Architecture:** A `fitid` column + OFX parser extraction enables deterministic re-import dedup. In `ImportRegularProcessorService.processTransaction`, after the existing transfer checks, two new gates run: (1) FITID exact-dedup skips re-imports; (2) an amount+date+account heuristic finds `UNRECONCILED` candidates and, on a hit, stages an `ImportMatchCandidate` row (surfaced on the import response) instead of inserting. A separate `ImportMatchService` + controller resolves each staged match — **merge** (flip the user's row to `CLEARED`, copy FITID/reference, keep their payee) or **keep both** (insert the bank row with its FITID).

**Tech Stack:** NestJS, TypeORM (runtime-only, `synchronize: false`), PostgreSQL, custom SQL migrations, Jest (`ts-jest`, colocated `*.spec.ts`).

## Global Constraints

- **Branch:** `t-235-ofx-import-matching` (monize repo). Do all work here.
- **Migrations are custom SQL, NOT TypeORM.** Author hand-numbered idempotent files in `database/migrations/NNN_*.sql`. **Next free number is `090`.** Use `ADD COLUMN IF NOT EXISTS` / `CREATE TABLE IF NOT EXISTS` / `CREATE INDEX IF NOT EXISTS`. **Never** run `npm run migration:generate` (dead upstream script — no DataSource exists). Mirror every DDL change into `database/schema.sql` for fresh-install parity. Playbook: `database/CLAUDE.md`.
- **Apply migrations (bare-metal Manor):** `./scripts/rebuild.sh --migrate-only` (raw `psql -U postgres`, relies on `IF NOT EXISTS` idempotency; does not record filenames) or `./scripts/rebuild.sh --backend-only` (migrate + rebuild + restart).
- **Match gates (exact, from spec):** exact **signed** `amount` + same **target** account (`ctx.accountId`, never OFX `BANKACCTFROM`) + `|transaction_date − bank date| ≤ 7 days`. **Never** gate on payee.
- **Merge rule:** flip the user's row to `CLEARED`; copy `fitid` + `referenceNumber`; backfill `description` **only if empty**; **never overwrite `payeeName`/`payeeId`/`categoryId`**.
- **Persistence idiom:** `queryRunner.manager.update(Transaction, id, { ...partial })` (not `save`), matching `TransactionReconciliationService`.
- **Legacy backlog:** UNRECONCILED-only matcher (Zach's decision: Accept + backfill). Legacy FITID-less `CLEARED` rows are not re-import-protected; the existing `/built-in-reports/duplicate-transactions` report is the fallback. An optional one-time backfill is Task 7 (deferrable).
- **Scope:** backend only. Frontend review UX (post-import screen + persistent queue page) is a **separate follow-on plan** consuming this plan's `proposedMatches` payload and `import/matches` endpoints.
- **Test commands:** single file `npm test -- <path>`; single case `npx jest <path> -t "<name>"`. Colocated `*.spec.ts`.
- **Design spec:** `docs/superpowers/specs/2026-07-03-ofx-import-transaction-matching-design.md`.

## File Structure

**Create:**
- `database/migrations/090_transaction_fitid.sql` — `fitid` column + partial index.
- `database/migrations/091_import_match_candidate.sql` — staging table.
- `backend/src/import/entities/import-match-candidate.entity.ts` — staging entity.
- `backend/src/import/import-match.util.ts` — pure `matchDateWindow` helper.
- `backend/src/import/import-match.util.spec.ts` — window unit tests.
- `backend/src/import/import-match.service.ts` — `listPending` / `merge` / `keepBoth`.
- `backend/src/import/import-match.service.spec.ts` — resolve-path unit tests.
- `backend/src/import/import-match.controller.ts` — `import/matches` routes.

**Modify:**
- `database/schema.sql` — mirror both DDL changes.
- `backend/src/transactions/entities/transaction.entity.ts` — add `fitid` property.
- `backend/src/import/qif-parser.ts` — add `fitid?: string` to `QifTransaction`.
- `backend/src/import/ofx-parser.ts` — extract `<FITID>`.
- `backend/src/import/ofx-parser.spec.ts` — assert FITID extraction (create if absent).
- `backend/src/import/dto/import.dto.ts` — add `ProposedMatchDto` + `ImportResultDto.proposedMatches?`.
- `backend/src/import/import-context.ts` — add `importBatchId: string`.
- `backend/src/import/import.service.ts` — generate `importBatchId` into `ctx`.
- `backend/src/import/import-regular-processor.service.ts` — FITID dedup, candidate detection, staging, and set `fitid` on inserts.
- `backend/src/import/import-regular-processor.service.spec.ts` — new-behavior tests + helper updates.
- `backend/src/import/import.module.ts` — register entity, service, controller.

---

### Task 1: `fitid` column on transactions

**Files:**
- Create: `database/migrations/090_transaction_fitid.sql`
- Modify: `database/schema.sql:244-268` (transactions table block)
- Modify: `backend/src/transactions/entities/transaction.entity.ts:103-116`

**Interfaces:**
- Produces: `Transaction.fitid: string | null` (db column `fitid VARCHAR(64)`), partial index `idx_transactions_user_account_fitid`.

- [ ] **Step 1: Write the migration**

Create `database/migrations/090_transaction_fitid.sql`:

```sql
-- 090_transaction_fitid.sql
-- OFX/QIF/CSV import matching (t-235): store the bank-provided FITID on
-- transactions so re-imports can be de-duplicated. NULL for hand-entered rows
-- and for QIF/CSV imports (no FITID in those formats).
ALTER TABLE transactions
    ADD COLUMN IF NOT EXISTS fitid VARCHAR(64) NULL;

-- Partial index: fast per-account dedup lookups over only the rows that carry a
-- FITID. Non-unique — re-imports legitimately produce the same FITID and the app
-- skips them; a UNIQUE constraint would throw instead.
CREATE INDEX IF NOT EXISTS idx_transactions_user_account_fitid
    ON transactions (user_id, account_id, fitid)
    WHERE fitid IS NOT NULL;
```

- [ ] **Step 2: Mirror into `database/schema.sql`**

In the `CREATE TABLE transactions (...)` block (around line 254, after `reference_number VARCHAR(100)`), add:

```sql
    fitid VARCHAR(64), -- bank-provided OFX FITID for import dedup; NULL for manual/QIF/CSV
```

Add the index next to the other `transactions` indexes in `schema.sql`:

```sql
CREATE INDEX IF NOT EXISTS idx_transactions_user_account_fitid
    ON transactions (user_id, account_id, fitid) WHERE fitid IS NOT NULL;
```

- [ ] **Step 3: Add the entity property**

In `backend/src/transactions/entities/transaction.entity.ts`, immediately after the `referenceNumber` column (line 109), add:

```ts
  @Column({ type: "varchar", name: "fitid", length: 64, nullable: true })
  fitid: string | null;
```

- [ ] **Step 4: Apply the migration**

Run: `cd ~/Gentoo_Dev/monize && ./scripts/rebuild.sh --migrate-only`
Expected: migration `090_transaction_fitid.sql` applies without error.

- [ ] **Step 5: Verify the column + index exist**

Run: `psql -U postgres -d monize -c "\d transactions" | grep -E "fitid|idx_transactions_user_account_fitid"`
Expected: shows the `fitid | character varying(64)` column and the partial index.

- [ ] **Step 6: Verify backend compiles**

Run: `cd ~/Gentoo_Dev/monize/backend && npx tsc --noEmit`
Expected: no new type errors referencing `transaction.entity.ts`.

- [ ] **Step 7: Commit**

```bash
git add database/migrations/090_transaction_fitid.sql database/schema.sql backend/src/transactions/entities/transaction.entity.ts
git commit -m "feat(t-235): add fitid column to transactions for import dedup"
```

---

### Task 2: Extract FITID in the OFX parser

**Files:**
- Modify: `backend/src/import/qif-parser.ts:27-53` (`QifTransaction` interface)
- Modify: `backend/src/import/ofx-parser.ts:205-240`
- Test: `backend/src/import/ofx-parser.spec.ts` (create if absent)

**Interfaces:**
- Consumes: nothing.
- Produces: `QifTransaction.fitid?: string` — populated by `parseOfx` from `<FITID>`; `undefined` for QIF/CSV.

- [ ] **Step 1: Write the failing test**

In `backend/src/import/ofx-parser.spec.ts` (create if it does not exist), add:

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

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- src/import/ofx-parser.spec.ts -t "captures the FITID"`
Expected: FAIL — `fitid` is `undefined` (not yet extracted).

- [ ] **Step 3: Add the field to the interface**

In `backend/src/import/qif-parser.ts`, inside `export interface QifTransaction`, after the `number: string;` field, add:

```ts
  /** OFX financial-institution transaction id. Present only for OFX imports;
   *  undefined for QIF/CSV. Used for import re-dedup. */
  fitid?: string;
```

- [ ] **Step 4: Extract it in the OFX parser**

In `backend/src/import/ofx-parser.ts`, after `const checkNum = getTagValue(block, "CHECKNUM");` (line 205) add:

```ts
    const fitidRaw = getTagValue(block, "FITID");
    const fitid = fitidRaw ? truncate(fitidRaw, 64) : undefined;
```

Then in the `const tx: QifTransaction = { ... }` object literal (starting line 221), add the field (e.g. after `number: truncate(checkNum, 100),`):

```ts
      fitid,
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npm test -- src/import/ofx-parser.spec.ts -t "captures the FITID"`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add backend/src/import/qif-parser.ts backend/src/import/ofx-parser.ts backend/src/import/ofx-parser.spec.ts
git commit -m "feat(t-235): extract OFX FITID into parsed transaction"
```

---

### Task 3: `ImportMatchCandidate` staging table + entity

**Files:**
- Create: `database/migrations/091_import_match_candidate.sql`
- Modify: `database/schema.sql` (append table + indexes)
- Create: `backend/src/import/entities/import-match-candidate.entity.ts`
- Modify: `backend/src/import/import.module.ts:23-33` (`forFeature`)

**Interfaces:**
- Produces: entity `ImportMatchCandidate` (table `import_match_candidate`) with fields `id, userId, accountId, importBatchId, bankAmount, bankDate, fitid, bankName, bankMemo, bankReference, candidateTransactionIds: string[], state: "pending"|"merged"|"kept", createdAt, updatedAt`.

- [ ] **Step 1: Write the migration**

Create `database/migrations/091_import_match_candidate.sql`:

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
```

- [ ] **Step 2: Mirror into `database/schema.sql`**

Append the full `CREATE TABLE import_match_candidate (...)` block and both `CREATE INDEX` statements from Step 1 near the other import/transaction tables in `schema.sql`.

- [ ] **Step 3: Create the entity**

Create `backend/src/import/entities/import-match-candidate.entity.ts`:

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

- [ ] **Step 4: Register in the import module**

In `backend/src/import/import.module.ts`, add `ImportMatchCandidate` to the `TypeOrmModule.forFeature([...])` array (currently `Transaction, TransactionSplit, Account, Category, Payee, Security, InvestmentTransaction, Holding, ImportColumnMapping`). Add the import at the top:

```ts
import { ImportMatchCandidate } from "./entities/import-match-candidate.entity";
```

- [ ] **Step 5: Apply the migration**

Run: `cd ~/Gentoo_Dev/monize && ./scripts/rebuild.sh --migrate-only`
Expected: `091_import_match_candidate.sql` applies without error.

- [ ] **Step 6: Verify the table**

Run: `psql -U postgres -d monize -c "\d import_match_candidate"`
Expected: shows all columns + the two indexes + the state check constraint.

- [ ] **Step 7: Verify compile**

Run: `cd ~/Gentoo_Dev/monize/backend && npx tsc --noEmit`
Expected: no new errors.

- [ ] **Step 8: Commit**

```bash
git add database/migrations/091_import_match_candidate.sql database/schema.sql backend/src/import/entities/import-match-candidate.entity.ts backend/src/import/import.module.ts
git commit -m "feat(t-235): add import_match_candidate staging table + entity"
```

---

### Task 4: FITID re-import dedup + stamp FITID on inserts

**Files:**
- Modify: `backend/src/import/import-regular-processor.service.ts:19-83`
- Test: `backend/src/import/import-regular-processor.service.spec.ts`

**Interfaces:**
- Consumes: `Transaction.fitid` (Task 1), `QifTransaction.fitid` (Task 2).
- Produces: private `isFitidDuplicate(ctx: ImportContext, qifTx: any): Promise<boolean>`; inserted transactions now carry `fitid`.

- [ ] **Step 1: Write the failing tests**

Add to `backend/src/import/import-regular-processor.service.spec.ts` (the `makeContext`/`makeMockManager` helpers already exist in this file — reuse them):

```ts
describe("FITID dedup", () => {
  it("skips an incoming row whose FITID already exists in the account", async () => {
    const ctx = makeContext();
    // manager.createQueryBuilder(...).getCount() -> 1 means already present
    ctx.queryRunner.manager.createQueryBuilder = jest
      .fn()
      .mockReturnValue(makeMockQueryBuilder({}) /* getCount -> 1 */);
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
    const ctx = makeContext(); // default mocks: getCount -> 0, getMany -> []
    await service.processTransaction(ctx, {
      date: "2026-07-02", amount: -11.04, payee: "Google", memo: "GOOGLE CLOUD",
      number: "", fitid: "20260702000000011041",
      cleared: true, reconciled: false, isTransfer: false,
      transferAccount: "", splits: [], tagNames: [],
    });
    const created = (ctx.queryRunner.manager.create as jest.Mock).mock.calls.at(-1);
    expect(created[1]).toEqual(expect.objectContaining({ fitid: "20260702000000011041" }));
    expect(ctx.importResult.imported).toBe(1);
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npm test -- src/import/import-regular-processor.service.spec.ts -t "FITID dedup"`
Expected: FAIL — no dedup, and `create` called without `fitid`.

- [ ] **Step 3: Add the dedup method**

In `backend/src/import/import-regular-processor.service.ts`, add a private method (near `isDuplicateTransfer`, line 112):

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

- [ ] **Step 4: Call it first + stamp fitid on insert**

In `processTransaction`, add as the FIRST statement (before the `isDuplicateTransfer` check at line 21):

```ts
    // Skip rows already imported under the same bank FITID (re-import guard).
    if (await this.isFitidDuplicate(ctx, qifTx)) {
      ctx.importResult.skipped++;
      return;
    }
```

In the `ctx.queryRunner.manager.create(Transaction, { ... })` literal (line 66), add the field (e.g. after `referenceNumber: qifTx.number,`):

```ts
        fitid: qifTx.fitid ?? null,
```

- [ ] **Step 5: Run to verify pass**

Run: `npm test -- src/import/import-regular-processor.service.spec.ts -t "FITID dedup"`
Expected: PASS.

- [ ] **Step 6: Run the whole processor spec (no regressions)**

Run: `npm test -- src/import/import-regular-processor.service.spec.ts`
Expected: all pass.

- [ ] **Step 7: Commit**

```bash
git add backend/src/import/import-regular-processor.service.ts backend/src/import/import-regular-processor.service.spec.ts
git commit -m "feat(t-235): FITID re-import dedup and stamp fitid on inserted rows"
```

---

### Task 5: Heuristic candidate detection, staging, and response payload

**Files:**
- Create: `backend/src/import/import-match.util.ts`
- Create: `backend/src/import/import-match.util.spec.ts`
- Modify: `backend/src/import/dto/import.dto.ts:312-371` (`ImportResultDto`) + new `ProposedMatchDto`
- Modify: `backend/src/import/import-context.ts:4-22` (`importBatchId`)
- Modify: `backend/src/import/import.service.ts:1215-1247` (generate `importBatchId`)
- Modify: `backend/src/import/import-regular-processor.service.ts`
- Test: `backend/src/import/import-regular-processor.service.spec.ts`

**Interfaces:**
- Consumes: `ImportMatchCandidate` (Task 3), `Transaction.fitid`, `TransactionStatus`.
- Produces:
  - `matchDateWindow(date: string, days?: number): { lo: string; hi: string }` (pure).
  - `ProposedMatchDto` + `ImportResultDto.proposedMatches?: ProposedMatchDto[]`.
  - `ImportContext.importBatchId: string`.
  - private `findMatchCandidates(ctx, qifTx): Promise<Transaction[]>` and `stageMatchCandidate(ctx, qifTx, candidates): Promise<void>`.

- [ ] **Step 1: Write the failing window-helper test**

Create `backend/src/import/import-match.util.spec.ts`:

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

- [ ] **Step 2: Run to verify failure**

Run: `npm test -- src/import/import-match.util.spec.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the pure helper**

Create `backend/src/import/import-match.util.ts`:

```ts
/** Compute an inclusive ±`days` date window around an ISO `YYYY-MM-DD` date,
 *  returned as ISO date strings. UTC math avoids local-timezone drift. */
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

- [ ] **Step 4: Run to verify pass**

Run: `npm test -- src/import/import-match.util.spec.ts`
Expected: PASS.

- [ ] **Step 5: Add the DTO field**

In `backend/src/import/dto/import.dto.ts`, before `ImportResultDto`, add:

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

Then inside `ImportResultDto`, add:

```ts
  @ApiPropertyOptional({
    type: [ProposedMatchDto],
    description:
      "Incoming rows matched against existing UNRECONCILED transactions, staged for review instead of inserted",
  })
  proposedMatches?: ProposedMatchDto[];
```

- [ ] **Step 6: Add `importBatchId` to the context and generate it**

In `backend/src/import/import-context.ts`, add to the `ImportContext` interface (after `accountId: string;`):

```ts
  /** Groups all staged match candidates produced by one import run. */
  importBatchId: string;
```

In `backend/src/import/import.service.ts`, at the top of `importParsedTransactions` (before building `ctx`, around line 1207), add:

```ts
    const importBatchId = randomUUID();
```

Add `import { randomUUID } from "crypto";` at the top of the file if absent, and include `importBatchId,` in the `ctx` object literal (lines 1232-1247).

- [ ] **Step 7: Write the failing staging test**

Add to `backend/src/import/import-regular-processor.service.spec.ts`. First extend `makeImportResult` to include `proposedMatches: []` and `makeContext` to include `importBatchId: "batch-1"` (both helpers live at the top of this spec). Then:

```ts
describe("heuristic match staging", () => {
  it("stages a candidate and does NOT insert when an UNRECONCILED row matches", async () => {
    const existing = {
      id: "txn-existing", transactionDate: "2026-07-02", amount: -11.04,
      payeeName: "Google", description: null,
    };
    const ctx = makeContext();
    // FITID dedup getCount -> 0; candidate search getMany -> [existing]
    const dedupQb = makeMockQueryBuilder(); // getCount -> 0
    const candQb = makeMockQueryBuilder(existing); // getMany -> [existing]
    (ctx.queryRunner.manager.createQueryBuilder as jest.Mock)
      .mockReturnValueOnce(dedupQb)   // isFitidDuplicate
      .mockReturnValueOnce(candQb);   // findMatchCandidates
    await service.processTransaction(ctx, {
      date: "2026-07-02", amount: -11.04, payee: "Google", memo: "GOOGLE CLOUD",
      number: "", fitid: "20260702000000011041",
      cleared: true, reconciled: false, isTransfer: false,
      transferAccount: "", splits: [], tagNames: [],
    });
    // Staged, not inserted:
    expect(ctx.importResult.proposedMatches).toHaveLength(1);
    expect(ctx.importResult.proposedMatches![0].candidates[0].id).toBe("txn-existing");
    expect(ctx.importResult.imported).toBe(0);
    // The only save is the ImportMatchCandidate, never a Transaction insert:
    const savedTypes = (ctx.queryRunner.manager.create as jest.Mock).mock.calls.map((c) => c[0]?.name);
    expect(savedTypes).not.toContain("Transaction");
  });
});
```

- [ ] **Step 8: Run to verify failure**

Run: `npm test -- src/import/import-regular-processor.service.spec.ts -t "heuristic match staging"`
Expected: FAIL — no candidate search / staging yet.

- [ ] **Step 9: Implement candidate detection + staging**

In `backend/src/import/import-regular-processor.service.ts`, add the import:

```ts
import { ImportMatchCandidate } from "./entities/import-match-candidate.entity";
import { matchDateWindow } from "./import-match.util";
```

Add two private methods (near `matchPendingTransfer`):

```ts
  private async findMatchCandidates(
    ctx: ImportContext,
    qifTx: any,
  ): Promise<Transaction[]> {
    // Only single-account, non-split, non-transfer rows are eligible.
    if (qifTx.isTransfer || (qifTx.splits && qifTx.splits.length > 0)) return [];
    const { lo, hi } = matchDateWindow(qifTx.date, 7);
    return ctx.queryRunner.manager
      .createQueryBuilder(Transaction, "t")
      .where("t.user_id = :userId", { userId: ctx.userId })
      .andWhere("t.account_id = :accountId", { accountId: ctx.accountId })
      .andWhere("t.status = :status", {
        status: TransactionStatus.UNRECONCILED,
      })
      .andWhere("t.is_split = false")
      .andWhere("t.amount = :amount", { amount: qifTx.amount })
      .andWhere("t.transaction_date BETWEEN :lo AND :hi", { lo, hi })
      .getMany();
  }

  private async stageMatchCandidate(
    ctx: ImportContext,
    qifTx: any,
    candidates: Transaction[],
  ): Promise<void> {
    const candidate = ctx.queryRunner.manager.create(ImportMatchCandidate, {
      userId: ctx.userId,
      accountId: ctx.accountId,
      importBatchId: ctx.importBatchId,
      bankAmount: qifTx.amount,
      bankDate: qifTx.date,
      fitid: qifTx.fitid ?? null,
      bankName: qifTx.payee || null,
      bankMemo: qifTx.memo || null,
      bankReference: qifTx.number || null,
      candidateTransactionIds: candidates.map((c) => c.id),
      state: "pending",
    });
    const saved = await ctx.queryRunner.manager.save(candidate);
    if (!ctx.importResult.proposedMatches) {
      ctx.importResult.proposedMatches = [];
    }
    ctx.importResult.proposedMatches.push({
      candidateId: saved.id,
      bankAmount: qifTx.amount,
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

Wire into `processTransaction`, after the two transfer checks (after line 30) and before `resolvePayee` (line 33):

```ts
    // Match against existing hand-entered UNRECONCILED rows (amount + date window).
    // On a hit, stage for review instead of inserting a duplicate.
    const matchCandidates = await this.findMatchCandidates(ctx, qifTx);
    if (matchCandidates.length > 0) {
      await this.stageMatchCandidate(ctx, qifTx, matchCandidates);
      return;
    }
```

- [ ] **Step 10: Run to verify pass**

Run: `npm test -- src/import/import-regular-processor.service.spec.ts -t "heuristic match staging"`
Expected: PASS.

- [ ] **Step 11: Full processor spec + compile**

Run: `npm test -- src/import/import-regular-processor.service.spec.ts && cd ~/Gentoo_Dev/monize/backend && npx tsc --noEmit`
Expected: all tests pass; no type errors. (If `import.service.ts` or other DTO-literal sites now fail to compile, add `proposedMatches` is optional so they need no change; only the added `importBatchId` context field must be present in `ctx` — confirm line 1232-1247 includes it.)

- [ ] **Step 12: Commit**

```bash
git add backend/src/import/import-match.util.ts backend/src/import/import-match.util.spec.ts backend/src/import/dto/import.dto.ts backend/src/import/import-context.ts backend/src/import/import.service.ts backend/src/import/import-regular-processor.service.ts backend/src/import/import-regular-processor.service.spec.ts
git commit -m "feat(t-235): stage UNRECONCILED matches for review instead of inserting"
```

---

### Task 6: Resolve API — merge / keep-both / list

**Files:**
- Create: `backend/src/import/import-match.service.ts`
- Create: `backend/src/import/import-match.service.spec.ts`
- Create: `backend/src/import/import-match.controller.ts`
- Modify: `backend/src/import/import.module.ts` (providers + controllers)

**Interfaces:**
- Consumes: `ImportMatchCandidate`, `Transaction`, `TransactionStatus`, `updateAccountBalance`.
- Produces:
  - `ImportMatchService.listPending(userId): Promise<ImportMatchCandidate[]>`
  - `ImportMatchService.merge(userId, candidateId, transactionId): Promise<void>`
  - `ImportMatchService.keepBoth(userId, candidateId): Promise<Transaction>`
  - Routes: `GET import/matches`, `POST import/matches/:id/merge`, `POST import/matches/:id/keep-both`.

- [ ] **Step 1: Write the failing service tests**

Create `backend/src/import/import-match.service.spec.ts` (mirror the `TransactionReconciliationService` spec style — `TestingModule` + `getRepositoryToken` + mocked `DataSource`/`queryRunner`):

```ts
import { Test, TestingModule } from "@nestjs/testing";
import { getRepositoryToken } from "@nestjs/typeorm";
import { DataSource } from "typeorm";
import { NotFoundException } from "@nestjs/common";
import { ImportMatchService } from "./import-match.service";
import { ImportMatchCandidate } from "./entities/import-match-candidate.entity";
import { Transaction, TransactionStatus } from "../transactions/entities/transaction.entity";

describe("ImportMatchService", () => {
  let service: ImportMatchService;
  let candidateRepo: any;
  let managerUpdate: jest.Mock;
  let managerSave: jest.Mock;
  let queryRunner: any;

  beforeEach(async () => {
    managerUpdate = jest.fn().mockResolvedValue({ affected: 1 });
    managerSave = jest.fn().mockImplementation((e) => Promise.resolve({ ...e, id: "new-txn" }));
    queryRunner = {
      connect: jest.fn(), startTransaction: jest.fn(),
      commitTransaction: jest.fn(), rollbackTransaction: jest.fn(), release: jest.fn(),
      manager: {
        update: managerUpdate,
        save: managerSave,
        create: jest.fn().mockImplementation((_c, d) => ({ ...d })),
        findOne: jest.fn().mockResolvedValue({
          id: "acc-1", currentBalance: 100, currencyCode: "USD",
        }),
      },
    };
    candidateRepo = {
      find: jest.fn(),
      findOne: jest.fn(),
      update: jest.fn().mockResolvedValue({ affected: 1 }),
    };
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ImportMatchService,
        { provide: getRepositoryToken(ImportMatchCandidate), useValue: candidateRepo },
        { provide: DataSource, useValue: { createQueryRunner: () => queryRunner } },
      ],
    }).compile();
    service = module.get(ImportMatchService);
  });

  it("merge flips the chosen row to CLEARED, copies fitid/reference, keeps payee", async () => {
    candidateRepo.findOne.mockResolvedValue({
      id: "cand-1", userId: "u1", accountId: "acc-1", state: "pending",
      fitid: "F1", bankReference: "R1", bankMemo: "BANK MEMO",
      candidateTransactionIds: ["txn-1"],
    });
    queryRunner.manager.findOne = jest.fn().mockResolvedValue({
      id: "txn-1", description: null, payeeName: "Google",
    });
    await service.merge("u1", "cand-1", "txn-1");
    expect(managerUpdate).toHaveBeenCalledWith(
      Transaction, "txn-1",
      expect.objectContaining({
        status: TransactionStatus.CLEARED, fitid: "F1",
        referenceNumber: "R1", description: "BANK MEMO",
      }),
    );
    // payee never in the update payload:
    expect(managerUpdate.mock.calls[0][2]).not.toHaveProperty("payeeName");
    expect(candidateRepo.update).toHaveBeenCalledWith("cand-1", { state: "merged" });
  });

  it("merge does NOT overwrite an existing description", async () => {
    candidateRepo.findOne.mockResolvedValue({
      id: "cand-1", userId: "u1", accountId: "acc-1", state: "pending",
      fitid: "F1", bankReference: null, bankMemo: "BANK MEMO",
      candidateTransactionIds: ["txn-1"],
    });
    queryRunner.manager.findOne = jest.fn().mockResolvedValue({
      id: "txn-1", description: "my note", payeeName: "Google",
    });
    await service.merge("u1", "cand-1", "txn-1");
    expect(managerUpdate.mock.calls[0][2].description).toBe("my note");
  });

  it("merge rejects a transactionId not in the candidate set", async () => {
    candidateRepo.findOne.mockResolvedValue({
      id: "cand-1", userId: "u1", state: "pending", candidateTransactionIds: ["txn-1"],
    });
    await expect(service.merge("u1", "cand-1", "txn-OTHER")).rejects.toThrow();
  });

  it("keepBoth inserts the bank row as CLEARED with its fitid", async () => {
    candidateRepo.findOne.mockResolvedValue({
      id: "cand-1", userId: "u1", accountId: "acc-1", state: "pending",
      bankAmount: -59.03, bankDate: "2026-07-02", fitid: "F2",
      bankName: "DoorDash", bankMemo: "DD", bankReference: null,
      candidateTransactionIds: ["txn-1"],
    });
    await service.keepBoth("u1", "cand-1");
    const created = (queryRunner.manager.create as jest.Mock).mock.calls.at(-1);
    expect(created[0]).toBe(Transaction);
    expect(created[1]).toEqual(expect.objectContaining({
      amount: -59.03, fitid: "F2", status: TransactionStatus.CLEARED,
    }));
    expect(candidateRepo.update).toHaveBeenCalledWith("cand-1", { state: "kept" });
  });

  it("listPending returns only this user's pending candidates", async () => {
    candidateRepo.find.mockResolvedValue([{ id: "c1" }]);
    const rows = await service.listPending("u1");
    expect(candidateRepo.find).toHaveBeenCalledWith({
      where: { userId: "u1", state: "pending" },
      order: { createdAt: "DESC" },
    });
    expect(rows).toHaveLength(1);
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npm test -- src/import/import-match.service.spec.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the service**

Create `backend/src/import/import-match.service.ts`:

```ts
import { Injectable, NotFoundException, BadRequestException } from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { DataSource, Repository } from "typeorm";
import { ImportMatchCandidate } from "./entities/import-match-candidate.entity";
import {
  Transaction,
  TransactionStatus,
} from "../transactions/entities/transaction.entity";
import { updateAccountBalance } from "./import-context";

@Injectable()
export class ImportMatchService {
  constructor(
    @InjectRepository(ImportMatchCandidate)
    private readonly candidateRepo: Repository<ImportMatchCandidate>,
    private readonly dataSource: DataSource,
  ) {}

  async listPending(userId: string): Promise<ImportMatchCandidate[]> {
    return this.candidateRepo.find({
      where: { userId, state: "pending" },
      order: { createdAt: "DESC" },
    });
  }

  private async loadPending(
    userId: string,
    candidateId: string,
  ): Promise<ImportMatchCandidate> {
    const candidate = await this.candidateRepo.findOne({
      where: { id: candidateId },
    });
    if (!candidate || candidate.userId !== userId) {
      throw new NotFoundException("Match candidate not found");
    }
    if (candidate.state !== "pending") {
      throw new BadRequestException("Match candidate already resolved");
    }
    return candidate;
  }

  /** Accept the match: flip the chosen UNRECONCILED row to CLEARED, copy the
   *  bank FITID/reference, backfill description only if empty. Keep the user's
   *  payee/category. Do NOT insert the bank row. */
  async merge(
    userId: string,
    candidateId: string,
    transactionId: string,
  ): Promise<void> {
    const candidate = await this.loadPending(userId, candidateId);
    if (!candidate.candidateTransactionIds.includes(transactionId)) {
      throw new BadRequestException(
        "transactionId is not a candidate for this match",
      );
    }
    const queryRunner = this.dataSource.createQueryRunner();
    await queryRunner.connect();
    await queryRunner.startTransaction();
    try {
      const existing = await queryRunner.manager.findOne(Transaction, {
        where: { id: transactionId, userId },
      });
      if (!existing) throw new NotFoundException("Transaction not found");
      await queryRunner.manager.update(Transaction, transactionId, {
        status: TransactionStatus.CLEARED,
        fitid: candidate.fitid,
        referenceNumber: candidate.bankReference ?? existing.referenceNumber,
        description: existing.description || candidate.bankMemo,
      });
      await queryRunner.commitTransaction();
    } catch (err) {
      await queryRunner.rollbackTransaction();
      throw err;
    } finally {
      await queryRunner.release();
    }
    await this.candidateRepo.update(candidateId, { state: "merged" });
  }

  /** Reject the match: insert the bank row as a new CLEARED transaction (with
   *  its FITID, so it never re-prompts). */
  async keepBoth(userId: string, candidateId: string): Promise<Transaction> {
    const candidate = await this.loadPending(userId, candidateId);
    const queryRunner = this.dataSource.createQueryRunner();
    await queryRunner.connect();
    await queryRunner.startTransaction();
    let saved: Transaction;
    try {
      const account = await queryRunner.manager.findOne(
        (await import("../accounts/entities/account.entity")).Account,
        { where: { id: candidate.accountId } },
      );
      const transaction = queryRunner.manager.create(Transaction, {
        userId,
        accountId: candidate.accountId,
        transactionDate: candidate.bankDate,
        amount: candidate.bankAmount,
        payeeName: candidate.bankName,
        description: candidate.bankMemo,
        referenceNumber: candidate.bankReference,
        fitid: candidate.fitid,
        status: TransactionStatus.CLEARED,
        currencyCode: account?.currencyCode ?? "USD",
      });
      saved = await queryRunner.manager.save(transaction);
      await updateAccountBalance(
        queryRunner,
        candidate.accountId,
        Number(candidate.bankAmount),
      );
      await queryRunner.commitTransaction();
    } catch (err) {
      await queryRunner.rollbackTransaction();
      throw err;
    } finally {
      await queryRunner.release();
    }
    await this.candidateRepo.update(candidateId, { state: "kept" });
    return saved;
  }
}
```

> Note: the dynamic `import(...)` for `Account` avoids a new top-level import churn; if the file already imports `Account`, use the static import instead.

- [ ] **Step 4: Run to verify pass**

Run: `npm test -- src/import/import-match.service.spec.ts`
Expected: PASS.

- [ ] **Step 5: Implement the controller**

Create `backend/src/import/import-match.controller.ts` (mirror `import.controller.ts` guard + `req.user.id`):

```ts
import { Controller, Get, Post, Param, Body, Req, UseGuards } from "@nestjs/common";
import { AuthGuard } from "@nestjs/passport";
import { ApiTags, ApiBearerAuth } from "@nestjs/swagger";
import { ImportMatchService } from "./import-match.service";

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
  merge(
    @Req() req: any,
    @Param("id") id: string,
    @Body() body: { transactionId: string },
  ) {
    return this.matchService.merge(req.user.id, id, body.transactionId);
  }

  @Post(":id/keep-both")
  keepBoth(@Req() req: any, @Param("id") id: string) {
    return this.matchService.keepBoth(req.user.id, id);
  }
}
```

- [ ] **Step 6: Register in the module**

In `backend/src/import/import.module.ts`: import `ImportMatchService` and `ImportMatchController`, add `ImportMatchService` to `providers`, and `ImportMatchController` to `controllers`.

- [ ] **Step 7: Run full import specs + compile**

Run: `npm test -- src/import && cd ~/Gentoo_Dev/monize/backend && npx tsc --noEmit`
Expected: all import specs pass; no type errors.

- [ ] **Step 8: Commit**

```bash
git add backend/src/import/import-match.service.ts backend/src/import/import-match.service.spec.ts backend/src/import/import-match.controller.ts backend/src/import/import.module.ts
git commit -m "feat(t-235): resolve API for import matches (merge / keep-both / list)"
```

---

### Task 7 (OPTIONAL, deferrable): one-time FITID backfill

> Zach chose **Accept + backfill**; the `/built-in-reports/duplicate-transactions` report is the accepted fallback, so this task is optional and may ship later. It re-stamps FITIDs from a re-imported OFX onto existing FITID-less rows (any status) without inserting — a bounded, one-time operation, NOT a change to the permanent import path. Design it as its own small task when needed; do not build speculatively (YAGNI).

- [ ] Deferred. Track as a follow-up; no code in this plan.

---

### Task 8: Live verification (mandatory before "done")

> Unit tests mock `queryRunner`, so they prove branch behavior but NOT real SQL filtering (amount-exact, the ±7-day `BETWEEN`, UNRECONCILED-only). This task exercises the real DB, per the Manor "live verification is mandatory" standard.

**Files:** none (manual/live).

- [ ] **Step 1: Create a scratch account + a hand-entered UNRECONCILED row**

In the dev Monize instance, create a throwaway checking account. Add a manual transaction: amount `-11.04`, date `2026-07-01`, payee "Google", status UNRECONCILED (leave uncleared).

- [ ] **Step 2: Import the real fixture into that account**

Import `~/Downloads/transactions.ofx` targeting the scratch account.
Expected: the response `proposedMatches` contains the `-11.04` row matched against your UNRECONCILED entry; the `-11.04` bank row is NOT inserted; the other two rows (`-59.03`, `+1948.45`) import as new CLEARED (no existing match).

- [ ] **Step 3: Confirm re-import dedup**

Import `~/Downloads/transactions.ofx` into the scratch account a second time.
Expected: `skipped` reflects the two already-inserted FITID rows; no new duplicates for them.

- [ ] **Step 4: Exercise merge**

`POST import/matches/:id/merge` with the UNRECONCILED transactionId.
Expected: your row is now `CLEARED`, carries `fitid=20260702000000011041`, payee still "Google"; candidate state `merged`; a third import of the OFX now skips the `-11.04` row via FITID dedup.

- [ ] **Step 5: Exercise keep-both on a fresh staged match**

Repeat Steps 1-2 with a new UNRECONCILED `-59.03` row, then `POST import/matches/:id/keep-both`.
Expected: the bank `-59.03` inserted as a new CLEARED row (with fitid); both rows present; account balance reflects the added row; candidate state `kept`.

- [ ] **Step 6: Delete the scratch account** (cleanup).

- [ ] **Step 7: Commit any fixups discovered during live verification.**

---

## Self-Review

**1. Spec coverage.** Data model (`fitid` + partial index) → Task 1. Parser extraction → Task 2. Staging store → Task 3. FITID dedup + insert stamping → Task 4. Amount+date+account heuristic (±7d, UNRECONCILED-only, split/transfer-excluded, target-account) + response payload → Task 5. Merge (keep payee, copy fitid/ref, backfill description-if-empty) + keep-both (insert w/ fitid) + list → Task 6. Legacy backlog / backfill → Task 7 (deferred, per decision). Live gate → Task 8. **All spec sections covered.**

**2. Placeholder scan.** No TBD/TODO. Task 7 is an explicit, decision-backed deferral, not a placeholder. Every code step shows real code; every run step shows the command + expected result.

**3. Type consistency.** `matchDateWindow` (Task 5) consumed only in Task 5. `ImportMatchCandidate` fields (Task 3) used identically in Tasks 5/6. `proposedMatches`/`ProposedMatchDto` defined Task 5, consumed Task 8. `ImportContext.importBatchId` defined Task 5, produced by `import.service.ts`, consumed by `stageMatchCandidate`. Service method names (`listPending`/`merge`/`keepBoth`) consistent between service (Task 6 Step 3), controller (Step 5), and tests. Persistence via `manager.update(Transaction, id, {...})` throughout. **Consistent.**
