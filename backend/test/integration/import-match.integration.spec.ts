import { TestingModule } from "@nestjs/testing";
import { ConflictException } from "@nestjs/common";
import { DataSource } from "typeorm";
import { randomUUID } from "crypto";
import { ImportMatchService } from "@/import/import-match.service";
import { ImportModule } from "@/import/import.module";
import { ImportMatchCandidate } from "@/import/entities/import-match-candidate.entity";
import { TransactionsService } from "@/transactions/transactions.service";
import {
  Transaction,
  TransactionStatus,
} from "@/transactions/entities/transaction.entity";
import { AccountsService } from "@/accounts/accounts.service";
import { Account } from "@/accounts/entities/account.entity";
import {
  createIntegrationModule,
  cleanTables,
  createTestUserDirect,
} from "../helpers/integration-setup";
import { createTestAccount } from "../helpers/test-factories";

/**
 * DB-backed integration test for the Task-6 resolve API (merge / keep-both).
 *
 * Focus (acceptance Criterion 4):
 *   - ATOMICITY: a failure between the balance write and the fitid write must
 *     leave EITHER a fully-applied row (CLEARED + fitid) OR an untouched
 *     UNRECONCILED row -- never a CLEARED-without-fitid row.
 *   - a re-import must never double-count (the fitid the resolve stamps is the
 *     dedup key the importer uses to skip the row next time).
 *   - happy paths: merge adopts the bank date + fitid; keepBoth inserts a new
 *     CLEARED + fitid row with the correct balance.
 *   - double-resolve returns 409.
 */
