-- 090_transaction_fitid.sql
-- OFX/QIF/CSV import matching (t-235): store the bank-provided FITID on
-- transactions so re-imports can be de-duplicated. NULL for hand-entered rows
-- and for QIF/CSV imports (no FITID in those formats).
ALTER TABLE transactions
    ADD COLUMN IF NOT EXISTS fitid VARCHAR(64) NULL;

CREATE INDEX IF NOT EXISTS idx_transactions_user_account_fitid
    ON transactions (user_id, account_id, fitid)
    WHERE fitid IS NOT NULL;
