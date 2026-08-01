import apiClient from './api';
import { Category, CreateCategoryData, UpdateCategoryData } from '@/types/category';
import { dedupe, invalidateCache } from './apiCache';

export interface ImportDefaultsOptions {
  /** ISO 3166-1 alpha-2 code; omit for the country-neutral catalog. */
  country?: string;
  /** Locale to create the category names in; omit to use the saved language. */
  language?: string;
}

export const categoriesApi = {
  // Create category
  create: async (data: CreateCategoryData): Promise<Category> => {
    const response = await apiClient.post<Category>('/categories', data);
    invalidateCache('categories:');
    return response.data;
  },

  // Get all categories
  getAll: async (): Promise<Category[]> => {
    return dedupe(
      'categories:all',
      async () => {
        const response = await apiClient.get<Category[]>('/categories');
        return response.data;
      },
      300_000, // 5 min - categories rarely change
    );
  },

  // Get category by ID
  getById: async (id: string): Promise<Category> => {
    const response = await apiClient.get<Category>(`/categories/${id}`);
    return response.data;
  },

  // Update category
  update: async (id: string, data: UpdateCategoryData): Promise<Category> => {
    const response = await apiClient.patch<Category>(`/categories/${id}`, data);
    invalidateCache('categories:');
    return response.data;
  },

  // Delete category
  delete: async (id: string): Promise<void> => {
    await apiClient.delete(`/categories/${id}`);
    invalidateCache('categories:');
  },

  // Get transaction count for a category
  getTransactionCount: async (id: string): Promise<number> => {
    const response = await apiClient.get<number>(`/categories/${id}/transaction-count`);
    return response.data;
  },

  // Reassign transactions from one category to another
  reassignTransactions: async (
    fromCategoryId: string,
    toCategoryId: string | null,
  ): Promise<{ transactionsUpdated: number; splitsUpdated: number }> => {
    const response = await apiClient.post<{ transactionsUpdated: number; splitsUpdated: number }>(
      `/categories/${fromCategoryId}/reassign`,
      { toCategoryId },
    );
    return response.data;
  },

  // Countries that have a default-category overlay (ISO 3166-1 alpha-2)
  getDefaultCountries: async (): Promise<string[]> => {
    const response = await apiClient.get<{ countries: string[] }>(
      '/categories/default-countries',
    );
    return response.data.countries;
  },

  // Import default categories for new users. The country selects the
  // country-specific additions layered over the generic catalog; the language
  // selects the locale the category names are created in.
  importDefaults: async (
    options: ImportDefaultsOptions = {},
  ): Promise<{ categoriesCreated: number }> => {
    const response = await apiClient.post<{ categoriesCreated: number }>(
      '/categories/import-defaults',
      options,
    );
    invalidateCache('categories:');
    return response.data;
  },
};
