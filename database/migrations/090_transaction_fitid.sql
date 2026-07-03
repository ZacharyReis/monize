-- 090_transaction_fitid.sql
-- OFX/QIF/CSV import matching (t-235): store the bank-provided FITID on
-- transactions so re-imports can be de-duplicated. NULL for hand-entered rows
-- and for QIF/CSV imports (no FITID in those formats).
ALTER TABLE transactions
    ADD COLUMN IF NOT EXISTS fitid VARCHAR(64) NULL;

-- PARTIAL-UNIQUE (money-safety backstop): a bank FITID can never physically
-- land twice in the same account, so a post-commit read failure on the import
-- resolve path can never be turned into a double-counted duplicate row on
-- retry. Legit flows are unaffected: re-imports are skipped by a SELECT
-- (isFitidDuplicate) BEFORE any insert, and two distinct bank transactions
-- never share a FITID. Hand-entered / QIF / CSV rows keep fitid NULL and are
-- exempt via the partial predicate.
CREATE UNIQUE INDEX IF NOT EXISTS idx_transactions_user_account_fitid
    ON transactions (user_id, account_id, fitid)
    WHERE fitid IS NOT NULL;
