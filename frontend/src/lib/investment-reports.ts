import apiClient from './api';
import {
  InvestmentReport,
  CreateInvestmentReportData,
  UpdateInvestmentReportData,
  InvestmentReportResult,
} from '@/types/investment-report';
import { getCached, setCache, invalidateCache } from './apiCache';

export interface ExecuteInvestmentReportParams {
  asOfDate?: string;
  /**
   * Override the accounts to run against for this execution. Empty array means
   * all accounts. Omit to fall back to the report's saved config.
   */
  accountIds?: string[];
}

export const investmentReportsApi = {
  create: async (data: CreateInvestmentReportData): Promise<InvestmentReport> => {
    const response = await apiClient.post<InvestmentReport>('/reports/investment', data);
    invalidateCache('investment-reports:');
    return response.data;
  },

  getAll: async (): Promise<InvestmentReport[]> => {
    const cached = getCached<InvestmentReport[]>('investment-reports:all');
    if (cached) return cached;
    const response = await apiClient.get<InvestmentReport[]>('/reports/investment');
    setCache('investment-reports:all', response.data, 300_000);
    return response.data;
  },

  getById: async (id: string): Promise<InvestmentReport> => {
    const response = await apiClient.get<InvestmentReport>(`/reports/investment/${id}`);
    return response.data;
  },

  update: async (
    id: string,
    data: UpdateInvestmentReportData,
  ): Promise<InvestmentReport> => {
    const response = await apiClient.patch<InvestmentReport>(`/reports/investment/${id}`, data);
    invalidateCache('investment-reports:');
    return response.data;
  },

  delete: async (id: string): Promise<void> => {
    await apiClient.delete(`/reports/investment/${id}`);
    invalidateCache('investment-reports:');
  },

  execute: async (
    id: string,
    params?: ExecuteInvestmentReportParams,
  ): Promise<InvestmentReportResult> => {
    const response = await apiClient.post<InvestmentReportResult>(
      `/reports/investment/${id}/execute`,
      params || {},
    );
    return response.data;
  },

  toggleFavourite: async (id: string, isFavourite: boolean): Promise<InvestmentReport> => {
    const response = await apiClient.patch<InvestmentReport>(`/reports/investment/${id}`, {
      isFavourite,
    });
    invalidateCache('investment-reports:');
    return response.data;
  },
};
