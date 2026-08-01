-- Interest-rate change history for loan/mortgage accounts.
-- 'initial' rows snapshot the origination rate the first time a change is
-- recorded; 'inferred' rows are produced by detection from payment history.
CREATE TABLE IF NOT EXISTS loan_rate_changes (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    account_id UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
    effective_date DATE NOT NULL,
    annual_rate NUMERIC(8,4) NOT NULL,
    new_payment_amount NUMERIC(20,4),
    source VARCHAR(10) NOT NULL DEFAULT 'manual',
    note VARCHAR(500),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT chk_loan_rate_changes_source CHECK (source IN ('manual', 'inferred', 'initial')),
    CONSTRAINT chk_loan_rate_changes_rate CHECK (annual_rate >= 0 AND annual_rate <= 100),
    CONSTRAINT uq_loan_rate_changes_account_date UNIQUE (account_id, effective_date)
);

CREATE INDEX IF NOT EXISTS idx_loan_rate_changes_user ON loan_rate_changes(user_id);
CREATE INDEX IF NOT EXISTS idx_loan_rate_changes_account_date
    ON loan_rate_changes(account_id, effective_date);
