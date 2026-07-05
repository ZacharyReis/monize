export interface ProposedMatch {
  candidateId: string;
  bankAmount: number;
  bankDate: string;
  bankName?: string;
  candidates: Array<{ id: string; transactionDate: string; amount: number; payeeName: string | null; description: string | null }>;
}

export type PendingMatch = ProposedMatch & { accountId: string; accountName: string };
