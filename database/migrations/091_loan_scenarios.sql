-- Saved loan overpayment scenarios (what-if simulations on the loan detail page)
CREATE TABLE IF NOT EXISTS loan_scenarios (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    account_id UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
    name VARCHAR(100) NOT NULL,
    recurring_extra_amount DECIMAL(20,4),
    recurring_extra_start_date DATE,
    recurring_extra_end_date DATE,
    lump_sums JSONB NOT NULL DEFAULT '[]',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_loan_scenarios_user ON loan_scenarios(user_id);
CREATE INDEX IF NOT EXISTS idx_loan_scenarios_account ON loan_scenarios(account_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_loan_scenarios_account_name
    ON loan_scenarios(user_id, account_id, LOWER(name));
