import { toProposedMatch } from "./import-match.mapper";
import { ImportMatchCandidate } from "./entities/import-match-candidate.entity";
import {
  Transaction,
  TransactionStatus,
} from "../transactions/entities/transaction.entity";

describe("toProposedMatch", () => {
  const candidate = (over: Partial<ImportMatchCandidate> = {}) =>
    ({
      id: "cand-1",
      userId: "u1",
      accountId: "acc-1",
      importBatchId: "batch-1",
      bankAmount: -11.04,
      bankDate: "2026-07-02",
      fitid: "F1",
      bankName: "Google",
      bankMemo: "GOOGLE CLOUD",
      bankReference: "R1",
      candidateTransactionIds: ["t1", "t2"],
      state: "pending",
      ...over,
    }) as ImportMatchCandidate;

  const txn = (over: Partial<Transaction> = {}) =>
    ({
      id: "t1",
      accountId: "acc-1",
      transactionDate: "2026-07-01",
      amount: -11.04,
      payeeName: "Google",
      description: null,
      status: TransactionStatus.UNRECONCILED,
      isSplit: false,
      isTransfer: false,
      linkedTransactionId: null,
      ...over,
    }) as Transaction;

  it("preserves the order of candidateTransactionIds", () => {
    const t1 = txn({ id: "t1" });
    const t2 = txn({ id: "t2" });
    // Pass transactions in the OPPOSITE order to prove output order tracks
    // candidateTransactionIds, not the input array order.
    const result = toProposedMatch(candidate(), [t2, t1]);
    expect(result.candidates.map((c) => c.id)).toEqual(["t1", "t2"]);
  });

  it("casts decimal fields (bankAmount, candidate amount) to number", () => {
    const t1 = txn({ id: "t1", amount: "-11.0400" as any });
    const result = toProposedMatch(
      candidate({ bankAmount: "-11.0400" as any, candidateTransactionIds: ["t1"] }),
      [t1],
    );
    expect(result.bankAmount).toBe(-11.04);
    expect(typeof result.bankAmount).toBe("number");
    expect(result.candidates[0].amount).toBe(-11.04);
    expect(typeof result.candidates[0].amount).toBe("number");
  });

  it("drops a referenced transaction that no longer exists (absent) -> candidates: []", () => {
    const result = toProposedMatch(
      candidate({ candidateTransactionIds: ["missing"] }),
      [],
    );
    expect(result.candidates).toEqual([]);
  });

  it("drops an ineligible referenced transaction (no longer UNRECONCILED)", () => {
    const t1 = txn({ id: "t1", status: TransactionStatus.CLEARED });
    const result = toProposedMatch(
      candidate({ candidateTransactionIds: ["t1"] }),
      [t1],
    );
    expect(result.candidates).toEqual([]);
  });

  it("drops an ineligible referenced transaction (moved to a different account)", () => {
    const t1 = txn({ id: "t1", accountId: "acc-OTHER" });
    const result = toProposedMatch(
      candidate({ candidateTransactionIds: ["t1"] }),
      [t1],
    );
    expect(result.candidates).toEqual([]);
  });

  it("drops an ineligible referenced transaction (isSplit or isTransfer)", () => {
    const split = txn({ id: "t1", isSplit: true });
    expect(
      toProposedMatch(candidate({ candidateTransactionIds: ["t1"] }), [split])
        .candidates,
    ).toEqual([]);

    const transfer = txn({ id: "t2", isTransfer: true });
    expect(
      toProposedMatch(candidate({ candidateTransactionIds: ["t2"] }), [
        transfer,
      ]).candidates,
    ).toEqual([]);
  });

  // Fold: the shipped matcher excludes linked_transaction_id rows -- a target
  // that became linked (e.g. picked up as a transfer counterpart) after being
  // staged must be dropped, same as any other now-ineligible target.
  it("drops a target that has since become LINKED (fold: exclude linked rows)", () => {
    const linked = txn({ id: "t1", linkedTransactionId: "other-txn" });
    const result = toProposedMatch(
      candidate({ candidateTransactionIds: ["t1"] }),
      [linked],
    );
    expect(result.candidates).toEqual([]);
  });

  // Fold: a staged candidate's target amount can drift after staging (user
  // edits the transaction). Re-check amount at read time, same tolerance the
  // merge path enforces at transactions.service.ts (0.00005), so the list
  // never re-serves an unmergeable target in a stale loop.
  it("drops a candidate whose amount no longer matches bankAmount (edited after staging)", () => {
    const t1 = txn({ id: "t1", amount: -14.0 });
    const result = toProposedMatch(
      candidate({ candidateTransactionIds: ["t1"], bankAmount: -11.04 }),
      [t1],
    );
    expect(result.candidates).toEqual([]);
  });

  it("keeps a candidate whose amount still matches bankAmount (don't over-filter)", () => {
    const t1 = txn({ id: "t1", amount: -11.04 });
    const result = toProposedMatch(
      candidate({ candidateTransactionIds: ["t1"], bankAmount: -11.04 }),
      [t1],
    );
    expect(result.candidates.map((c) => c.id)).toEqual(["t1"]);
  });

  it("keeps a candidate within the 0.00005 merge tolerance", () => {
    const t1 = txn({ id: "t1", amount: -11.04001 });
    const result = toProposedMatch(
      candidate({ candidateTransactionIds: ["t1"], bankAmount: -11.04 }),
      [t1],
    );
    expect(result.candidates.map((c) => c.id)).toEqual(["t1"]);
  });

  it("maps bankName undefined when candidate.bankName is null", () => {
    const result = toProposedMatch(
      candidate({ bankName: null, candidateTransactionIds: [] }),
      [],
    );
    expect(result.bankName).toBeUndefined();
  });
});
