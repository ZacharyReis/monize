import apiClient from './api';
import { invalidateCache } from './apiCache';
import { PendingMatch } from '@/types/import';
import { Transaction } from '@/types/transaction';

export const importMatchesApi = {
  list: async (): Promise<PendingMatch[]> =>
    (await apiClient.get<PendingMatch[]>('/import/matches')).data,

  merge: async (candidateId: string, transactionId: string): Promise<void> => {
    await apiClient.post(`/import/matches/${candidateId}/merge`, { transactionId });
    invalidateCache('transactions:');
    invalidateCache('accounts:');
    invalidateCache('investments:');
  },

  keepBoth: async (candidateId: string): Promise<Transaction> => {
    const response = await apiClient.post<Transaction>(`/import/matches/${candidateId}/keep-both`);
    invalidateCache('transactions:');
    invalidateCache('accounts:');
    invalidateCache('investments:');
    return response.data;
  },

  dismiss: async (candidateId: string): Promise<void> => {
    await apiClient.post(`/import/matches/${candidateId}/dismiss`);
    invalidateCache('transactions:');
    invalidateCache('accounts:');
    invalidateCache('investments:');
  },
};
