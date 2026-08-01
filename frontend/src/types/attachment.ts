/**
 * Metadata for a file attached to a transaction. The bytes themselves are never
 * part of this payload -- they are fetched from the download endpoint.
 */
export interface Attachment {
  id: string;
  transactionId: string;
  filename: string;
  contentType: string;
  byteSize: number;
  sha256: string;
  createdAt: string;
}

/** Client-side limits mirroring the server (server remains authoritative). */
export const MAX_ATTACHMENT_BYTES = 10 * 1024 * 1024; // 10 MB
export const MAX_ATTACHMENTS_PER_TRANSACTION = 10;
export const ACCEPTED_ATTACHMENT_TYPES = [
  'image/jpeg',
  'image/png',
  'image/gif',
  'image/webp',
  'application/pdf',
];