describe("Import match resolve (integration)", () => {
  let module: TestingModule;
  let matchService: ImportMatchService;
  let txService: TransactionsService;
  let accountsService: AccountsService;
  let dataSource: DataSource;
  let userId: string;
  let accountId: string;

  beforeAll(async () => {
    module = await createIntegrationModule([ImportModule]);
    matchService = module.get(ImportMatchService);
    txService = module.get(TransactionsService);
    accountsService = module.get(AccountsService);
    dataSource = module.get(DataSource);
  });

  afterAll(async () => {
    await module.close();
  });

  beforeEach(async () => {
    jest.restoreAllMocks();
    await cleanTables(dataSource, [
      "import_match_candidate",
      "action_history",
      "transaction_splits",
      "transactions",
      "accounts",
      "categories",
      "payees",
      "scheduled_transaction_splits",
      "scheduled_transaction_overrides",
      "scheduled_transactions",
      "investment_transactions",
      "monthly_account_balances",
      "users",
    ]);
    const user = await createTestUserDirect(dataSource);
    userId = user.id;
    const account = await createTestAccount(dataSource, userId, {
      openingBalance: 1000,
      currentBalance: 1000,
    });
    accountId = account.id;
  });

  async function stageCandidate(
    over: Partial<ImportMatchCandidate> = {},
  ): Promise<ImportMatchCandidate> {
    const candidate = dataSource.manager.create(ImportMatchCandidate, {
      userId,
      accountId,
      importBatchId: randomUUID(),
      bankAmount: -50,
      bankDate: "2026-06-15",
      fitid: "FIT-1",
      bankName: "Bank Payee",
      bankMemo: "BANK MEMO",
      bankReference: "REF-1",
      candidateTransactionIds: [],
      state: "pending",
      ...over,
    });
    return dataSource.manager.save(candidate);
  }

  const balanceOf = async (): Promise<number> => {
    const acc = await dataSource.manager.findOneOrFail(Account, {
      where: { id: accountId },
    });
    return Number(acc.currentBalance);
  };

  describe("merge", () => {
    it("adopts the bank date + fitid, clears the row, and preserves the amount/balance", async () => {
      const target = await txService.create(userId, {
        accountId,
        transactionDate: "2026-01-15",
        amount: -50,
        currencyCode: "USD",
      });
      expect(await balanceOf()).toBe(950);

      const cand = await stageCandidate({
        candidateTransactionIds: [target.id],
        bankAmount: -50,
        bankDate: "2026-06-15",
        fitid: "FIT-MERGE",
      });

      await matchService.merge(userId, cand.id, target.id);

      const row = await dataSource.manager.findOneOrFail(Transaction, {
        where: { id: target.id },
      });
      // fitid and CLEARED status land together -- never one without the other.
      expect(row.status).toBe(TransactionStatus.CLEARED);
      expect(row.fitid).toBe("FIT-MERGE");
      expect(row.transactionDate).toBe("2026-06-15"); // adopted the bank date
      expect(row.referenceNumber).toBe("REF-1");
      expect(row.description).toBe("BANK MEMO"); // filled an empty description

      const c = await dataSource.manager.findOneOrFail(ImportMatchCandidate, {
        where: { id: cand.id },
      });
      expect(c.state).toBe("merged");

      // Amount unchanged, both dates in the past -> balance still 950.
      expect(await balanceOf()).toBe(950);
    });

    it("never overwrites an existing user description", async () => {
      const target = await txService.create(userId, {
        accountId,
        transactionDate: "2026-01-15",
        amount: -50,
        currencyCode: "USD",
        description: "my own note",
      });
      const cand = await stageCandidate({
        candidateTransactionIds: [target.id],
        bankAmount: -50,
        bankMemo: "BANK MEMO",
      });

      await matchService.merge(userId, cand.id, target.id);

      const row = await dataSource.manager.findOneOrFail(Transaction, {
        where: { id: target.id },
      });
      expect(row.description).toBe("my own note");
    });

    it("ATOMIC: a failure in the balance step rolls back the fitid write -- row stays UNRECONCILED with no fitid", async () => {
      const target = await txService.create(userId, {
        accountId,
        transactionDate: "2026-01-15",
        amount: -50,
        currencyCode: "USD",
      });
      expect(await balanceOf()).toBe(950);

      // A future bank date forces the merge down the recalc path; make that
      // recalc throw to simulate a failure AFTER the row+fitid write but BEFORE
      // commit. The whole transaction must roll back.
      const cand = await stageCandidate({
        candidateTransactionIds: [target.id],
        bankAmount: -50,
        bankDate: "2027-03-01",
        fitid: "FIT-ATOMIC",
      });
      jest
        .spyOn(accountsService, "recalculateCurrentBalance")
        .mockRejectedValueOnce(new Error("simulated failure between balance and fitid"));

      await expect(
        matchService.merge(userId, cand.id, target.id),
      ).rejects.toThrow("simulated failure between balance and fitid");

      const row = await dataSource.manager.findOneOrFail(Transaction, {
        where: { id: target.id },
      });
      // Never a CLEARED-without-fitid row: fully untouched.
      expect(row.status).toBe(TransactionStatus.UNRECONCILED);
      expect(row.fitid).toBeNull();
      expect(row.transactionDate).toBe("2026-01-15");

      // Claim released back to pending for a later retry.
      const c = await dataSource.manager.findOneOrFail(ImportMatchCandidate, {
        where: { id: cand.id },
      });
      expect(c.state).toBe("pending");

      // Balance untouched -- no partial money movement.
      expect(await balanceOf()).toBe(950);
    });

    it("recalculates the balance when the merge shifts the date past<->future", async () => {
      // Target dated in the FUTURE -> not yet counted in current balance.
      const target = await txService.create(userId, {
        accountId,
        transactionDate: "2027-03-01",
        amount: -50,
        currencyCode: "USD",
      });
      expect(await balanceOf()).toBe(1000); // future row excluded

      const cand = await stageCandidate({
        candidateTransactionIds: [target.id],
        bankAmount: -50,
        bankDate: "2026-06-15", // pulls it into the past
        fitid: "FIT-SHIFT",
      });

      await matchService.merge(userId, cand.id, target.id);

      // Now counted: 1000 - 50 = 950.
      expect(await balanceOf()).toBe(950);
    });

    it("returns 409 on the second (double) resolve of the same candidate", async () => {
      const target = await txService.create(userId, {
        accountId,
        transactionDate: "2026-01-15",
        amount: -50,
        currencyCode: "USD",
      });
      const cand = await stageCandidate({
        candidateTransactionIds: [target.id],
        bankAmount: -50,
      });

      await matchService.merge(userId, cand.id, target.id);
      await expect(
        matchService.merge(userId, cand.id, target.id),
      ).rejects.toBeInstanceOf(ConflictException);
    });

    it("rejects an amount mismatch under the row-lock re-validation", async () => {
      const target = await txService.create(userId, {
        accountId,
        transactionDate: "2026-01-15",
        amount: -50,
        currencyCode: "USD",
      });
      // Candidate passes the in-set + status pre-check, but the amount no longer
      // matches -> the FOR UPDATE re-validation rejects it.
      const cand = await stageCandidate({
        candidateTransactionIds: [target.id],
        bankAmount: -99.99,
      });
      await expect(
        matchService.merge(userId, cand.id, target.id),
      ).rejects.toBeInstanceOf(ConflictException);

      const row = await dataSource.manager.findOneOrFail(Transaction, {
        where: { id: target.id },
      });
      expect(row.status).toBe(TransactionStatus.UNRECONCILED);
      expect(row.fitid).toBeNull();
    });

    it("MONEY-CRITICAL: a post-commit read failure cannot revert the candidate or leave the merge half-applied", async () => {
      // applyImportedMatch used to hydrate its return with a post-commit findOne.
      // A throw there (after commit) reverted the candidate to pending; a retry
      // then hit an already-CLEARED row and jammed. The fix builds the return
      // view inside the txn, so nothing after commit can throw.
      const target = await txService.create(userId, {
        accountId,
        transactionDate: "2026-01-15",
        amount: -50,
        currencyCode: "USD",
      });
      const cand = await stageCandidate({
        candidateTransactionIds: [target.id],
        bankAmount: -50,
        bankDate: "2026-06-15",
        fitid: "FIT-PCR-MERGE",
      });
      jest
        .spyOn(txService, "findOne")
        .mockRejectedValue(new Error("simulated post-commit read failure"));

      await expect(
        matchService.merge(userId, cand.id, target.id),
      ).resolves.toBeUndefined();

      const row = await dataSource.manager.findOneOrFail(Transaction, {
        where: { id: target.id },
      });
      expect(row.status).toBe(TransactionStatus.CLEARED);
      expect(row.fitid).toBe("FIT-PCR-MERGE");

      // Candidate is terminally `merged` -- NOT reverted to pending.
      const c = await dataSource.manager.findOneOrFail(ImportMatchCandidate, {
        where: { id: cand.id },
      });
      expect(c.state).toBe("merged");
      expect(await balanceOf()).toBe(950);
    });
  });

  // Fix 2 (defense-in-depth): a duplicate bank FITID can never physically land
  // twice in an account, so even a logic slip on the resolve path cannot become
  // a double-counted duplicate row.
  describe("fitid partial-unique backstop", () => {
    it("rejects a second row with the same (user, account, fitid) at the DB level", async () => {
      await dataSource.manager.insert(Transaction, {
        userId,
        accountId,
        transactionDate: "2026-06-15",
        amount: -10,
        currencyCode: "USD",
        exchangeRate: 1,
        status: TransactionStatus.CLEARED,
        fitid: "DUP-FIT",
      });

      await expect(
        dataSource.manager.insert(Transaction, {
          userId,
          accountId,
          transactionDate: "2026-06-16",
          amount: -20,
          currencyCode: "USD",
          exchangeRate: 1,
          status: TransactionStatus.CLEARED,
          fitid: "DUP-FIT",
        }),
      ).rejects.toThrow(/duplicate key|unique|23505/i);
    });

    it("still allows many NULL-fitid rows in one account (partial predicate exempts hand-entered / QIF / CSV)", async () => {
      await dataSource.manager.insert(Transaction, {
        userId,
        accountId,
        transactionDate: "2026-06-15",
        amount: -10,
        currencyCode: "USD",
        exchangeRate: 1,
        status: TransactionStatus.CLEARED,
        fitid: null,
      });
      await expect(
        dataSource.manager.insert(Transaction, {
          userId,
          accountId,
          transactionDate: "2026-06-16",
          amount: -20,
          currencyCode: "USD",
          exchangeRate: 1,
          status: TransactionStatus.CLEARED,
          fitid: null,
        }),
      ).resolves.toBeDefined();
    });

    it("allows the SAME fitid in a DIFFERENT account (index is per-account)", async () => {
      const other = await createTestAccount(dataSource, userId, {
        openingBalance: 0,
        currentBalance: 0,
      });
      await dataSource.manager.insert(Transaction, {
        userId,
        accountId,
        transactionDate: "2026-06-15",
        amount: -10,
        currencyCode: "USD",
        exchangeRate: 1,
        status: TransactionStatus.CLEARED,
        fitid: "SHARED-FIT",
      });
      await expect(
        dataSource.manager.insert(Transaction, {
          userId,
          accountId: other.id,
          transactionDate: "2026-06-15",
          amount: -10,
          currencyCode: "USD",
          exchangeRate: 1,
          status: TransactionStatus.CLEARED,
          fitid: "SHARED-FIT",
        }),
      ).resolves.toBeDefined();
    });
  });

  describe("keepBoth", () => {
    it("inserts a new CLEARED + fitid row and applies the balance exactly once", async () => {
      const cand = await stageCandidate({
        bankAmount: -59.03,
        bankDate: "2026-06-20",
        fitid: "FIT-KB",
        bankName: "DoorDash",
        bankMemo: "DD MEMO",
        bankReference: "KB-REF",
      });

      const created = await matchService.keepBoth(userId, cand.id);

      expect(created.status).toBe(TransactionStatus.CLEARED);
      expect(created.fitid).toBe("FIT-KB");
      expect(Number(created.amount)).toBe(-59.03);
      expect(created.transactionDate).toBe("2026-06-20");
      expect(created.payeeName).toBe("DoorDash");
      expect(created.currencyCode).toBe("USD");

      const c = await dataSource.manager.findOneOrFail(ImportMatchCandidate, {
        where: { id: cand.id },
      });
      expect(c.state).toBe("kept");

      // Balance moved once: 1000 - 59.03 = 940.97.
      expect(await balanceOf()).toBeCloseTo(940.97, 4);

      // Re-import guard: exactly one row carries the fitid (the importer dedups
      // on this, so it will never double-count on a subsequent import).
      const rows = await dataSource.manager.find(Transaction, {
        where: { fitid: "FIT-KB" },
      });
      expect(rows).toHaveLength(1);
    });

    it("returns 409 on the second (double) keep-both of the same candidate", async () => {
      const cand = await stageCandidate({ bankAmount: -12.5, fitid: "FIT-DUP" });

      await matchService.keepBoth(userId, cand.id);
      await expect(matchService.keepBoth(userId, cand.id)).rejects.toBeInstanceOf(
        ConflictException,
      );

      // Still exactly one row for that fitid -- no double insert.
      const rows = await dataSource.manager.find(Transaction, {
        where: { fitid: "FIT-DUP" },
      });
      expect(rows).toHaveLength(1);
      expect(await balanceOf()).toBeCloseTo(987.5, 4);
    });

    it("MONEY-CRITICAL: a post-commit read failure cannot revert the candidate or double-apply the balance", async () => {
      // Regression for the double-count vector: createImportedRow used to hydrate
      // its return with a post-commit findOne. If that read threw AFTER commit
      // (DB/network hiccup) the money was already committed, but keepBoth's catch
      // reverted the candidate to `pending`, so a retry inserted a SECOND CLEARED
      // row and applied the balance AGAIN. The fix returns the in-transaction
      // entity, so nothing after commit can throw. Force findOne to always throw:
      // pre-fix this made keepBoth reject and leave the candidate pending; post-fix
      // the resolve path never touches findOne, so it must still succeed cleanly.
      jest
        .spyOn(txService, "findOne")
        .mockRejectedValue(new Error("simulated post-commit read failure"));

      const cand = await stageCandidate({ bankAmount: -59.03, fitid: "FIT-PCR" });

      const created = await matchService.keepBoth(userId, cand.id);
      expect(created.status).toBe(TransactionStatus.CLEARED);
      expect(created.fitid).toBe("FIT-PCR");
      expect(Number(created.amount)).toBe(-59.03);

      // Candidate is terminally `kept` -- NOT reverted to pending.
      const c = await dataSource.manager.findOneOrFail(ImportMatchCandidate, {
        where: { id: cand.id },
      });
      expect(c.state).toBe("kept");

      // Balance applied exactly once, and exactly one row carries the fitid.
      expect(await balanceOf()).toBeCloseTo(940.97, 4);
      const rows = await dataSource.manager.find(Transaction, {
        where: { fitid: "FIT-PCR" },
      });
      expect(rows).toHaveLength(1);

      // A retry is a no-op 409 (candidate already resolved) -- never a 2nd row.
      await expect(matchService.keepBoth(userId, cand.id)).rejects.toBeInstanceOf(
        ConflictException,
      );
      const rowsAfterRetry = await dataSource.manager.find(Transaction, {
        where: { fitid: "FIT-PCR" },
      });
      expect(rowsAfterRetry).toHaveLength(1);
      expect(await balanceOf()).toBeCloseTo(940.97, 4);
    });
  });

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

  describe("listPending", () => {
    it("returns only pending candidates for the user, newest first", async () => {
      const older = await stageCandidate({ fitid: "OLD" });
      const newer = await stageCandidate({ fitid: "NEW" });
      // Force a deterministic ordering by bumping the newer row's createdAt.
      await dataSource.query(
        `UPDATE import_match_candidate SET created_at = created_at + interval '1 second' WHERE id = $1`,
        [newer.id],
      );
      await dataSource.manager.update(
        ImportMatchCandidate,
        { id: older.id },
        { state: "merged" },
      );

      const pending = await matchService.listPending(userId);
      expect(pending).toHaveLength(1);
      expect(pending[0].id).toBe(newer.id);
    });
  });
});
