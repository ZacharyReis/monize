import {
  Injectable,
  NotFoundException,
  ConflictException,
  Logger,
} from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { Repository } from "typeorm";
import {
  ImportMatchCandidate,
  ImportMatchState,
} from "./entities/import-match-candidate.entity";
import {
  Transaction,
  TransactionStatus,
} from "../transactions/entities/transaction.entity";
import { TransactionsService } from "../transactions/transactions.service";
import { AccountsService } from "../accounts/accounts.service";

/**
 * Resolves staged import-match candidates (state `pending`) into a financial
 * outcome the user chose:
 *   - merge:    fold the incoming bank row into an existing UNRECONCILED row
 *   - keepBoth: insert the bank row as a new CLEARED transaction
 *
 * Both outcomes delegate to an INTERNAL, non-public atomic path on
 * TransactionsService so the load-bearing `fitid` is written in the SAME
 * database transaction as the balance/status/date change (Task-6 Criterion 1),
 * with the target re-validated under a row lock (Criterion 2). Each candidate
 * is transitioned with an atomic conditional `claim` BEFORE the financial
 * action, and reverted to `pending` if that action throws pre-commit.
 */
@Injectable()
export class ImportMatchService {
  private readonly logger = new Logger(ImportMatchService.name);

  constructor(
    @InjectRepository(ImportMatchCandidate)
    private readonly candidateRepo: Repository<ImportMatchCandidate>,
    @InjectRepository(Transaction)
    private readonly transactionsRepo: Repository<Transaction>,
    private readonly transactionsService: TransactionsService,
    private readonly accountsService: AccountsService,
  ) {}

  async listPending(userId: string): Promise<ImportMatchCandidate[]> {
    return this.candidateRepo.find({
      where: { userId, state: "pending" },
      order: { createdAt: "DESC" },
    });
  }

  private async loadOwned(
    userId: string,
    candidateId: string,
  ): Promise<ImportMatchCandidate> {
    const c = await this.candidateRepo.findOne({ where: { id: candidateId } });
    if (!c || c.userId !== userId) {
      throw new NotFoundException("Match candidate not found");
    }
    return c;
  }

  /**
   * Atomically transition a pending candidate. Returns true iff THIS call won
   * the race (single-row conditional UPDATE, affected === 1).
   */
  private async claim(
    userId: string,
    candidateId: string,
    next: ImportMatchState,
  ): Promise<boolean> {
    const res = await this.candidateRepo.update(
      { id: candidateId, userId, state: "pending" },
      { state: next },
    );
    return res.affected === 1;
  }

  async merge(
    userId: string,
    candidateId: string,
    transactionId: string,
  ): Promise<void> {
    const candidate = await this.loadOwned(userId, candidateId);
    if (!candidate.candidateTransactionIds.includes(transactionId)) {
      throw new ConflictException(
        "transactionId is not a candidate for this match",
      );
    }

    // Cheap fail-fast revalidation BEFORE claiming, so we don't needlessly burn
    // the candidate on an obviously-ineligible target. The authoritative
    // re-check happens under a row lock inside applyImportedMatch().
    const existing = await this.transactionsRepo.findOne({
      where: { id: transactionId, userId },
    });
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
      // Criteria 1-3: fitid + status + date + reference + description written in
      // ONE transaction, target re-validated under SELECT ... FOR UPDATE.
      await this.transactionsService.applyImportedMatch(userId, transactionId, {
        bankDate: candidate.bankDate,
        fitid: candidate.fitid,
        referenceNumber: candidate.bankReference,
        bankMemo: candidate.bankMemo,
        expectedAccountId: candidate.accountId,
        expectedAmount: Number(candidate.bankAmount),
      });
    } catch (err) {
      // Nothing was committed by applyImportedMatch (it rolls back its own txn),
      // so release the claim back to pending for a later retry.
      await this.candidateRepo.update({ id: candidateId }, { state: "pending" });
      throw err;
    }
  }

  async keepBoth(userId: string, candidateId: string): Promise<Transaction> {
    const candidate = await this.loadOwned(userId, candidateId);
    const account = await this.accountsService.findOne(
      userId,
      candidate.accountId,
    );

    if (!(await this.claim(userId, candidateId, "kept"))) {
      throw new ConflictException("Match candidate already resolved");
    }
    try {
      // Criteria 1 & 3: creates the row AND its status=CLEARED + fitid in one
      // atomic internal call; fitid never touches the public create DTO.
      return await this.transactionsService.createImportedRow(
        userId,
        {
          accountId: candidate.accountId,
          transactionDate: candidate.bankDate,
          amount: Number(candidate.bankAmount),
          currencyCode: account.currencyCode,
          payeeName: candidate.bankName ?? undefined,
          description: candidate.bankMemo ?? undefined,
          referenceNumber: candidate.bankReference ?? undefined,
        },
        candidate.fitid,
      );
    } catch (err) {
      // Nothing was created (createImportedRow rolls back its own txn).
      await this.candidateRepo.update({ id: candidateId }, { state: "pending" });
      throw err;
    }
  }
}
