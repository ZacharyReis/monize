import { ImportMatchCandidate } from "./entities/import-match-candidate.entity";
import {
  Transaction,
  TransactionStatus,
} from "../transactions/entities/transaction.entity";

/**
 * Hydrates a staged ImportMatchCandidate's `candidateTransactionIds` into the
 * ProposedMatchDto shape, re-validating each referenced transaction's live
 * eligibility (UNRECONCILED, same account, not split/transfer/linked) so a
 * candidate that has since been resolved, moved, or linked elsewhere never
 * surfaces as a live merge target. Order of `candidateTransactionIds` is
 * preserved; an absent or now-ineligible transaction is silently dropped
 * (never throws) -- the caller sees `candidates: []` for a fully-stale row.
 */
export function toProposedMatch(
  candidate: ImportMatchCandidate,
  transactions: Transaction[],
) {
  const byId = new Map(transactions.map((t) => [t.id, t]));
  const candidates = candidate.candidateTransactionIds
    .map((id) => byId.get(id))
    .filter(
      (t): t is Transaction =>
        !!t &&
        t.status === TransactionStatus.UNRECONCILED &&
        t.accountId === candidate.accountId &&
        !t.isSplit &&
        !t.isTransfer &&
        !t.linkedTransactionId,
    )
    .map((t) => ({
      id: t.id,
      transactionDate: t.transactionDate,
      amount: Number(t.amount),
      payeeName: t.payeeName,
      description: t.description,
    }));
  return {
    candidateId: candidate.id,
    bankAmount: Number(candidate.bankAmount),
    bankDate: candidate.bankDate,
    bankName: candidate.bankName ?? undefined,
    candidates,
  };
}
