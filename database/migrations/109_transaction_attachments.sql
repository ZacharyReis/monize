-- Transaction Attachments: receipts, invoices, and supporting documents stored
-- by default directly in PostgreSQL (no external object storage required).
--
-- Two tables keep the bytes off the hot metadata path:
--   * transaction_attachments -- provider-agnostic metadata (filename, MIME,
--     size, checksum, storage provider + key). Always small and cheap to list.
--   * attachment_blobs        -- the actual bytes, owned exclusively by the
--     built-in database storage provider. The local and s3 providers store
--     nothing here and point storage_key at the file or object instead.
--
-- ON DELETE CASCADE chains transactions -> transaction_attachments ->
-- attachment_blobs so deleting a transaction removes its attachments and their
-- bytes with no application-level cleanup.

CREATE TABLE IF NOT EXISTS transaction_attachments (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    transaction_id UUID NOT NULL REFERENCES transactions(id) ON DELETE CASCADE,
    filename VARCHAR(255) NOT NULL,
    content_type VARCHAR(100) NOT NULL, -- server-sniffed MIME, not the client's claim
    byte_size BIGINT NOT NULL,
    sha256 CHAR(64) NOT NULL, -- hex digest of the original bytes (integrity + dedup)
    storage_provider VARCHAR(20) NOT NULL DEFAULT 'database', -- 'database' | 'local' | 's3'
    storage_key VARCHAR(512) NOT NULL, -- database/local: attachment id; s3: object key
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_transaction_attachments_transaction
    ON transaction_attachments(transaction_id);
CREATE INDEX IF NOT EXISTS idx_transaction_attachments_user
    ON transaction_attachments(user_id);

CREATE TABLE IF NOT EXISTS attachment_blobs (
    attachment_id UUID PRIMARY KEY REFERENCES transaction_attachments(id) ON DELETE CASCADE,
    data BYTEA NOT NULL
);
