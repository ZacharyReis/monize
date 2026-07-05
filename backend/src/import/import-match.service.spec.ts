import { Test, TestingModule } from "@nestjs/testing";
import { getRepositoryToken } from "@nestjs/typeorm";
import { ConflictException, NotFoundException } from "@nestjs/common";
import { In } from "typeorm";
import { ImportMatchService } from "./import-match.service";
import { ImportMatchCandidate } from "./entities/import-match-candidate.entity";
import {
  Transaction,
  TransactionStatus,
} from "../transactions/entities/transaction.entity";
import { TransactionsService } from "../transactions/transactions.service";
import { AccountsService } from "../accounts/accounts.service";

/**
 * Unit tests for ImportMatchService.
 *
 * NOTE: These tests target the ATOMIC internal-delegation design mandated by
 * the Task-6 acceptance criteria (fitid written in the SAME db transaction as
 * status/date/balance, never on a public DTO). They intentionally diverge from
 * the older "split write" shape in the brief's Step-3 reference (txService.update
 * + a separate transactionsRepo.update marker copy), which the brief explicitly
 * flags as shape-only and contradicting Criterion 1. Here `merge` delegates to
 * the internal `TransactionsService.applyImportedMatch` and `keepBoth` to
 * `TransactionsService.createImportedRow`; both are mocked.
 */
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
      find: jest.fn().mockResolvedValue([]),
    };
    txService = {
      applyImportedMatch: jest
        .fn()
        .mockResolvedValue({ id: "txn-1", status: TransactionStatus.CLEARED }),
      createImportedRow: jest
        .fn()
        .mockResolvedValue({ id: "new-txn", status: TransactionStatus.CLEARED }),
    };
    accountsService = {
      findOne: jest.fn().mockResolvedValue({ id: "acc-1", currencyCode: "USD" }),
      findByIds: jest.fn().mockResolvedValue([]),
    };

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
    id: "cand-1",
    userId: "u1",
    accountId: "acc-1",
    state: "pending",
    bankAmount: -11.04,
    bankDate: "2026-07-02",
    fitid: "F1",
    bankName: "Google",
    bankMemo: "BANK MEMO",
    bankReference: "R1",
    candidateTransactionIds: ["txn-1"],
    ...over,
  });
  const targetTxn = (over = {}) => ({
    id: "txn-1",
    userId: "u1",
    accountId: "acc-1",
    amount: -11.04,
    status: TransactionStatus.UNRECONCILED,
    isSplit: false,
    isTransfer: false,
    description: null,
    referenceNumber: null,
    ...over,
  });

  describe("merge", () => {
    it("claims the candidate then delegates the atomic apply to TransactionsService.applyImportedMatch", async () => {
      candidateRepo.findOne.mockResolvedValue(pendingCandidate());
      transactionsRepo.findOne.mockResolvedValue(targetTxn());

      await service.merge("u1", "cand-1", "txn-1");

      // Atomic claim BEFORE the financial action.
      expect(candidateRepo.update).toHaveBeenCalledWith(
        { id: "cand-1", userId: "u1", state: "pending" },
        { state: "merged" },
      );
      // fitid + bankDate + markers all handed to the single atomic path.
      expect(txService.applyImportedMatch).toHaveBeenCalledWith(
        "u1",
        "txn-1",
        expect.objectContaining({
          bankDate: "2026-07-02",
          fitid: "F1",
          referenceNumber: "R1",
          bankMemo: "BANK MEMO",
          expectedAccountId: "acc-1",
          expectedAmount: -11.04,
        }),
      );
    });

    it("never passes payee/category/status through the apply path (marker-only, balance-neutral fields owned internally)", async () => {
      candidateRepo.findOne.mockResolvedValue(pendingCandidate());
      transactionsRepo.findOne.mockResolvedValue(targetTxn());

      await service.merge("u1", "cand-1", "txn-1");

      const opts = txService.applyImportedMatch.mock.calls[0][2];
      expect(opts).not.toHaveProperty("payeeName");
      expect(opts).not.toHaveProperty("categoryId");
      expect(opts).not.toHaveProperty("amount");
    });

    it("throws Conflict when the claim is lost (affected=0) and does NOT touch transactions", async () => {
      candidateRepo.findOne.mockResolvedValue(pendingCandidate());
      transactionsRepo.findOne.mockResolvedValue(targetTxn());
      candidateRepo.update.mockResolvedValueOnce({ affected: 0 });

      await expect(service.merge("u1", "cand-1", "txn-1")).rejects.toBeInstanceOf(
        ConflictException,
      );
      expect(txService.applyImportedMatch).not.toHaveBeenCalled();
    });

    it("revalidates before claiming: throws if the target is no longer UNRECONCILED", async () => {
      candidateRepo.findOne.mockResolvedValue(pendingCandidate());
      transactionsRepo.findOne.mockResolvedValue(
        targetTxn({ status: TransactionStatus.VOID }),
      );
      await expect(service.merge("u1", "cand-1", "txn-1")).rejects.toBeInstanceOf(
        ConflictException,
      );
      expect(candidateRepo.update).not.toHaveBeenCalled();
    });

    it("revalidates before claiming: throws if the target is on a different account", async () => {
      candidateRepo.findOne.mockResolvedValue(pendingCandidate());
      transactionsRepo.findOne.mockResolvedValue(
        targetTxn({ accountId: "acc-OTHER" }),
      );
      await expect(service.merge("u1", "cand-1", "txn-1")).rejects.toBeInstanceOf(
        ConflictException,
      );
      expect(candidateRepo.update).not.toHaveBeenCalled();
    });

    it("revalidates before claiming: throws if the target became a split or transfer", async () => {
      candidateRepo.findOne.mockResolvedValue(pendingCandidate());
      transactionsRepo.findOne.mockResolvedValueOnce(targetTxn({ isSplit: true }));
      await expect(service.merge("u1", "cand-1", "txn-1")).rejects.toBeInstanceOf(
        ConflictException,
      );

      candidateRepo.findOne.mockResolvedValue(pendingCandidate());
      transactionsRepo.findOne.mockResolvedValueOnce(
        targetTxn({ isTransfer: true }),
      );
      await expect(service.merge("u1", "cand-1", "txn-1")).rejects.toBeInstanceOf(
        ConflictException,
      );
      expect(candidateRepo.update).not.toHaveBeenCalled();
    });

    it("rejects a transactionId that is not in the candidate set", async () => {
      candidateRepo.findOne.mockResolvedValue(pendingCandidate());
      await expect(
        service.merge("u1", "cand-1", "txn-OTHER"),
      ).rejects.toBeInstanceOf(ConflictException);
      expect(candidateRepo.update).not.toHaveBeenCalled();
    });

    it("reverts the claim to pending if the atomic apply throws (nothing committed)", async () => {
      candidateRepo.findOne.mockResolvedValue(pendingCandidate());
      transactionsRepo.findOne.mockResolvedValue(targetTxn());
      txService.applyImportedMatch.mockRejectedValueOnce(new Error("boom"));

      await expect(service.merge("u1", "cand-1", "txn-1")).rejects.toThrow("boom");
      expect(candidateRepo.update).toHaveBeenLastCalledWith(
        { id: "cand-1" },
        { state: "pending" },
      );
    });

    it("throws NotFound when the candidate does not belong to the user", async () => {
      candidateRepo.findOne.mockResolvedValue(null);
      await expect(service.merge("u1", "cand-1", "txn-1")).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });

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

    // Fold: the shipped matcher excludes linked_transaction_id rows -- a
    // target that became LINKED (e.g. picked up as a transfer counterpart)
    // after being staged must be rejected here too, same as any other
    // now-ineligible target, and must never reach the claim.
    it("revalidates before claiming: throws target_ineligible if the target became LINKED (fold)", async () => {
      candidateRepo.findOne.mockResolvedValue(pendingCandidate());
      transactionsRepo.findOne.mockResolvedValue(
        targetTxn({ linkedTransactionId: "other-txn" }),
      );
      await expect(service.merge("u1", "cand-1", "txn-1")).rejects.toMatchObject({
        response: { code: "target_ineligible" },
      });
      expect(candidateRepo.update).not.toHaveBeenCalled();
    });

    it("recodes a post-claim ConflictException from applyImportedMatch (row-lock race) as target_ineligible and reverts the claim", async () => {
      candidateRepo.findOne.mockResolvedValue(pendingCandidate());
      transactionsRepo.findOne.mockResolvedValue(targetTxn());
      txService.applyImportedMatch.mockRejectedValueOnce(new ConflictException("x"));

      await expect(service.merge("u1", "cand-1", "txn-1")).rejects.toMatchObject({
        response: { code: "target_ineligible" },
      });
      expect(candidateRepo.update).toHaveBeenLastCalledWith(
        { id: "cand-1" },
        { state: "pending" },
      );
    });
  });

  describe("keepBoth", () => {
    it("claims, resolves currency, and creates a CLEARED row with fitid via createImportedRow (no post-insert stamp)", async () => {
      candidateRepo.findOne.mockResolvedValue(
        pendingCandidate({ bankAmount: -59.03, fitid: "F2", bankName: "DoorDash" }),
      );

      await service.keepBoth("u1", "cand-1");

      expect(accountsService.findOne).toHaveBeenCalledWith("u1", "acc-1");
      expect(candidateRepo.update).toHaveBeenCalledWith(
        { id: "cand-1", userId: "u1", state: "pending" },
        { state: "kept" },
      );
      expect(txService.createImportedRow).toHaveBeenCalledWith(
        "u1",
        expect.objectContaining({
          accountId: "acc-1",
          amount: -59.03,
          transactionDate: "2026-07-02",
          currencyCode: "USD",
          payeeName: "DoorDash",
        }),
        "F2",
      );
    });

    it("keeps fitid and status OFF the public create DTO (they are internal-only)", async () => {
      candidateRepo.findOne.mockResolvedValue(pendingCandidate());
      await service.keepBoth("u1", "cand-1");
      const dto = txService.createImportedRow.mock.calls[0][1];
      expect(dto).not.toHaveProperty("fitid");
      expect(dto).not.toHaveProperty("status");
    });

    it("reverts the claim to pending if createImportedRow throws", async () => {
      candidateRepo.findOne.mockResolvedValue(pendingCandidate());
      txService.createImportedRow.mockRejectedValueOnce(new Error("boom"));
      await expect(service.keepBoth("u1", "cand-1")).rejects.toThrow("boom");
      expect(candidateRepo.update).toHaveBeenLastCalledWith(
        { id: "cand-1" },
        { state: "pending" },
      );
    });

    it("throws Conflict when the claim is lost and does NOT create a row", async () => {
      candidateRepo.findOne.mockResolvedValue(pendingCandidate());
      candidateRepo.update.mockResolvedValueOnce({ affected: 0 });
      await expect(service.keepBoth("u1", "cand-1")).rejects.toBeInstanceOf(
        ConflictException,
      );
      expect(txService.createImportedRow).not.toHaveBeenCalled();
    });

    it("keepBoth double-resolve returns already_resolved", async () => {
      candidateRepo.findOne.mockResolvedValue(pendingCandidate({ state: "kept" }));
      await expect(service.keepBoth("u1", "cand-1")).rejects.toMatchObject({
        response: { code: "already_resolved" },
      });
    });
  });

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

  describe("listPending", () => {
    it("returns only this user's pending candidates, newest first, capped at 200", async () => {
      candidateRepo.find.mockResolvedValue([]);
      await service.listPending("u1");
      expect(candidateRepo.find).toHaveBeenCalledWith({
        where: { userId: "u1", state: "pending" },
        order: { createdAt: "DESC" },
        take: 200,
      });
    });

    it("returns [] without querying transactions/accounts when there are no pending candidates", async () => {
      candidateRepo.find.mockResolvedValue([]);
      const rows = await service.listPending("u1");
      expect(rows).toEqual([]);
      expect(transactionsRepo.find).not.toHaveBeenCalled();
      expect(accountsService.findByIds).not.toHaveBeenCalled();
    });

    it("hydrates candidates via the shared mapper, user-scoping the batched txn fetch, and attaches account context", async () => {
      candidateRepo.find.mockResolvedValue([pendingCandidate()]);
      transactionsRepo.find.mockResolvedValue([targetTxn()]);
      accountsService.findByIds.mockResolvedValue([
        { id: "acc-1", name: "Checking" },
      ]);

      const rows = await service.listPending("u1");

      // Batched txn fetch is user-scoped (cross-user isolation).
      expect(transactionsRepo.find).toHaveBeenCalledWith({
        where: { id: In(["txn-1"]), userId: "u1" },
      });
      expect(accountsService.findByIds).toHaveBeenCalledWith("u1", ["acc-1"]);

      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({
        candidateId: "cand-1",
        accountId: "acc-1",
        accountName: "Checking",
        candidates: [
          expect.objectContaining({ id: "txn-1", amount: -11.04 }),
        ],
      });
    });

    it("falls back to an empty accountName when the account is missing", async () => {
      candidateRepo.find.mockResolvedValue([pendingCandidate()]);
      transactionsRepo.find.mockResolvedValue([targetTxn()]);
      accountsService.findByIds.mockResolvedValue([]);

      const rows = await service.listPending("u1");
      expect(rows[0].accountName).toBe("");
    });
  });
});
