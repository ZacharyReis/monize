import apiClient from './api';
import { Attachment } from '@/types/attachment';
import { invalidateCache } from './apiCache';

/**
 * Same-origin URL for an attachment's bytes. Rendered directly in an <img> (for
 * images) or an <a download> (for any type); the request carries the auth cookie
 * and streams straight from the backend.
 */
export function attachmentDownloadUrl(id: string): string {
  return `/api/v1/attachments/${id}/download`;
}

export const attachmentsApi = {
  list: async (transactionId: string): Promise<Attachment[]> => {
    const response = await apiClient.get<Attachment[]>(
      `/transactions/${transactionId}/attachments`,
    );
    return response.data;
  },

  upload: async (transactionId: string, file: File): Promise<Attachment> => {
    const formData = new FormData();
    formData.append('file', file);
    const response = await apiClient.post<Attachment>(
      `/transactions/${transactionId}/attachments`,
      formData,
      { headers: { 'Content-Type': 'multipart/form-data' } },
    );
    invalidateCache('attachments:');
    return response.data;
  },

  delete: async (id: string): Promise<void> => {
    await apiClient.delete(`/attachments/${id}`);
    invalidateCache('attachments:');
  },
};
