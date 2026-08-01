-- Monize - Database Schema
-- PostgreSQL Schema for Microsoft Money replacement

-- Extensions
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pgcrypto";
CREATE EXTENSION IF NOT EXISTS pg_trgm; -- trigram indexes for transaction search

-- Schema migration tracking (used by db-migrate to track applied migrations)
CREATE TABLE IF NOT EXISTS schema_migrations (
    filename VARCHAR(255) PRIMARY KEY,
    applied_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Users and Authentication
CREATE TABLE users (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    email VARCHAR(255) UNIQUE, -- NULL allowed for OIDC users without email
    password_hash VARCHAR(255), -- NULL for OIDC-only users
    first_name VARCHAR(100),
    last_name VARCHAR(100),
    auth_provider VARCHAR(50) DEFAULT 'local', -- 'local', 'oidc'
    oidc_subject VARCHAR(255) UNIQUE,
    is_active BOOLEAN DEFAULT true,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    last_login TIMESTAMP,
    last_activity_at TIMESTAMP, -- updated fire-and-forget on every authenticated request (throttled in the request interceptor) so emergency access treats "browsing the app" as resetting the dormancy timer
    reset_token VARCHAR(255),
    reset_token_expiry TIMESTAMP,
    email_verified BOOLEAN NOT NULL DEFAULT false, -- gates local login; new self-service registrants must verify their email when SMTP is enabled (bootstrap/admin/delegate/OIDC accounts are created verified)
    email_verification_token VARCHAR(255), -- hashed token emailed for email verification
    email_verification_token_expiry TIMESTAMP,
    role VARCHAR(20) NOT NULL DEFAULT 'user', -- 'admin', 'user'
    must_change_password BOOLEAN NOT NULL DEFAULT false,
    two_factor_secret VARCHAR(255), -- encrypted TOTP secret for 2FA
    pending_two_factor_secret VARCHAR(255), -- staged secret during 2FA setup
    failed_login_attempts INTEGER NOT NULL DEFAULT 0,
    locked_until TIMESTAMP,
    backup_codes TEXT,
    oidc_link_pending BOOLEAN NOT NULL DEFAULT false,
    oidc_link_token VARCHAR(255),
    oidc_link_expires_at TIMESTAMP,
    pending_oidc_subject VARCHAR(255),
    is_delegate_only BOOLEAN NOT NULL DEFAULT false, -- true when the row exists solely as an owner-managed delegate identity (created via Shared Access, never claimed via /register)
    backup_encryption_enabled BOOLEAN NOT NULL DEFAULT false,
    backup_password_enc TEXT -- backup password (login password for local, dedicated password for OIDC) encrypted with AI_ENCRYPTION_KEY for auto-backup use
);

CREATE INDEX IF NOT EXISTS idx_users_reset_token ON users(reset_token) WHERE reset_token IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_users_email_verification_token ON users(email_verification_token) WHERE email_verification_token IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_users_oidc_link_token ON users(oidc_link_token) WHERE oidc_link_token IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_users_last_activity_at ON users(last_activity_at) WHERE last_activity_at IS NOT NULL;

-- Currencies
CREATE TABLE currencies (
    code VARCHAR(3) PRIMARY KEY, -- ISO 4217 code (USD, CAD, EUR, etc)
    name VARCHAR(100) NOT NULL,
    symbol VARCHAR(10) NOT NULL,
    decimal_places SMALLINT DEFAULT 2,
    is_active BOOLEAN DEFAULT true,
    created_by_user_id UUID REFERENCES users(id) ON DELETE SET NULL, -- NULL = system currency
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Per-user currency preferences (visibility + is_active)
CREATE TABLE user_currency_preferences (
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    currency_code VARCHAR(3) NOT NULL REFERENCES currencies(code) ON DELETE CASCADE,
    is_active BOOLEAN NOT NULL DEFAULT true,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (user_id, currency_code)
);

CREATE INDEX idx_ucp_user ON user_currency_preferences(user_id);
CREATE INDEX idx_ucp_currency ON user_currency_preferences(currency_code);

-- Exchange Rates (historical data)
CREATE TABLE exchange_rates (
    id BIGSERIAL PRIMARY KEY,
    from_currency VARCHAR(3) REFERENCES currencies(code),
    to_currency VARCHAR(3) REFERENCES currencies(code),
    rate NUMERIC(20, 10) NOT NULL,
    rate_date DATE NOT NULL,
    source VARCHAR(50), -- API source name
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(from_currency, to_currency, rate_date)
);

CREATE INDEX idx_exchange_rates_date ON exchange_rates(rate_date DESC);
CREATE INDEX idx_exchange_rates_currencies ON exchange_rates(from_currency, to_currency);

-- Account Types
CREATE TYPE account_type AS ENUM (
    'CHEQUING',
    'SAVINGS',
    'CREDIT_CARD',
    'LOAN',
    'MORTGAGE',
    'INVESTMENT',
    'CASH',
    'LINE_OF_CREDIT',
    'ASSET',
    'OTHER'
);

-- Accounts
CREATE TABLE accounts (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    account_type account_type NOT NULL,
    account_sub_type VARCHAR(50), -- 'INVESTMENT_CASH', 'INVESTMENT_BROKERAGE' for linked investment pairs
    linked_account_id UUID REFERENCES accounts(id) ON DELETE SET NULL, -- links cash <-> brokerage accounts
    name VARCHAR(255) NOT NULL,
    description TEXT,
    currency_code VARCHAR(3) NOT NULL REFERENCES currencies(code),
    account_number VARCHAR(100), -- masked/encrypted
    institution VARCHAR(255), -- legacy free-text institution name (superseded by institution_id)
    institution_id UUID, -- structured financial institution (FK added after institutions table)
    opening_balance NUMERIC(20, 4) DEFAULT 0,
    current_balance NUMERIC(20, 4) DEFAULT 0,
    credit_limit NUMERIC(20, 4), -- for credit cards
    interest_rate NUMERIC(8, 4), -- for loans, mortgages, savings
    -- Credit card statement fields (constraints named to match migrations 027/028
    -- so fresh installs and upgraded installs produce the same constraint set)
    statement_due_day INTEGER, -- day of month payment is due (credit cards only)
    statement_settlement_day INTEGER, -- last day of billing cycle (credit cards only)
    is_closed BOOLEAN DEFAULT false,
    closed_date DATE,
    is_favourite BOOLEAN DEFAULT false,
    favourite_sort_order INTEGER DEFAULT 0,
    exclude_from_net_worth BOOLEAN DEFAULT false,
    -- Loan-specific fields
    payment_amount NUMERIC(20, 4), -- payment amount per period for loans
    payment_frequency VARCHAR(20), -- 'WEEKLY', 'BIWEEKLY', 'MONTHLY', 'QUARTERLY', 'YEARLY'
    payment_start_date DATE, -- when loan payments start
    source_account_id UUID REFERENCES accounts(id) ON DELETE SET NULL, -- account payments come from
    principal_category_id UUID, -- category for principal portion (FK added after categories table)
    interest_category_id UUID, -- category for interest portion (FK added after categories table)
    interest_booking_mode VARCHAR(16) NOT NULL DEFAULT 'AUTO', -- how interest is recorded for rate detection: AUTO | SPLIT | SEPARATE
    overpayment_category_id UUID, -- category tagging standalone overpayments/extra principal (FK added after categories table)
    overpayment_memo VARCHAR(255), -- memo text marking a payment as a standalone overpayment (case-insensitive substring match)
    overpayment_payee_id UUID, -- payee whose payments count as standalone overpayments/extra principal (FK added after payees table)
    -- Foreign-transaction fee: the bank's FX conversion fee (a percentage) folded
    -- into the converted amount on foreign-entered transactions.
    fx_fee_percent NUMERIC(8, 4), -- foreign-currency conversion fee as a percentage
    scheduled_transaction_id UUID, -- linked scheduled transaction for payments (FK added after scheduled_transactions table)
    -- Asset-specific fields
    asset_category_id UUID, -- category for tracking value changes on asset accounts (FK added after categories table)
    date_acquired DATE, -- date the asset was acquired (for net worth historical accuracy)
    linked_loan_account_id UUID, -- asset's financing loan/mortgage (self-referential FK added below; for the equity view)
    -- Mortgage-specific fields
    is_canadian_mortgage BOOLEAN DEFAULT false, -- Canadian mortgages use semi-annual compounding for fixed rates
    is_variable_rate BOOLEAN DEFAULT false, -- Variable rate mortgages use monthly compounding
    term_months INTEGER, -- Mortgage term length in months (e.g., 60 for 5-year term)
    term_end_date DATE, -- When the current term ends (for renewal reminders)
    amortization_months INTEGER, -- Total amortization period in months (e.g., 300 for 25 years)
    original_principal NUMERIC(20, 4), -- Original mortgage amount for reference
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT chk_statement_due_day
      CHECK (statement_due_day IS NULL OR (statement_due_day >= 1 AND statement_due_day <= 31)),
    CONSTRAINT chk_statement_settlement_day
      CHECK (statement_settlement_day IS NULL OR (statement_settlement_day >= 1 AND statement_settlement_day <= 31)),
    CONSTRAINT chk_statement_due_day_cc_only
      CHECK (account_type = 'CREDIT_CARD' OR statement_due_day IS NULL),
    CONSTRAINT chk_statement_settlement_day_cc_only
      CHECK (account_type = 'CREDIT_CARD' OR statement_settlement_day IS NULL)
);

CREATE INDEX idx_accounts_user ON accounts(user_id);
CREATE INDEX idx_accounts_type ON accounts(account_type);
CREATE INDEX idx_accounts_account_sub_type ON accounts(account_sub_type);
CREATE INDEX idx_accounts_linked_account_id ON accounts(linked_account_id);
CREATE INDEX idx_accounts_linked_loan_account_id ON accounts(linked_loan_account_id);
CREATE INDEX idx_accounts_asset_category ON accounts(asset_category_id);
CREATE INDEX idx_accounts_term_end_date ON accounts(term_end_date) WHERE account_type = 'MORTGAGE' AND term_end_date IS NOT NULL;
CREATE INDEX idx_accounts_interest_category ON accounts(interest_category_id);
CREATE INDEX idx_accounts_principal_category ON accounts(principal_category_id);
CREATE INDEX idx_accounts_overpayment_category ON accounts(overpayment_category_id);
CREATE INDEX idx_accounts_overpayment_payee ON accounts(overpayment_payee_id);
CREATE INDEX idx_accounts_scheduled_transaction ON accounts(scheduled_transaction_id);
CREATE INDEX idx_accounts_source_account ON accounts(source_account_id);
CREATE INDEX idx_accounts_institution ON accounts(institution_id);

-- Categories for transactions
CREATE TABLE categories (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    parent_id UUID REFERENCES categories(id) ON DELETE CASCADE,
    name VARCHAR(255) NOT NULL,
    description TEXT,
    icon VARCHAR(50),
    color VARCHAR(7), -- hex color
    is_income BOOLEAN DEFAULT false,
    is_system BOOLEAN DEFAULT false, -- system categories can't be deleted
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(user_id, name, parent_id)
);

CREATE INDEX idx_categories_user ON categories(user_id);
CREATE INDEX idx_categories_parent ON categories(parent_id);
CREATE INDEX idx_categories_name_trgm ON categories USING gin (name gin_trgm_ops);

-- Payees
CREATE TABLE payees (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    name VARCHAR(255) NOT NULL,
    default_category_id UUID REFERENCES categories(id),
    notes TEXT,
    is_active BOOLEAN NOT NULL DEFAULT true,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(user_id, name)
);

CREATE INDEX idx_payees_user ON payees(user_id);
CREATE INDEX idx_payees_user_active ON payees(user_id, is_active);
CREATE INDEX idx_payees_name_trgm ON payees USING gin (name gin_trgm_ops);

-- Payee Aliases (for mapping imported payee names to canonical payees)
CREATE TABLE payee_aliases (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    payee_id UUID NOT NULL REFERENCES payees(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    alias VARCHAR(255) NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_payee_aliases_payee ON payee_aliases(payee_id);
CREATE INDEX idx_payee_aliases_user ON payee_aliases(user_id);
CREATE UNIQUE INDEX idx_payee_aliases_user_alias ON payee_aliases(user_id, LOWER(alias));

-- Financial Institutions (per-user registry of banks/brokerages). The brand
-- icon is the website's favicon, fetched server-side and cached in logo_data so
-- the browser never contacts a third party to render it.
CREATE TABLE institutions (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    name VARCHAR(255) NOT NULL,
    website TEXT NOT NULL,
    country VARCHAR(2),
    logo_data BYTEA,
    logo_content_type VARCHAR(100),
    has_logo BOOLEAN NOT NULL DEFAULT false,
    logo_fetched_at TIMESTAMP,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(user_id, name)
);

CREATE INDEX idx_institutions_user ON institutions(user_id);

-- Transactions
CREATE TABLE transactions (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    account_id UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
    transaction_date DATE NOT NULL,
    payee_id UUID REFERENCES payees(id),
    payee_name VARCHAR(255), -- can be different from payee.name
    category_id UUID REFERENCES categories(id) ON DELETE SET NULL, -- category for non-split transactions
    amount NUMERIC(20, 4) NOT NULL, -- positive for income/deposits, negative for expenses
    currency_code VARCHAR(3) NOT NULL REFERENCES currencies(code),
    exchange_rate NUMERIC(20, 10) DEFAULT 1, -- rate at transaction time (account-currency units per 1 unit of original currency for foreign entry)
    -- Foreign-currency entry: amount actually paid, stored alongside the
    -- account-currency amount. NULL for ordinary transactions.
    original_amount NUMERIC(20, 4), -- amount as typed in the original currency
    original_currency_code VARCHAR(3) CONSTRAINT fk_transactions_original_currency REFERENCES currencies(code), -- currency actually paid in
    description TEXT,
    reference_number VARCHAR(100), -- check number, confirmation number, etc
    fitid VARCHAR(64), -- bank-provided FITID for OFX import dedup
    -- is_cleared / is_reconciled intentionally absent: dropped upstream by
    -- migration 110_transactions_drop_legacy_cleared_flags.sql (status supersedes).
    reconciled_date DATE,
    status VARCHAR(20) DEFAULT 'UNRECONCILED', -- 'UNRECONCILED', 'CLEARED', 'RECONCILED', 'VOID'
    is_split BOOLEAN DEFAULT false, -- indicates this is a split transaction
    parent_transaction_id UUID REFERENCES transactions(id) ON DELETE CASCADE, -- for split children
    is_transfer BOOLEAN DEFAULT false, -- indicates this is part of an account-to-account transfer
    linked_transaction_id UUID REFERENCES transactions(id) ON DELETE SET NULL, -- links the paired transfer transaction
    exclude_from_projection BOOLEAN, -- cash-flow projection recurrence intent (t-550): NULL=heuristic, TRUE=one-time, FALSE=recurring
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_transactions_user ON transactions(user_id);
CREATE INDEX idx_transactions_account ON transactions(account_id);
CREATE INDEX idx_transactions_date ON transactions(transaction_date DESC);
CREATE INDEX idx_transactions_payee ON transactions(payee_id);
CREATE INDEX idx_transactions_category ON transactions(category_id);
CREATE INDEX idx_transactions_parent ON transactions(parent_transaction_id);
CREATE INDEX idx_transactions_linked ON transactions(linked_transaction_id);
CREATE INDEX idx_transactions_original_currency ON transactions(original_currency_code);
-- Trigram indexes accelerate the register/report search (ILIKE '%term%')
CREATE INDEX idx_transactions_payee_name_trgm ON transactions USING gin (payee_name gin_trgm_ops);
CREATE INDEX idx_transactions_description_trgm ON transactions USING gin (description gin_trgm_ops);
-- Partial-UNIQUE: a bank FITID can never physically land twice in the same
-- account (money-safety backstop for the import-resolve path). NULL fitid rows
-- (hand-entered / QIF / CSV) are exempt via the partial predicate.
CREATE UNIQUE INDEX idx_transactions_user_account_fitid ON transactions (user_id, account_id, fitid) WHERE fitid IS NOT NULL;

-- Transaction Splits (details for split transactions)
CREATE TABLE transaction_splits (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    transaction_id UUID NOT NULL REFERENCES transactions(id) ON DELETE CASCADE,
    kind VARCHAR(20) NOT NULL DEFAULT 'category', -- 'category', 'transfer', or 'investment'
    category_id UUID REFERENCES categories(id) ON DELETE SET NULL,
    transfer_account_id UUID REFERENCES accounts(id) ON DELETE CASCADE, -- target account for transfer splits
    linked_transaction_id UUID REFERENCES transactions(id) ON DELETE SET NULL, -- linked transaction in target account
    amount NUMERIC(20, 4) NOT NULL,
    memo TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT chk_split_kind_exclusive CHECK (
        (kind = 'category'   AND transfer_account_id IS NULL) OR
        (kind = 'transfer'   AND transfer_account_id IS NOT NULL AND category_id IS NULL) OR
        (kind = 'investment' AND category_id IS NULL AND transfer_account_id IS NULL)
    )
);

CREATE INDEX idx_transaction_splits_transaction ON transaction_splits(transaction_id);
CREATE INDEX idx_transaction_splits_category ON transaction_splits(category_id);
CREATE INDEX idx_transaction_splits_transfer_account ON transaction_splits(transfer_account_id);
CREATE INDEX idx_transaction_splits_linked ON transaction_splits(linked_transaction_id);

-- Transaction Attachments: receipts/invoices/documents stored in Postgres by
-- default. Metadata lives here; the bytes live in attachment_blobs (database
-- provider) or an external store keyed by storage_key. See migration 109.
CREATE TABLE transaction_attachments (
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

CREATE INDEX idx_transaction_attachments_transaction ON transaction_attachments(transaction_id);
CREATE INDEX idx_transaction_attachments_user ON transaction_attachments(user_id);

-- Attachment bytes for the built-in database storage provider. Kept in a
-- separate table so the metadata table (and its list queries) never touch BYTEA.
CREATE TABLE attachment_blobs (
    attachment_id UUID PRIMARY KEY REFERENCES transaction_attachments(id) ON DELETE CASCADE,
    data BYTEA NOT NULL
);

-- Tags
CREATE TABLE tags (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    name VARCHAR(100) NOT NULL,
    color VARCHAR(7),
    icon VARCHAR(50),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE UNIQUE INDEX idx_tags_user_name ON tags(user_id, LOWER(name));
CREATE INDEX idx_tags_user ON tags(user_id);

-- Transaction Tags (many-to-many)
CREATE TABLE transaction_tags (
    transaction_id UUID NOT NULL REFERENCES transactions(id) ON DELETE CASCADE,
    tag_id UUID NOT NULL REFERENCES tags(id) ON DELETE CASCADE,
    PRIMARY KEY (transaction_id, tag_id)
);

CREATE INDEX idx_transaction_tags_tag ON transaction_tags(tag_id);
CREATE INDEX idx_transaction_tags_transaction ON transaction_tags(transaction_id);

-- Transaction Split Tags (many-to-many)
CREATE TABLE transaction_split_tags (
    transaction_split_id UUID NOT NULL REFERENCES transaction_splits(id) ON DELETE CASCADE,
    tag_id UUID NOT NULL REFERENCES tags(id) ON DELETE CASCADE,
    PRIMARY KEY (transaction_split_id, tag_id)
);

CREATE INDEX idx_transaction_split_tags_tag ON transaction_split_tags(tag_id);
CREATE INDEX idx_transaction_split_tags_split ON transaction_split_tags(transaction_split_id);

-- Securities (stocks, bonds, mutual funds, ETFs)
-- Defined before scheduled_transactions because that table (and others below)
-- carry inline FKs to securities(id); the FK target must exist first when the
-- whole schema is applied as a single script on a fresh database.
CREATE TABLE securities (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    symbol VARCHAR(20) NOT NULL, -- ticker symbol (unique per user)
    name VARCHAR(255) NOT NULL,
    security_type VARCHAR(50), -- 'STOCK', 'ETF', 'MUTUAL_FUND', 'BOND', etc
    exchange VARCHAR(50), -- 'NYSE', 'NASDAQ', 'TSX', 'TSXV', etc
    currency_code VARCHAR(3) NOT NULL REFERENCES currencies(code),
    description TEXT, -- free-text notes, optionally pre-filled from the quote provider
    is_active BOOLEAN DEFAULT true,
    is_favourite BOOLEAN NOT NULL DEFAULT false, -- pinned to the dashboard Favourite Securities widget
    skip_price_updates BOOLEAN DEFAULT false, -- for auto-generated symbols that can't be looked up
    sector VARCHAR(100),             -- stock sector from Yahoo Finance (e.g. 'Technology')
    industry VARCHAR(100),           -- stock industry (e.g. 'Consumer Electronics')
    sector_weightings JSONB,         -- ETF sector breakdown [{sector, weight}] (weight is a decimal 0-1, from Yahoo)
    country_weightings JSONB,        -- manual ETF/fund country breakdown [{name, weight}] (weight is a decimal 0-1)
    sector_data_updated_at TIMESTAMP, -- cache staleness check
    quote_provider VARCHAR(20),      -- per-security provider override: 'yahoo' | 'msn' | NULL = user default
    msn_instrument_id VARCHAR(50),   -- cached MSN Financial Instrument ID (SecId)
    historical_backfill_attempted_at TIMESTAMP, -- last time we asked the provider for a multi-year backfill
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(user_id, symbol),
    CONSTRAINT securities_quote_provider_check
      CHECK (quote_provider IS NULL OR quote_provider IN ('yahoo','msn'))
);

CREATE INDEX idx_securities_user_id ON securities(user_id);
CREATE INDEX idx_securities_symbol ON securities(symbol);
CREATE INDEX idx_securities_exchange ON securities(exchange);
CREATE INDEX idx_securities_user_favourite ON securities(user_id, is_favourite);

-- Security Tags (many-to-many) -- reuses the shared tags pool, mirrors transaction_tags
CREATE TABLE security_tags (
    security_id UUID NOT NULL REFERENCES securities(id) ON DELETE CASCADE,
    tag_id UUID NOT NULL REFERENCES tags(id) ON DELETE CASCADE,
    PRIMARY KEY (security_id, tag_id)
);

CREATE INDEX idx_security_tags_tag ON security_tags(tag_id);
CREATE INDEX idx_security_tags_security ON security_tags(security_id);

-- Scheduled Transactions (recurring payments / bills & deposits)
CREATE TABLE scheduled_transactions (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    account_id UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
    name VARCHAR(255) NOT NULL, -- display name for the scheduled transaction
    payee_id UUID REFERENCES payees(id),
    payee_name VARCHAR(255),
    category_id UUID REFERENCES categories(id) ON DELETE SET NULL,
    amount NUMERIC(20, 4) NOT NULL,
    currency_code VARCHAR(3) NOT NULL REFERENCES currencies(code),
    description TEXT,
    frequency VARCHAR(20) NOT NULL, -- 'ONCE', 'DAILY', 'WEEKLY', 'BIWEEKLY', 'EVERY4WEEKS', 'MONTHLY', 'QUARTERLY', 'YEARLY'
    next_due_date DATE NOT NULL,
    start_date DATE NOT NULL,
    end_date DATE,
    occurrences_remaining INTEGER, -- if set, countdown of remaining occurrences
    total_occurrences INTEGER, -- original total if using occurrence limit
    is_active BOOLEAN DEFAULT true,
    auto_post BOOLEAN DEFAULT false, -- automatically create transaction when due
    reminder_days_before INTEGER DEFAULT 3,
    last_posted_date DATE, -- when the transaction was last posted
    is_split BOOLEAN DEFAULT false, -- indicates amounts are split across categories
    is_transfer BOOLEAN DEFAULT false, -- indicates this is an account-to-account transfer
    transfer_account_id UUID REFERENCES accounts(id) ON DELETE SET NULL, -- destination account for transfers
    is_investment BOOLEAN DEFAULT false, -- indicates this posts as an investment transaction (mutually exclusive with is_transfer)
    investment_action VARCHAR(50), -- BUY/SELL/DIVIDEND/REINVEST/INTEREST/CAPITAL_GAIN/SPLIT/TRANSFER_IN/TRANSFER_OUT/ADD_SHARES/REMOVE_SHARES
    investment_security_id UUID REFERENCES securities(id),
    investment_funding_account_id UUID REFERENCES accounts(id), -- alternate cash source (e.g., bank for contribution+buy)
    investment_quantity NUMERIC(20, 8),
    investment_price NUMERIC(20, 6),
    investment_commission NUMERIC(20, 4) DEFAULT 0,
    investment_total_amount NUMERIC(20, 4), -- for amount-only actions (DIVIDEND, INTEREST, CAPITAL_GAIN)
    investment_exchange_rate NUMERIC(20, 10),
    tag_ids JSONB DEFAULT '[]'::jsonb, -- array of tag UUIDs to apply when posting
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT chk_scheduled_transactions_kind_exclusive CHECK (
        NOT (is_transfer = TRUE AND is_investment = TRUE)
    )
);

CREATE INDEX idx_scheduled_transactions_user ON scheduled_transactions(user_id);
CREATE INDEX idx_scheduled_transactions_next_due ON scheduled_transactions(next_due_date);
CREATE INDEX idx_scheduled_transactions_active ON scheduled_transactions(is_active);
CREATE INDEX idx_scheduled_transactions_transfer_account ON scheduled_transactions(transfer_account_id);
CREATE INDEX idx_scheduled_transactions_inv_security ON scheduled_transactions(investment_security_id) WHERE investment_security_id IS NOT NULL;

-- Scheduled Transaction Splits
CREATE TABLE scheduled_transaction_splits (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    scheduled_transaction_id UUID NOT NULL REFERENCES scheduled_transactions(id) ON DELETE CASCADE,
    kind VARCHAR(20) NOT NULL DEFAULT 'category', -- 'category', 'transfer', or 'investment'
    category_id UUID REFERENCES categories(id) ON DELETE SET NULL,
    transfer_account_id UUID REFERENCES accounts(id) ON DELETE CASCADE, -- target account for transfer splits
    amount NUMERIC(20, 4) NOT NULL,
    memo TEXT,
    -- Investment-split fields (populated when kind='investment'):
    investment_action VARCHAR(50),
    investment_security_id UUID REFERENCES securities(id),
    investment_quantity NUMERIC(20, 8),
    investment_price NUMERIC(20, 6),
    investment_commission NUMERIC(20, 4),
    investment_exchange_rate NUMERIC(20, 10),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT chk_scheduled_split_kind_exclusive CHECK (
        (kind = 'category'   AND transfer_account_id IS NULL AND investment_action IS NULL) OR
        (kind = 'transfer'   AND transfer_account_id IS NOT NULL AND category_id IS NULL AND investment_action IS NULL) OR
        (kind = 'investment' AND category_id IS NULL AND transfer_account_id IS NULL AND investment_action IS NOT NULL)
    )
);

CREATE INDEX idx_scheduled_transaction_splits_scheduled ON scheduled_transaction_splits(scheduled_transaction_id);
CREATE INDEX idx_scheduled_transaction_splits_category ON scheduled_transaction_splits(category_id);
CREATE INDEX idx_scheduled_transaction_splits_transfer_account ON scheduled_transaction_splits(transfer_account_id);
CREATE INDEX idx_scheduled_transaction_splits_inv_security ON scheduled_transaction_splits(investment_security_id);

-- Scheduled Transaction Split Tags (many-to-many)
CREATE TABLE scheduled_transaction_split_tags (
    scheduled_transaction_split_id UUID NOT NULL REFERENCES scheduled_transaction_splits(id) ON DELETE CASCADE,
    tag_id UUID NOT NULL REFERENCES tags(id) ON DELETE CASCADE,
    PRIMARY KEY (scheduled_transaction_split_id, tag_id)
);

CREATE INDEX idx_scheduled_transaction_split_tags_tag ON scheduled_transaction_split_tags(tag_id);
CREATE INDEX idx_scheduled_transaction_split_tags_split ON scheduled_transaction_split_tags(scheduled_transaction_split_id);

-- Add deferred foreign keys for loan accounts (after categories and scheduled_transactions tables exist)
ALTER TABLE accounts ADD CONSTRAINT fk_accounts_principal_category
    FOREIGN KEY (principal_category_id) REFERENCES categories(id) ON DELETE SET NULL;
ALTER TABLE accounts ADD CONSTRAINT fk_accounts_interest_category
    FOREIGN KEY (interest_category_id) REFERENCES categories(id) ON DELETE SET NULL;
ALTER TABLE accounts ADD CONSTRAINT fk_accounts_overpayment_category
    FOREIGN KEY (overpayment_category_id) REFERENCES categories(id) ON DELETE SET NULL;
ALTER TABLE accounts ADD CONSTRAINT fk_accounts_overpayment_payee
    FOREIGN KEY (overpayment_payee_id) REFERENCES payees(id) ON DELETE SET NULL;
ALTER TABLE accounts ADD CONSTRAINT fk_accounts_scheduled_transaction
    FOREIGN KEY (scheduled_transaction_id) REFERENCES scheduled_transactions(id) ON DELETE SET NULL;
ALTER TABLE accounts ADD CONSTRAINT fk_accounts_asset_category
    FOREIGN KEY (asset_category_id) REFERENCES categories(id) ON DELETE SET NULL;
ALTER TABLE accounts ADD CONSTRAINT fk_accounts_institution
    FOREIGN KEY (institution_id) REFERENCES institutions(id) ON DELETE SET NULL;
ALTER TABLE accounts ADD CONSTRAINT fk_accounts_linked_loan_account
    FOREIGN KEY (linked_loan_account_id) REFERENCES accounts(id) ON DELETE SET NULL;

-- Scheduled Transaction Overrides (for modifying individual occurrences)
CREATE TABLE scheduled_transaction_overrides (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    scheduled_transaction_id UUID NOT NULL REFERENCES scheduled_transactions(id) ON DELETE CASCADE,
    original_date DATE NOT NULL, -- The original calculated occurrence date this override replaces
    override_date DATE NOT NULL, -- The actual date for this occurrence (may differ if date was changed)
    amount NUMERIC(20, 4),
    category_id UUID REFERENCES categories(id) ON DELETE SET NULL,
    description TEXT,
    is_split BOOLEAN,
    splits JSONB, -- JSON array of split overrides: [{categoryId, amount, memo}]
    -- Per-occurrence investment overrides (BUY/SELL/REINVEST etc.); NULL means "use base value"
    investment_quantity NUMERIC(20, 8),
    investment_price NUMERIC(20, 6),
    investment_total_amount NUMERIC(20, 4),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(scheduled_transaction_id, override_date) -- NOTE: DB uses override_date, not original_date
);

CREATE INDEX idx_sched_txn_overrides_sched_txn_id ON scheduled_transaction_overrides(scheduled_transaction_id);
CREATE INDEX idx_sched_txn_overrides_date ON scheduled_transaction_overrides(override_date);
CREATE INDEX idx_sched_txn_overrides_orig ON scheduled_transaction_overrides(scheduled_transaction_id, original_date);

-- Security Prices (historical)
CREATE TABLE security_prices (
    id BIGSERIAL PRIMARY KEY,
    security_id UUID NOT NULL REFERENCES securities(id) ON DELETE CASCADE,
    price_date DATE NOT NULL,
    open_price NUMERIC(20, 6),
    high_price NUMERIC(20, 6),
    low_price NUMERIC(20, 6),
    close_price NUMERIC(20, 6) NOT NULL,
    adjusted_close NUMERIC(20, 6),
    volume BIGINT,
    source VARCHAR(50), -- yahoo_finance, msn_finance, manual, or transaction action (buy, sell, reinvest, transfer_in, transfer_out)
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(security_id, price_date)
);

CREATE INDEX idx_security_prices_security ON security_prices(security_id);
CREATE INDEX idx_security_prices_date ON security_prices(price_date DESC);

-- Investment Holdings
CREATE TABLE holdings (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    account_id UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
    security_id UUID NOT NULL REFERENCES securities(id),
    quantity NUMERIC(20, 8) NOT NULL DEFAULT 0,
    average_cost NUMERIC(20, 6), -- average cost per unit
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(account_id, security_id)
);

CREATE INDEX idx_holdings_account ON holdings(account_id);
CREATE INDEX idx_holdings_security ON holdings(security_id);

-- Investment Transactions
CREATE TYPE investment_action AS ENUM (
    'BUY',
    'SELL',
    'DIVIDEND',
    'INTEREST',
    'CAPITAL_GAIN',
    'SPLIT',
    'TRANSFER_IN',
    'TRANSFER_OUT',
    'REINVEST',
    'ADD_SHARES',
    'REMOVE_SHARES'
);

CREATE TABLE investment_transactions (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    account_id UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
    transaction_id UUID REFERENCES transactions(id) ON DELETE SET NULL,
    transaction_split_id UUID REFERENCES transaction_splits(id) ON DELETE CASCADE, -- when embedded inside a split transaction
    linked_transaction_id UUID REFERENCES investment_transactions(id) ON DELETE SET NULL, -- links the two legs of a security transfer (TRANSFER_OUT <-> TRANSFER_IN)
    security_id UUID REFERENCES securities(id),
    funding_account_id UUID REFERENCES accounts(id) ON DELETE SET NULL,
    action investment_action NOT NULL,
    transaction_date DATE NOT NULL,
    quantity NUMERIC(20, 8),
    price NUMERIC(20, 6),
    commission NUMERIC(20, 4) DEFAULT 0,
    total_amount NUMERIC(20, 4) NOT NULL,
    exchange_rate NUMERIC(20, 10) NOT NULL DEFAULT 1,
    description TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_investment_transactions_user ON investment_transactions(user_id);
CREATE INDEX idx_investment_transactions_account ON investment_transactions(account_id);
CREATE INDEX idx_investment_transactions_security ON investment_transactions(security_id);
CREATE INDEX idx_investment_transactions_date ON investment_transactions(transaction_date DESC);
CREATE INDEX idx_investment_transactions_transaction ON investment_transactions(transaction_id);
CREATE INDEX idx_investment_transactions_split_id ON investment_transactions(transaction_split_id);
CREATE INDEX idx_investment_transactions_linked ON investment_transactions(linked_transaction_id);

-- User Preferences
CREATE TABLE user_preferences (
    user_id UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    default_currency VARCHAR(3) REFERENCES currencies(code),
    date_format VARCHAR(20) DEFAULT 'YYYY-MM-DD',
    number_format VARCHAR(20) DEFAULT 'en-US',
    theme VARCHAR(20) DEFAULT 'light',
    color_theme VARCHAR(20) NOT NULL DEFAULT 'default',
    timezone VARCHAR(50) DEFAULT 'browser',
    notification_email BOOLEAN DEFAULT true,
    notification_browser BOOLEAN DEFAULT true,
    two_factor_enabled BOOLEAN DEFAULT false,
    getting_started_dismissed BOOLEAN DEFAULT false,
    week_starts_on SMALLINT DEFAULT 1,
    budget_digest_enabled BOOLEAN DEFAULT true,
    budget_digest_day VARCHAR(10) DEFAULT 'MONDAY',
    favourite_report_ids TEXT[] DEFAULT '{}',
    dashboard_widgets TEXT[] DEFAULT '{}', -- ordered visible dashboard widget ids; empty = default layout
    dashboard_widget_config JSONB NOT NULL DEFAULT '{}', -- per-widget settings (timeframe, accounts, chart type), keyed by widget id
    show_created_at BOOLEAN DEFAULT false,
    time_format VARCHAR(10) DEFAULT '24h',
    preferred_exchanges TEXT[] DEFAULT '{}',
    dismissed_update_version VARCHAR(50),
    last_seen_version VARCHAR(50), -- version whose "What's New" notes the user acknowledged (Don't show this again)
    show_whats_new BOOLEAN DEFAULT true, -- settings kill-switch for the What's New auto-popup
    tour_progress JSONB NOT NULL DEFAULT '{}', -- guided-tour completion, keyed by opaque tour id: { status, version?, updatedAt }
    default_quote_provider VARCHAR(20) NOT NULL DEFAULT 'yahoo',
    recent_transactions_limit SMALLINT NOT NULL DEFAULT 5,
    ai_bubble_enabled BOOLEAN DEFAULT false, -- opt-in app-wide floating AI chat bubble
    language VARCHAR(10) NOT NULL DEFAULT 'en', -- UI language; ISO 639-1 or BCP 47 tag matched against SUPPORTED_LOCALES
    last_client_timezone VARCHAR(64), -- Most recently reported X-Client-Timezone, used by cron jobs when timezone='browser'
    forecast_lookback_months SMALLINT DEFAULT 3, -- Manor: months of spending history for cash flow trend projection
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT user_preferences_default_quote_provider_check
      CHECK (default_quote_provider IN ('yahoo','msn')),
    CONSTRAINT user_preferences_recent_transactions_limit_check
      CHECK (recent_transactions_limit BETWEEN 1 AND 20)
);

-- Auto Backup Settings (per-user configuration for automatic backups to a folder)
CREATE TABLE auto_backup_settings (
    user_id UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    enabled BOOLEAN NOT NULL DEFAULT false,
    folder_path VARCHAR(1024) NOT NULL DEFAULT '',
    frequency VARCHAR(20) NOT NULL DEFAULT 'daily',
    backup_time VARCHAR(5) NOT NULL DEFAULT '02:00',
    timezone VARCHAR(100) NOT NULL DEFAULT 'UTC',
    retention_daily SMALLINT NOT NULL DEFAULT 7,
    retention_weekly SMALLINT NOT NULL DEFAULT 4,
    retention_monthly SMALLINT NOT NULL DEFAULT 6,
    last_backup_at TIMESTAMP,
    last_backup_status VARCHAR(20),
    last_backup_error VARCHAR(1024),
    next_backup_at TIMESTAMP,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Trusted Devices (for 2FA "remember this device" feature)
CREATE TABLE trusted_devices (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    token_hash VARCHAR(64) NOT NULL,
    device_name VARCHAR(255) NOT NULL,
    ip_address INET,
    user_agent_hash VARCHAR(64),
    last_used_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    expires_at TIMESTAMP NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_trusted_devices_user ON trusted_devices(user_id);
CREATE UNIQUE INDEX idx_trusted_devices_token ON trusted_devices(token_hash);

-- Refresh Tokens (for JWT refresh token rotation with family-based replay detection)
CREATE TABLE refresh_tokens (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    token_hash VARCHAR(64) NOT NULL,
    family_id UUID NOT NULL,
    is_revoked BOOLEAN NOT NULL DEFAULT false,
    remember_me BOOLEAN NOT NULL DEFAULT false,
    expires_at TIMESTAMP NOT NULL,
    replaced_by_hash VARCHAR(64),
    acting_as_user_id UUID REFERENCES users(id) ON DELETE CASCADE,
    delegation_id UUID,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE UNIQUE INDEX idx_refresh_tokens_token_hash ON refresh_tokens(token_hash);
CREATE INDEX idx_refresh_tokens_family ON refresh_tokens(family_id);
CREATE INDEX idx_refresh_tokens_expires ON refresh_tokens(expires_at);

-- Delegate account access (Phase 1). A user (owner) can grant another user
-- (delegate) scoped access to their data. Delegates are normal `users` rows;
-- this defines the relationship and per-account permissions. Only can_read is
-- enforced in Phase 1; the other grant columns exist for Phase 2.
CREATE TABLE account_delegates (
    id               UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    owner_user_id    UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    delegate_user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    status           VARCHAR(20) NOT NULL DEFAULT 'active', -- 'pending' | 'active' | 'revoked'
    created_at       TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at       TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    revoked_at       TIMESTAMP,
    payees_can_create     BOOLEAN NOT NULL DEFAULT false,
    payees_can_edit       BOOLEAN NOT NULL DEFAULT false,
    payees_can_delete     BOOLEAN NOT NULL DEFAULT false,
    categories_can_create BOOLEAN NOT NULL DEFAULT false,
    categories_can_edit   BOOLEAN NOT NULL DEFAULT false,
    categories_can_delete BOOLEAN NOT NULL DEFAULT false,
    tags_can_create       BOOLEAN NOT NULL DEFAULT false,
    tags_can_edit         BOOLEAN NOT NULL DEFAULT false,
    tags_can_delete       BOOLEAN NOT NULL DEFAULT false,
    bills_can_read        BOOLEAN NOT NULL DEFAULT false,
    investments_can_read  BOOLEAN NOT NULL DEFAULT false,
    budgets_can_read      BOOLEAN NOT NULL DEFAULT false,
    reports_can_read      BOOLEAN NOT NULL DEFAULT false,
    ai_can_read           BOOLEAN NOT NULL DEFAULT false,
    CONSTRAINT account_delegates_owner_delegate_unique UNIQUE (owner_user_id, delegate_user_id),
    CONSTRAINT account_delegates_no_self CHECK (owner_user_id <> delegate_user_id)
);

CREATE INDEX idx_account_delegates_delegate ON account_delegates(delegate_user_id) WHERE status = 'active';
CREATE INDEX idx_account_delegates_owner ON account_delegates(owner_user_id);

CREATE TABLE account_delegate_grants (
    id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    delegation_id UUID NOT NULL REFERENCES account_delegates(id) ON DELETE CASCADE,
    account_id    UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
    can_read   BOOLEAN NOT NULL DEFAULT true,
    can_create BOOLEAN NOT NULL DEFAULT false,
    can_edit   BOOLEAN NOT NULL DEFAULT false,
    can_delete BOOLEAN NOT NULL DEFAULT false,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT account_delegate_grants_unique UNIQUE (delegation_id, account_id)
);

CREATE INDEX idx_adg_delegation ON account_delegate_grants(delegation_id);

-- A delegate's account favourites, independent of the owner's
-- accounts.is_favourite (which stays owner-scoped).
CREATE TABLE delegate_account_favourites (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    delegate_user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    account_id UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
    sort_order INTEGER NOT NULL DEFAULT 0,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE (delegate_user_id, account_id)
);

CREATE INDEX idx_delegate_account_favourites_user
    ON delegate_account_favourites(delegate_user_id);

-- Emergency Access. Lets the owner pre-designate one or more contacts who
-- receive a magic link to take over the account after a configurable
-- period of inactivity. The free-form message body is stored as
-- AES-256-GCM ciphertext (AiEncryptionService, keyed by AI_ENCRYPTION_KEY)
-- so a database dump cannot leak it; the running app decrypts on demand.
CREATE TABLE emergency_access_settings (
    owner_user_id         UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    enabled               BOOLEAN NOT NULL DEFAULT false,
    grant_after_days      INTEGER NOT NULL DEFAULT 14 CHECK (grant_after_days > 0),
    reminder_after_days   INTEGER NOT NULL DEFAULT 7  CHECK (reminder_after_days > 0),
    message_ciphertext    TEXT,
    last_reminder_sent_at TIMESTAMP,
    granted_at            TIMESTAMP,
    created_at            TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at            TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT emergency_access_settings_reminder_lt_grant
        CHECK (reminder_after_days < grant_after_days)
);

CREATE TABLE emergency_access_contacts (
    id                     UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    owner_user_id          UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    first_name             VARCHAR(100) NOT NULL,
    email                  VARCHAR(255) NOT NULL,
    claim_token_hash       VARCHAR(128),
    claim_token_expires_at TIMESTAMP,
    claim_token_used_at    TIMESTAMP,
    claim_voided_reason    VARCHAR(20), -- 'claimed_by_other' | 'owner_revoked' | NULL
    created_at             TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at             TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE UNIQUE INDEX idx_emergency_access_contacts_owner_email
    ON emergency_access_contacts(owner_user_id, lower(email));

CREATE INDEX idx_emergency_access_contacts_token_hash
    ON emergency_access_contacts(claim_token_hash)
    WHERE claim_token_hash IS NOT NULL;

-- Custom Reports (user-defined configurable reports)
-- view_type: TABLE, LINE_CHART, BAR_CHART, PIE_CHART
-- timeframe_type: LAST_7_DAYS, LAST_30_DAYS, LAST_MONTH, LAST_3_MONTHS, LAST_6_MONTHS, LAST_12_MONTHS, LAST_YEAR, YEAR_TO_DATE, CUSTOM
-- group_by: NONE, CATEGORY, PAYEE, MONTH, WEEK, DAY
-- filters: { accountIds?: string[], categoryIds?: string[], payeeIds?: string[], searchText?: string }
-- config: {
--   metric: NONE | TOTAL_AMOUNT | COUNT | AVERAGE,
--   includeTransfers: boolean,
--   direction: INCOME_ONLY | EXPENSES_ONLY | BOTH,
--   customStartDate?: string,
--   customEndDate?: string,
--   tableColumns?: (LABEL | VALUE | COUNT | PERCENTAGE | DATE | PAYEE | DESCRIPTION | MEMO | CATEGORY | ACCOUNT)[],
--   sortBy?: LABEL | VALUE | COUNT | PERCENTAGE | DATE | PAYEE | DESCRIPTION | MEMO | CATEGORY | ACCOUNT,
--   sortDirection?: ASC | DESC
-- }
CREATE TABLE custom_reports (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    name VARCHAR(255) NOT NULL,
    description TEXT,
    icon VARCHAR(50),
    background_color VARCHAR(7),
    view_type VARCHAR(20) NOT NULL DEFAULT 'BAR_CHART',
    timeframe_type VARCHAR(30) NOT NULL DEFAULT 'LAST_3_MONTHS',
    group_by VARCHAR(20) NOT NULL DEFAULT 'CATEGORY',
    filters JSONB NOT NULL DEFAULT '{}',
    config JSONB NOT NULL DEFAULT '{"metric": "TOTAL_AMOUNT", "includeTransfers": false, "direction": "EXPENSES_ONLY"}',
    is_favourite BOOLEAN NOT NULL DEFAULT FALSE,
    sort_order INTEGER NOT NULL DEFAULT 0,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_custom_reports_user_id ON custom_reports(user_id);
CREATE INDEX idx_custom_reports_user_favourite ON custom_reports(user_id, is_favourite);
CREATE INDEX idx_custom_reports_user_sort ON custom_reports(user_id, sort_order);

-- Custom investment reports (MS Money-style portfolio column reports).
-- config JSONB shape:
-- {
--   columns: string[]      -- ordered column keys (always starts with "symbol")
--   accountIds: string[]   -- holdings accounts to include ([] = all)
--   sortColumn: string|null
--   sortDirection: ASC | DESC
--   asOfDate: string|null  -- YYYY-MM-DD, null = latest market day at run time
-- }
CREATE TABLE investment_reports (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    name VARCHAR(255) NOT NULL,
    description TEXT,
    icon VARCHAR(50),
    background_color VARCHAR(7),
    group_by VARCHAR(20) NOT NULL DEFAULT 'NONE',
    config JSONB NOT NULL DEFAULT '{}',
    is_favourite BOOLEAN NOT NULL DEFAULT FALSE,
    sort_order INTEGER NOT NULL DEFAULT 0,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_investment_reports_user_id ON investment_reports(user_id);
CREATE INDEX idx_investment_reports_user_favourite ON investment_reports(user_id, is_favourite);
CREATE INDEX idx_investment_reports_user_sort ON investment_reports(user_id, sort_order);

-- Row-Level Security identity helpers (see docs/future-plans/row-level-security.md).
--
-- app.current_user_id -- effective user (the owner when a delegate is acting).
-- app.real_user_id    -- authenticated identity (the delegate while acting);
--                        equals current_user_id outside delegation.
-- app.bypass_rls      -- set only inside an explicit withSystemContext scope.
--
-- Fail-closed: an unset/empty GUC yields NULL, every policy predicate is false,
-- zero rows. A non-UUID GUC value raises 22P02 rather than returning rows.
-- STABLE lets policies call these as (SELECT app_...()) scalar subqueries, which
-- the planner evaluates once per statement instead of once per row.

CREATE OR REPLACE FUNCTION app_current_user_id() RETURNS uuid
LANGUAGE sql STABLE AS $$
  SELECT NULLIF(current_setting('app.current_user_id', true), '')::uuid
$$;

CREATE OR REPLACE FUNCTION app_real_user_id() RETURNS uuid
LANGUAGE sql STABLE AS $$
  SELECT NULLIF(current_setting('app.real_user_id', true), '')::uuid
$$;

-- COALESCE keeps the function from returning NULL when the GUC is unset: the
-- OR-ed policy predicates are fail-closed either way, but a boolean function
-- that can return NULL would silently match nothing under `NOT app_bypass_rls()`.
CREATE OR REPLACE FUNCTION app_bypass_rls() RETURNS boolean
LANGUAGE sql STABLE AS $$
  SELECT COALESCE(current_setting('app.bypass_rls', true) = 'on', false)
$$;

COMMENT ON FUNCTION app_current_user_id() IS
  'RLS: effective user id from the app.current_user_id GUC (owner when a delegate acts). NULL when unset -- policies then match no rows.';
COMMENT ON FUNCTION app_real_user_id() IS
  'RLS: authenticated user id from the app.real_user_id GUC (the delegate while acting; equals app_current_user_id() otherwise).';
COMMENT ON FUNCTION app_bypass_rls() IS
  'RLS: true inside a withSystemContext scope, letting cross-user jobs (cron, seed, admin, pre-session auth) see every row.';

-- Triggers for updated_at timestamps.
--
-- Honours the app.preserve_timestamps GUC so backup restore can write rows with
-- their original updated_at values without ALTER TABLE ... DISABLE TRIGGER (which
-- would require table ownership the runtime role must not have). Inert while the
-- GUC is unset: current_setting(..., true) returns NULL, NULL = 'on' is not true,
-- and the function stamps CURRENT_TIMESTAMP as it always has.
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    IF current_setting('app.preserve_timestamps', true) = 'on' THEN
        -- Restore path: keep the updated_at value supplied by the caller.
        RETURN NEW;
    END IF;
    NEW.updated_at = CURRENT_TIMESTAMP;
    RETURN NEW;
END;
$$ language 'plpgsql';

COMMENT ON FUNCTION update_updated_at_column() IS
  'Stamps NEW.updated_at with CURRENT_TIMESTAMP, unless the app.preserve_timestamps GUC is ''on'' (backup restore).';

CREATE TRIGGER update_users_updated_at BEFORE UPDATE ON users FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER update_accounts_updated_at BEFORE UPDATE ON accounts FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER update_transactions_updated_at BEFORE UPDATE ON transactions FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER update_scheduled_transactions_updated_at BEFORE UPDATE ON scheduled_transactions FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER update_scheduled_transaction_overrides_updated_at BEFORE UPDATE ON scheduled_transaction_overrides FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER update_securities_updated_at BEFORE UPDATE ON securities FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER update_holdings_updated_at BEFORE UPDATE ON holdings FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER update_investment_transactions_updated_at BEFORE UPDATE ON investment_transactions FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER update_user_preferences_updated_at BEFORE UPDATE ON user_preferences FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER update_trusted_devices_updated_at BEFORE UPDATE ON trusted_devices FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER update_refresh_tokens_updated_at BEFORE UPDATE ON refresh_tokens FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER update_custom_reports_updated_at BEFORE UPDATE ON custom_reports FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER update_investment_reports_updated_at BEFORE UPDATE ON investment_reports FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- NOTE: Account balances (current_balance) are managed by application code
-- (accounts.service.ts, transactions.service.ts, import.service.ts) via updateBalance() calls.
-- No database trigger is used for balance tracking.

-- Currencies are intentionally NOT pre-seeded. A user's currency is created on
-- demand (with a proper symbol) when they pick it at onboarding, and their
-- default-preference currency is created lazily on first use if they skip.

-- Monthly Account Balances (cached end-of-month balances for net worth report)
CREATE TABLE monthly_account_balances (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  account_id UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  month DATE NOT NULL,
  balance NUMERIC(20, 4) NOT NULL DEFAULT 0,
  market_value NUMERIC(20, 4),
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (account_id, month)
);

CREATE INDEX idx_mab_user_month ON monthly_account_balances(user_id, month);

-- Create indexes for performance
CREATE INDEX idx_transactions_status ON transactions(status);
CREATE INDEX idx_accounts_closed ON accounts(is_closed);
CREATE INDEX idx_accounts_user_favourite_sort ON accounts(user_id, favourite_sort_order);
CREATE INDEX idx_scheduled_transactions_account ON scheduled_transactions(account_id);

-- Composite indexes for common query patterns
CREATE INDEX idx_transactions_user_date ON transactions(user_id, transaction_date DESC);
CREATE INDEX idx_transactions_user_account_date ON transactions(user_id, account_id, transaction_date DESC);
CREATE INDEX idx_transactions_user_date_created ON transactions(user_id, transaction_date DESC, created_at DESC, id DESC);
CREATE INDEX idx_transactions_account_date ON transactions(account_id, transaction_date DESC);
CREATE INDEX idx_mab_account_month ON monthly_account_balances(account_id, month);
CREATE INDEX idx_security_prices_security_date ON security_prices(security_id, price_date DESC);

-- AI Provider Configs (per-user AI provider configuration with encrypted API keys)
CREATE TABLE ai_provider_configs (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    provider VARCHAR(50) NOT NULL,        -- 'anthropic', 'openai', 'ollama', 'openai-compatible'
    display_name VARCHAR(100),            -- User-friendly label
    is_active BOOLEAN DEFAULT true,
    priority INTEGER DEFAULT 0,           -- For fallback ordering (lower = higher priority)
    model VARCHAR(100),                   -- e.g., 'claude-sonnet-4-20250514', 'gpt-4o', 'llama3'
    api_key_enc TEXT,                     -- Encrypted API key (null for Ollama)
    base_url VARCHAR(500),               -- Custom endpoint URL (required for Ollama/compatible)
    config JSONB DEFAULT '{}',           -- Provider-specific settings (temperature, maxTokens, etc.)
    input_cost_per_1m NUMERIC(12, 4),    -- User-defined input cost per 1M tokens (for usage cost estimation)
    output_cost_per_1m NUMERIC(12, 4),   -- User-defined output cost per 1M tokens (for usage cost estimation)
    cost_currency VARCHAR(3) NOT NULL DEFAULT 'USD', -- ISO 4217 currency of the cost rates
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(user_id, provider, priority)
);

CREATE INDEX idx_ai_provider_configs_user ON ai_provider_configs(user_id);
CREATE INDEX idx_ai_provider_configs_user_active ON ai_provider_configs(user_id, is_active);

-- AI Usage Logs (token usage tracking per AI request)
CREATE TABLE ai_usage_logs (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    provider VARCHAR(50) NOT NULL,
    model VARCHAR(100) NOT NULL,
    feature VARCHAR(50) NOT NULL,         -- 'categorize', 'insight', 'query', 'forecast', 'test'
    input_tokens INTEGER NOT NULL,
    output_tokens INTEGER NOT NULL,
    duration_ms INTEGER NOT NULL,
    error TEXT,                            -- Error message if request failed
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_ai_usage_logs_user ON ai_usage_logs(user_id);
CREATE INDEX idx_ai_usage_logs_user_created ON ai_usage_logs(user_id, created_at DESC);
CREATE INDEX idx_ai_usage_logs_user_feature ON ai_usage_logs(user_id, feature);

CREATE TRIGGER update_ai_provider_configs_updated_at
    BEFORE UPDATE ON ai_provider_configs
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- AI Insights (spending insights and anomaly detection)
CREATE TABLE ai_insights (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    type VARCHAR(50) NOT NULL,           -- 'anomaly', 'trend', 'subscription', 'budget_pace', 'seasonal', 'new_recurring'
    title VARCHAR(255) NOT NULL,
    description TEXT NOT NULL,
    severity VARCHAR(20) NOT NULL,       -- 'info', 'warning', 'alert'
    data JSONB DEFAULT '{}',             -- Supporting data (amounts, categories, dates)
    is_dismissed BOOLEAN DEFAULT false,
    generated_at TIMESTAMP NOT NULL,
    expires_at TIMESTAMP NOT NULL,       -- Auto-cleanup old insights
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_ai_insights_user ON ai_insights(user_id);
CREATE INDEX idx_ai_insights_user_dismissed ON ai_insights(user_id, is_dismissed);
CREATE INDEX idx_ai_insights_expires ON ai_insights(expires_at);
CREATE INDEX idx_ai_insights_user_type ON ai_insights(user_id, type);

-- Personal Access Tokens (for MCP server and API access)
CREATE TABLE personal_access_tokens (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    name VARCHAR(100) NOT NULL,
    token_prefix VARCHAR(8) NOT NULL,     -- First 8 chars (e.g., "pat_xxxx") for display identification
    token_hash VARCHAR(64) NOT NULL,      -- SHA-256 hash of the full token
    scopes VARCHAR(500) NOT NULL DEFAULT 'read', -- Comma-separated: 'read', 'write', 'reports'
    last_used_at TIMESTAMP,
    expires_at TIMESTAMP,                 -- NULL = never expires
    is_revoked BOOLEAN DEFAULT false,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_pat_user ON personal_access_tokens(user_id);
CREATE UNIQUE INDEX idx_pat_token_hash ON personal_access_tokens(token_hash);
CREATE INDEX idx_pat_user_active ON personal_access_tokens(user_id, is_revoked)
    WHERE is_revoked = false;

CREATE TRIGGER update_personal_access_tokens_updated_at
    BEFORE UPDATE ON personal_access_tokens
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- Budget Planner Tables

-- Budgets - core budget definition
CREATE TABLE budgets (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    name VARCHAR(255) NOT NULL,
    description TEXT,
    budget_type VARCHAR(20) NOT NULL DEFAULT 'MONTHLY',
    period_start DATE NOT NULL,
    period_end DATE,
    base_income NUMERIC(20, 4),
    income_linked BOOLEAN DEFAULT false,
    strategy VARCHAR(30) NOT NULL DEFAULT 'FIXED',
    is_active BOOLEAN DEFAULT true,
    currency_code VARCHAR(3) NOT NULL REFERENCES currencies(code),
    config JSONB NOT NULL DEFAULT '{}',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_budgets_user ON budgets(user_id);
CREATE INDEX idx_budgets_user_active ON budgets(user_id, is_active);

-- Budget Categories - per-category budget allocation
CREATE TABLE budget_categories (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    budget_id UUID NOT NULL REFERENCES budgets(id) ON DELETE CASCADE,
    category_id UUID REFERENCES categories(id) ON DELETE SET NULL,
    transfer_account_id UUID REFERENCES accounts(id) ON DELETE SET NULL,
    is_transfer BOOLEAN DEFAULT false,
    category_group VARCHAR(20),
    amount NUMERIC(20, 4) NOT NULL,
    is_income BOOLEAN DEFAULT false,
    rollover_type VARCHAR(20) DEFAULT 'NONE',
    rollover_cap NUMERIC(20, 4),
    flex_group VARCHAR(100),
    alert_warn_percent INTEGER DEFAULT 80,
    alert_critical_percent INTEGER DEFAULT 95,
    notes TEXT,
    sort_order INTEGER DEFAULT 0,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_budget_categories_budget ON budget_categories(budget_id);
CREATE INDEX idx_budget_categories_category ON budget_categories(category_id);
CREATE INDEX idx_budget_categories_transfer_account ON budget_categories(transfer_account_id)
    WHERE transfer_account_id IS NOT NULL;
CREATE INDEX idx_budget_categories_flex ON budget_categories(budget_id, flex_group)
    WHERE flex_group IS NOT NULL;

-- Budget Periods - snapshot of each completed period
CREATE TABLE budget_periods (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    budget_id UUID NOT NULL REFERENCES budgets(id) ON DELETE CASCADE,
    period_start DATE NOT NULL,
    period_end DATE NOT NULL,
    actual_income NUMERIC(20, 4) DEFAULT 0,
    actual_expenses NUMERIC(20, 4) DEFAULT 0,
    total_budgeted NUMERIC(20, 4) DEFAULT 0,
    status VARCHAR(20) DEFAULT 'OPEN',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(budget_id, period_start)
);

CREATE INDEX idx_budget_periods_budget ON budget_periods(budget_id);
CREATE INDEX idx_budget_periods_dates ON budget_periods(budget_id, period_start, period_end);
CREATE INDEX idx_budget_periods_open ON budget_periods(budget_id, status) WHERE status = 'OPEN';

-- Budget Period Categories - per-category actuals for each period
CREATE TABLE budget_period_categories (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    budget_period_id UUID NOT NULL REFERENCES budget_periods(id) ON DELETE CASCADE,
    budget_category_id UUID NOT NULL REFERENCES budget_categories(id) ON DELETE CASCADE,
    category_id UUID REFERENCES categories(id) ON DELETE SET NULL,
    budgeted_amount NUMERIC(20, 4) NOT NULL,
    rollover_in NUMERIC(20, 4) DEFAULT 0,
    actual_amount NUMERIC(20, 4) DEFAULT 0,
    effective_budget NUMERIC(20, 4) NOT NULL,
    rollover_out NUMERIC(20, 4) DEFAULT 0,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(budget_period_id, budget_category_id)
);

CREATE INDEX idx_bpc_period ON budget_period_categories(budget_period_id);
CREATE INDEX idx_bpc_category ON budget_period_categories(category_id);

-- Budget Alerts - persistent alert records
CREATE TABLE budget_alerts (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    budget_id UUID REFERENCES budgets(id) ON DELETE CASCADE,
    budget_category_id UUID REFERENCES budget_categories(id) ON DELETE CASCADE,
    alert_type VARCHAR(30) NOT NULL,
    severity VARCHAR(20) NOT NULL,
    title VARCHAR(255) NOT NULL,
    message TEXT NOT NULL,
    data JSONB DEFAULT '{}',
    is_read BOOLEAN DEFAULT false,
    is_email_sent BOOLEAN DEFAULT false,
    period_start DATE NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    dismissed_at TIMESTAMP
);

CREATE INDEX idx_budget_alerts_user ON budget_alerts(user_id);
CREATE INDEX idx_budget_alerts_user_unread ON budget_alerts(user_id, is_read) WHERE is_read = false;
CREATE INDEX idx_budget_alerts_budget_period ON budget_alerts(budget_id, period_start);

-- Triggers for budget tables updated_at
CREATE TRIGGER update_budgets_updated_at BEFORE UPDATE ON budgets FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER update_budget_categories_updated_at BEFORE UPDATE ON budget_categories FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER update_budget_periods_updated_at BEFORE UPDATE ON budget_periods FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER update_budget_period_categories_updated_at BEFORE UPDATE ON budget_period_categories FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- Import Column Mappings (for CSV imports)
CREATE TABLE import_column_mappings (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    name VARCHAR(100) NOT NULL,
    column_mappings JSONB NOT NULL,
    transfer_rules JSONB NOT NULL DEFAULT '[]'::jsonb,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(user_id, name)
);

CREATE INDEX idx_import_column_mappings_user ON import_column_mappings(user_id);

CREATE TRIGGER update_import_column_mappings_updated_at BEFORE UPDATE ON import_column_mappings FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- Import Match Candidates (OFX/QIF/CSV import matching - t-235)
-- Staging store for proposed matches between an incoming bank row and existing UNRECONCILED transaction(s).
-- Survives dismissal of the post-import review dialog. The bank row is NOT inserted until resolved.
CREATE TABLE IF NOT EXISTS import_match_candidate (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    account_id UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
    import_batch_id UUID NOT NULL,
    bank_amount NUMERIC(20, 4) NOT NULL,
    bank_date DATE NOT NULL,
    fitid VARCHAR(64),
    bank_name VARCHAR(255),
    bank_memo TEXT,
    bank_reference VARCHAR(100),
    candidate_transaction_ids JSONB NOT NULL DEFAULT '[]'::jsonb,
    state VARCHAR(20) NOT NULL DEFAULT 'pending',
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT import_match_candidate_state_check
      CHECK (state IN ('pending', 'merged', 'kept', 'dismissed'))
);
CREATE INDEX IF NOT EXISTS idx_import_match_candidate_batch
    ON import_match_candidate (import_batch_id);
CREATE INDEX IF NOT EXISTS idx_import_match_candidate_user_state
    ON import_match_candidate (user_id, state);
-- Sequential dedupe fast-path (Task 5): look up pending candidates by acct+amount+date.
CREATE INDEX IF NOT EXISTS idx_import_match_candidate_dedupe
    ON import_match_candidate (account_id, state, bank_amount, bank_date);
-- Race guard (R2-3): at most one PENDING candidate per account+fitid. A second
-- concurrent import staging the same OFX fitid loses the insert (23505); its
-- per-row savepoint rolls back — money-safe (no double stage), tiny UX cost.
CREATE UNIQUE INDEX IF NOT EXISTS uq_import_match_candidate_pending_fitid
    ON import_match_candidate (account_id, fitid)
    WHERE state = 'pending' AND fitid IS NOT NULL;

-- Trigger for tags updated_at
CREATE TRIGGER update_tags_updated_at BEFORE UPDATE ON tags FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- Action History (undo/redo support)
CREATE TABLE action_history (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    entity_type VARCHAR(50) NOT NULL,
    entity_id UUID,
    action VARCHAR(20) NOT NULL,
    before_data JSONB,
    after_data JSONB,
    related_entities JSONB,
    is_undone BOOLEAN NOT NULL DEFAULT false,
    description VARCHAR(500) NOT NULL,
    description_key VARCHAR(100),
    description_params JSONB,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_action_history_user_created ON action_history(user_id, created_at DESC);
CREATE INDEX idx_action_history_user_undone ON action_history(user_id, is_undone, created_at DESC);


-- OAuth 2.1 Authorization Server payloads (node-oidc-provider adapter)
CREATE TABLE oauth_payloads (
    id VARCHAR(255) NOT NULL,
    model VARCHAR(50) NOT NULL,
    payload JSONB NOT NULL,
    grant_id VARCHAR(255),
    user_code VARCHAR(255),
    uid VARCHAR(255),
    expires_at TIMESTAMP,
    consumed_at TIMESTAMP,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (id, model)
);

CREATE INDEX idx_oauth_payloads_grant ON oauth_payloads(grant_id) WHERE grant_id IS NOT NULL;
CREATE INDEX idx_oauth_payloads_uid ON oauth_payloads(uid) WHERE uid IS NOT NULL;
CREATE INDEX idx_oauth_payloads_user_code ON oauth_payloads(user_code) WHERE user_code IS NOT NULL;
CREATE INDEX idx_oauth_payloads_expires ON oauth_payloads(expires_at) WHERE expires_at IS NOT NULL;


-- Monte Carlo retirement-projection scenarios (saved simulation inputs)
CREATE TABLE monte_carlo_scenarios (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    name VARCHAR(255) NOT NULL,
    description TEXT,
    account_ids UUID[] NOT NULL DEFAULT '{}',
    starting_value NUMERIC(20, 4) NOT NULL DEFAULT 0,
    use_current_balance BOOLEAN NOT NULL DEFAULT TRUE,

    years_to_retirement INTEGER NOT NULL,
    annual_contribution NUMERIC(20, 4) NOT NULL DEFAULT 0,
    contribution_growth_rate NUMERIC(8, 6) NOT NULL DEFAULT 0,

    years_in_retirement INTEGER NOT NULL DEFAULT 0,
    annual_withdrawal NUMERIC(20, 4) NOT NULL DEFAULT 0,

    expected_return NUMERIC(8, 6) NOT NULL,
    volatility NUMERIC(8, 6) NOT NULL,

    inflation_rate NUMERIC(8, 6) NOT NULL DEFAULT 0.025,
    show_real_values BOOLEAN NOT NULL DEFAULT FALSE,
    use_historical_returns BOOLEAN NOT NULL DEFAULT FALSE,

    simulation_count INTEGER NOT NULL DEFAULT 5000,
    target_value NUMERIC(20, 4),
    random_seed BIGINT,

    is_favourite BOOLEAN NOT NULL DEFAULT FALSE,
    sort_order INTEGER NOT NULL DEFAULT 0,
    last_run_at TIMESTAMP,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT monte_carlo_scenarios_years_to_retirement_check
      CHECK (years_to_retirement BETWEEN 0 AND 100),
    CONSTRAINT monte_carlo_scenarios_years_in_retirement_check
      CHECK (years_in_retirement BETWEEN 0 AND 100),
    CONSTRAINT monte_carlo_scenarios_simulation_count_check
      CHECK (simulation_count BETWEEN 100 AND 50000),
    CONSTRAINT monte_carlo_scenarios_volatility_check
      CHECK (volatility >= 0)
);

CREATE INDEX idx_monte_carlo_scenarios_user ON monte_carlo_scenarios(user_id);
CREATE INDEX idx_monte_carlo_scenarios_user_sort ON monte_carlo_scenarios(user_id, sort_order);

CREATE TRIGGER update_monte_carlo_scenarios_updated_at
  BEFORE UPDATE ON monte_carlo_scenarios
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- Per-scenario cash-flow events (one-time or recurring) layered on top of
-- the base contribution/withdrawal phases.
CREATE TABLE monte_carlo_cash_flows (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    scenario_id UUID NOT NULL REFERENCES monte_carlo_scenarios(id) ON DELETE CASCADE,
    name VARCHAR(255) NOT NULL,
    amount NUMERIC(20, 4) NOT NULL,
    flow_type VARCHAR(20) NOT NULL,
    start_year INTEGER NOT NULL,
    end_year INTEGER,
    inflation_adjust BOOLEAN NOT NULL DEFAULT TRUE,
    sort_order INTEGER NOT NULL DEFAULT 0,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT mc_cash_flows_type_check
      CHECK (flow_type IN ('ONE_TIME', 'RECURRING')),
    CONSTRAINT mc_cash_flows_start_year_check
      CHECK (start_year BETWEEN 1 AND 100),
    CONSTRAINT mc_cash_flows_end_year_check
      CHECK (end_year IS NULL OR end_year BETWEEN start_year AND 100)
);

CREATE INDEX idx_monte_carlo_cash_flows_scenario ON monte_carlo_cash_flows(scenario_id);

-- ============================================================
-- LOAN SCENARIOS (saved overpayment simulations)
-- ============================================================

CREATE TABLE loan_scenarios (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    account_id UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
    name VARCHAR(100) NOT NULL,
    recurring_extra_amount DECIMAL(20,4),
    recurring_extra_mode VARCHAR(64),
    recurring_extra_frequency VARCHAR(16),
    recurring_extra_start_date DATE,
    recurring_extra_end_date DATE,
    target_monthly_payment DECIMAL(20,4),
    target_monthly_payment_mode VARCHAR(64),
    target_monthly_payment_start_date DATE,
    target_monthly_payment_end_date DATE,
    lump_sums JSONB NOT NULL DEFAULT '[]',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_loan_scenarios_user ON loan_scenarios(user_id);
CREATE INDEX idx_loan_scenarios_account ON loan_scenarios(account_id);
CREATE UNIQUE INDEX idx_loan_scenarios_account_name
    ON loan_scenarios(user_id, account_id, LOWER(name));

-- ============================================================
-- LOAN RATE CHANGES (interest-rate history for loans/mortgages)
-- ============================================================

-- 'initial' rows snapshot the origination rate the first time a change is
-- recorded; 'inferred' rows are produced by detection from payment history.
CREATE TABLE loan_rate_changes (
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

CREATE INDEX idx_loan_rate_changes_user ON loan_rate_changes(user_id);
CREATE INDEX idx_loan_rate_changes_account_date
    ON loan_rate_changes(account_id, effective_date);


-- ===========================================================================
-- Row-Level Security policies
--
-- Mirrored from database/migrations/112_rls_policies_direct.sql,
-- 113_rls_policies_indirect.sql and 114_rls_policies_special.sql so a
-- fresh db-init produces the same catalog as a migrated database.
--
-- These policies are INERT until ALTER TABLE ... ENABLE ROW LEVEL SECURITY
-- ships separately (task M3 / flip B of the rollout). Nothing below changes a
-- query result on its own.
--
-- Adding a table? It must land in exactly one of four buckets -- direct,
-- indirect, bespoke owner column, or the documented exemption list at the
-- bottom of this section. The catalog-driven integration spec fails on any
-- table that is in none of them.
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- Direct ownership (user_id column)
-- ---------------------------------------------------------------------------

DO $$
DECLARE
    t text;
    direct_tables text[] := ARRAY[
        'accounts',
        'action_history',
        'ai_insights',
        'ai_provider_configs',
        'ai_usage_logs',
        'auto_backup_settings',
        'budget_alerts',
        'budgets',
        'categories',
        'custom_reports',
        'import_column_mappings',
        'institutions',
        'investment_reports',
        'investment_transactions',
        'loan_rate_changes',
        'loan_scenarios',
        'monte_carlo_scenarios',
        'monthly_account_balances',
        'payee_aliases',
        'payees',
        'scheduled_transactions',
        'securities',
        'tags',
        'transaction_attachments',
        'transactions',
        'user_currency_preferences'
    ];
BEGIN
    FOREACH t IN ARRAY direct_tables LOOP
        EXECUTE format('DROP POLICY IF EXISTS %I ON %I', t || '_isolation', t);
        EXECUTE format(
            'CREATE POLICY %I ON %I
               USING (user_id = (SELECT app_current_user_id()) OR (SELECT app_bypass_rls()))
               WITH CHECK (user_id = (SELECT app_current_user_id()) OR (SELECT app_bypass_rls()))',
            t || '_isolation', t
        );
    END LOOP;
END $$;

-- ---------------------------------------------------------------------------
-- Group B: keyed by the AUTHENTICATED user (4 tables)
--
-- These four also have a user_id column, but the id stored in it is the
-- *authenticated* identity, not the effective one. Under delegation those
-- differ, so the uniform Group A predicate would silently return zero rows for
-- the acting delegate -- inside normal request scope, where nothing throws and
-- nothing logs. Verified against the call sites rather than assumed; see the
-- per-table notes below.
--
-- Adding the app_real_user_id() arm cannot widen isolation: app.real_user_id
-- only ever holds the id the JWT layer authenticated, so the arm exposes the
-- caller's own rows and never a third party's. Outside delegation the two GUCs
-- are equal and the arm is redundant.
-- ---------------------------------------------------------------------------

-- refresh_tokens: user_id is ALWAYS the real authenticated user; when a
-- delegate acts, the owner is carried separately in acting_as_user_id
-- (see backend/src/auth/token.service.ts -- "sub is ALWAYS the real
-- authenticated user"). POST /auth/switch-context is @AllowDelegate and both
-- revokes and inserts delegate-keyed rows while the request context names the
-- owner, so the real arm is load-bearing.
--
-- The acting_as_user_id arm covers the inverse direction: an owner deleting
-- their account purges the delegate sessions opened against their data
-- (users.service.ts: delete({ actingAsUserId })). Those rows have another
-- user's user_id, so without this arm the purge would silently no-op and leave
-- live delegate sessions pointing at deleted data.
DROP POLICY IF EXISTS refresh_tokens_isolation ON refresh_tokens;
CREATE POLICY refresh_tokens_isolation ON refresh_tokens
  USING (user_id = (SELECT app_current_user_id())
      OR user_id = (SELECT app_real_user_id())
      OR acting_as_user_id = (SELECT app_current_user_id())
      OR (SELECT app_bypass_rls()))
  WITH CHECK (user_id = (SELECT app_current_user_id())
      OR user_id = (SELECT app_real_user_id())
      OR acting_as_user_id = (SELECT app_current_user_id())
      OR (SELECT app_bypass_rls()));

-- trusted_devices: uniformly real-user keyed. Every authenticated route that
-- reads or writes it (list / revoke / revoke-all trusted devices, disable 2FA,
-- change password) passes req.user.realUserId, and those routes ARE
-- @AllowDelegate -- so a delegate reaches their own devices while acting.
DROP POLICY IF EXISTS trusted_devices_isolation ON trusted_devices;
CREATE POLICY trusted_devices_isolation ON trusted_devices
  USING (user_id = (SELECT app_current_user_id())
      OR user_id = (SELECT app_real_user_id())
      OR (SELECT app_bypass_rls()))
  WITH CHECK (user_id = (SELECT app_current_user_id())
      OR user_id = (SELECT app_real_user_id())
      OR (SELECT app_bypass_rls()));

-- personal_access_tokens: the CRUD routes pass req.user.id but PatController
-- carries no @AllowDelegate, so the delegate guard rejects acting tokens and
-- the two ids coincide today. changePassword already revokes by realUserId.
-- The real arm makes the policy correct under either keying, so adding
-- @AllowDelegate later cannot turn into a silent zero-rows bug.
DROP POLICY IF EXISTS personal_access_tokens_isolation ON personal_access_tokens;
CREATE POLICY personal_access_tokens_isolation ON personal_access_tokens
  USING (user_id = (SELECT app_current_user_id())
      OR user_id = (SELECT app_real_user_id())
      OR (SELECT app_bypass_rls()))
  WITH CHECK (user_id = (SELECT app_current_user_id())
      OR user_id = (SELECT app_real_user_id())
      OR (SELECT app_bypass_rls()));

-- user_preferences: mostly effective-user keyed (locale, timezone, currency
-- display -- a delegate sees the owner's), but the 2FA endpoints
-- (confirm-setup, disable, is-enabled) are @AllowDelegate and read/write the
-- DELEGATE's own preferences row via req.user.realUserId. Both arms required.
DROP POLICY IF EXISTS user_preferences_isolation ON user_preferences;
CREATE POLICY user_preferences_isolation ON user_preferences
  USING (user_id = (SELECT app_current_user_id())
      OR user_id = (SELECT app_real_user_id())
      OR (SELECT app_bypass_rls()))
  WITH CHECK (user_id = (SELECT app_current_user_id())
      OR user_id = (SELECT app_real_user_id())
      OR (SELECT app_bypass_rls()));

-- ---------------------------------------------------------------------------
-- Indirect ownership (resolved through a parent row)
-- ---------------------------------------------------------------------------

DROP POLICY IF EXISTS transaction_splits_isolation ON transaction_splits;
CREATE POLICY transaction_splits_isolation ON transaction_splits
  USING ((SELECT app_bypass_rls()) OR EXISTS (
    SELECT 1 FROM transactions t
    WHERE t.id = transaction_splits.transaction_id
      AND t.user_id = (SELECT app_current_user_id())))
  WITH CHECK ((SELECT app_bypass_rls()) OR EXISTS (
    SELECT 1 FROM transactions t
    WHERE t.id = transaction_splits.transaction_id
      AND t.user_id = (SELECT app_current_user_id())));

-- transaction_tags -> transactions.user_id
DROP POLICY IF EXISTS transaction_tags_isolation ON transaction_tags;
CREATE POLICY transaction_tags_isolation ON transaction_tags
  USING ((SELECT app_bypass_rls()) OR EXISTS (
    SELECT 1 FROM transactions t
    WHERE t.id = transaction_tags.transaction_id
      AND t.user_id = (SELECT app_current_user_id())))
  WITH CHECK ((SELECT app_bypass_rls()) OR EXISTS (
    SELECT 1 FROM transactions t
    WHERE t.id = transaction_tags.transaction_id
      AND t.user_id = (SELECT app_current_user_id())));

-- transaction_split_tags -> transaction_splits -> transactions.user_id (two-hop)
DROP POLICY IF EXISTS transaction_split_tags_isolation ON transaction_split_tags;
CREATE POLICY transaction_split_tags_isolation ON transaction_split_tags
  USING ((SELECT app_bypass_rls()) OR EXISTS (
    SELECT 1 FROM transaction_splits ts
    JOIN transactions t ON t.id = ts.transaction_id
    WHERE ts.id = transaction_split_tags.transaction_split_id
      AND t.user_id = (SELECT app_current_user_id())))
  WITH CHECK ((SELECT app_bypass_rls()) OR EXISTS (
    SELECT 1 FROM transaction_splits ts
    JOIN transactions t ON t.id = ts.transaction_id
    WHERE ts.id = transaction_split_tags.transaction_split_id
      AND t.user_id = (SELECT app_current_user_id())));

-- attachment_blobs -> transaction_attachments.user_id
-- (transaction_attachments is itself a direct table -- see 112.)
DROP POLICY IF EXISTS attachment_blobs_isolation ON attachment_blobs;
CREATE POLICY attachment_blobs_isolation ON attachment_blobs
  USING ((SELECT app_bypass_rls()) OR EXISTS (
    SELECT 1 FROM transaction_attachments ta
    WHERE ta.id = attachment_blobs.attachment_id
      AND ta.user_id = (SELECT app_current_user_id())))
  WITH CHECK ((SELECT app_bypass_rls()) OR EXISTS (
    SELECT 1 FROM transaction_attachments ta
    WHERE ta.id = attachment_blobs.attachment_id
      AND ta.user_id = (SELECT app_current_user_id())));

-- ---------------------------------------------------------------------------
-- Scheduled transactions family
-- ---------------------------------------------------------------------------

-- scheduled_transaction_splits -> scheduled_transactions.user_id
DROP POLICY IF EXISTS scheduled_transaction_splits_isolation ON scheduled_transaction_splits;
CREATE POLICY scheduled_transaction_splits_isolation ON scheduled_transaction_splits
  USING ((SELECT app_bypass_rls()) OR EXISTS (
    SELECT 1 FROM scheduled_transactions st
    WHERE st.id = scheduled_transaction_splits.scheduled_transaction_id
      AND st.user_id = (SELECT app_current_user_id())))
  WITH CHECK ((SELECT app_bypass_rls()) OR EXISTS (
    SELECT 1 FROM scheduled_transactions st
    WHERE st.id = scheduled_transaction_splits.scheduled_transaction_id
      AND st.user_id = (SELECT app_current_user_id())));

-- scheduled_transaction_split_tags -> scheduled_transaction_splits
--   -> scheduled_transactions.user_id (two-hop)
DROP POLICY IF EXISTS scheduled_transaction_split_tags_isolation ON scheduled_transaction_split_tags;
CREATE POLICY scheduled_transaction_split_tags_isolation ON scheduled_transaction_split_tags
  USING ((SELECT app_bypass_rls()) OR EXISTS (
    SELECT 1 FROM scheduled_transaction_splits sts
    JOIN scheduled_transactions st ON st.id = sts.scheduled_transaction_id
    WHERE sts.id = scheduled_transaction_split_tags.scheduled_transaction_split_id
      AND st.user_id = (SELECT app_current_user_id())))
  WITH CHECK ((SELECT app_bypass_rls()) OR EXISTS (
    SELECT 1 FROM scheduled_transaction_splits sts
    JOIN scheduled_transactions st ON st.id = sts.scheduled_transaction_id
    WHERE sts.id = scheduled_transaction_split_tags.scheduled_transaction_split_id
      AND st.user_id = (SELECT app_current_user_id())));

-- scheduled_transaction_overrides -> scheduled_transactions.user_id
DROP POLICY IF EXISTS scheduled_transaction_overrides_isolation ON scheduled_transaction_overrides;
CREATE POLICY scheduled_transaction_overrides_isolation ON scheduled_transaction_overrides
  USING ((SELECT app_bypass_rls()) OR EXISTS (
    SELECT 1 FROM scheduled_transactions st
    WHERE st.id = scheduled_transaction_overrides.scheduled_transaction_id
      AND st.user_id = (SELECT app_current_user_id())))
  WITH CHECK ((SELECT app_bypass_rls()) OR EXISTS (
    SELECT 1 FROM scheduled_transactions st
    WHERE st.id = scheduled_transaction_overrides.scheduled_transaction_id
      AND st.user_id = (SELECT app_current_user_id())));

-- ---------------------------------------------------------------------------
-- Securities family
--
-- securities is per-user (symbol is unique per user), so a security's price
-- history and tags belong to exactly one user despite looking like reference
-- data. holdings hang off the account, not the security.
-- ---------------------------------------------------------------------------

-- security_prices -> securities.user_id
DROP POLICY IF EXISTS security_prices_isolation ON security_prices;
CREATE POLICY security_prices_isolation ON security_prices
  USING ((SELECT app_bypass_rls()) OR EXISTS (
    SELECT 1 FROM securities s
    WHERE s.id = security_prices.security_id
      AND s.user_id = (SELECT app_current_user_id())))
  WITH CHECK ((SELECT app_bypass_rls()) OR EXISTS (
    SELECT 1 FROM securities s
    WHERE s.id = security_prices.security_id
      AND s.user_id = (SELECT app_current_user_id())));

-- security_tags -> securities.user_id
DROP POLICY IF EXISTS security_tags_isolation ON security_tags;
CREATE POLICY security_tags_isolation ON security_tags
  USING ((SELECT app_bypass_rls()) OR EXISTS (
    SELECT 1 FROM securities s
    WHERE s.id = security_tags.security_id
      AND s.user_id = (SELECT app_current_user_id())))
  WITH CHECK ((SELECT app_bypass_rls()) OR EXISTS (
    SELECT 1 FROM securities s
    WHERE s.id = security_tags.security_id
      AND s.user_id = (SELECT app_current_user_id())));

-- holdings -> accounts.user_id
DROP POLICY IF EXISTS holdings_isolation ON holdings;
CREATE POLICY holdings_isolation ON holdings
  USING ((SELECT app_bypass_rls()) OR EXISTS (
    SELECT 1 FROM accounts a
    WHERE a.id = holdings.account_id
      AND a.user_id = (SELECT app_current_user_id())))
  WITH CHECK ((SELECT app_bypass_rls()) OR EXISTS (
    SELECT 1 FROM accounts a
    WHERE a.id = holdings.account_id
      AND a.user_id = (SELECT app_current_user_id())));

-- ---------------------------------------------------------------------------
-- Budgets family
-- ---------------------------------------------------------------------------

-- budget_categories -> budgets.user_id
DROP POLICY IF EXISTS budget_categories_isolation ON budget_categories;
CREATE POLICY budget_categories_isolation ON budget_categories
  USING ((SELECT app_bypass_rls()) OR EXISTS (
    SELECT 1 FROM budgets b
    WHERE b.id = budget_categories.budget_id
      AND b.user_id = (SELECT app_current_user_id())))
  WITH CHECK ((SELECT app_bypass_rls()) OR EXISTS (
    SELECT 1 FROM budgets b
    WHERE b.id = budget_categories.budget_id
      AND b.user_id = (SELECT app_current_user_id())));

-- budget_periods -> budgets.user_id
DROP POLICY IF EXISTS budget_periods_isolation ON budget_periods;
CREATE POLICY budget_periods_isolation ON budget_periods
  USING ((SELECT app_bypass_rls()) OR EXISTS (
    SELECT 1 FROM budgets b
    WHERE b.id = budget_periods.budget_id
      AND b.user_id = (SELECT app_current_user_id())))
  WITH CHECK ((SELECT app_bypass_rls()) OR EXISTS (
    SELECT 1 FROM budgets b
    WHERE b.id = budget_periods.budget_id
      AND b.user_id = (SELECT app_current_user_id())));

-- budget_period_categories -> budget_periods -> budgets.user_id (two-hop)
DROP POLICY IF EXISTS budget_period_categories_isolation ON budget_period_categories;
CREATE POLICY budget_period_categories_isolation ON budget_period_categories
  USING ((SELECT app_bypass_rls()) OR EXISTS (
    SELECT 1 FROM budget_periods bp
    JOIN budgets b ON b.id = bp.budget_id
    WHERE bp.id = budget_period_categories.budget_period_id
      AND b.user_id = (SELECT app_current_user_id())))
  WITH CHECK ((SELECT app_bypass_rls()) OR EXISTS (
    SELECT 1 FROM budget_periods bp
    JOIN budgets b ON b.id = bp.budget_id
    WHERE bp.id = budget_period_categories.budget_period_id
      AND b.user_id = (SELECT app_current_user_id())));

-- ---------------------------------------------------------------------------
-- Monte Carlo
-- ---------------------------------------------------------------------------

-- monte_carlo_cash_flows -> monte_carlo_scenarios.user_id
DROP POLICY IF EXISTS monte_carlo_cash_flows_isolation ON monte_carlo_cash_flows;
CREATE POLICY monte_carlo_cash_flows_isolation ON monte_carlo_cash_flows
  USING ((SELECT app_bypass_rls()) OR EXISTS (
    SELECT 1 FROM monte_carlo_scenarios s
    WHERE s.id = monte_carlo_cash_flows.scenario_id
      AND s.user_id = (SELECT app_current_user_id())))
  WITH CHECK ((SELECT app_bypass_rls()) OR EXISTS (
    SELECT 1 FROM monte_carlo_scenarios s
    WHERE s.id = monte_carlo_cash_flows.scenario_id
      AND s.user_id = (SELECT app_current_user_id())));

-- ---------------------------------------------------------------------------
-- Delegation grants
--
-- account_delegate_grants -> account_delegates, which has no user_id either:
-- it is owner_user_id / delegate_user_id keyed. The parent predicate therefore
-- mirrors the account_delegates policy in 114 -- visible to the owner through
-- app.current_user_id and to the delegate through app.real_user_id, so a
-- delegate can still read which of the owner's accounts they were granted
-- while acting (current = owner, real = delegate).
-- ---------------------------------------------------------------------------

DROP POLICY IF EXISTS account_delegate_grants_isolation ON account_delegate_grants;
CREATE POLICY account_delegate_grants_isolation ON account_delegate_grants
  USING ((SELECT app_bypass_rls()) OR EXISTS (
    SELECT 1 FROM account_delegates ad
    WHERE ad.id = account_delegate_grants.delegation_id
      AND (ad.owner_user_id = (SELECT app_current_user_id())
        OR ad.delegate_user_id = (SELECT app_real_user_id()))))
  WITH CHECK ((SELECT app_bypass_rls()) OR EXISTS (
    SELECT 1 FROM account_delegates ad
    WHERE ad.id = account_delegate_grants.delegation_id
      AND (ad.owner_user_id = (SELECT app_current_user_id())
        OR ad.delegate_user_id = (SELECT app_real_user_id()))));

-- ---------------------------------------------------------------------------
-- Bespoke owner columns, and the documented exemptions
-- ---------------------------------------------------------------------------

DROP POLICY IF EXISTS users_self ON users;
CREATE POLICY users_self ON users
  USING (id = (SELECT app_current_user_id())
      OR id = (SELECT app_real_user_id())
      OR (SELECT app_bypass_rls()))
  WITH CHECK (id = (SELECT app_current_user_id())
      OR id = (SELECT app_real_user_id())
      OR (SELECT app_bypass_rls()));

-- ---------------------------------------------------------------------------
-- account_delegates -- visible from both sides of the delegation.
--
-- The owner reaches it through app.current_user_id (managing who they share
-- with). The delegate reaches it through app.real_user_id, which works both in
-- their own session (current = real = delegate) and while acting for the owner
-- (current = owner, real = delegate) -- the latter is what lets the delegate
-- guard resolve its own grant row on every acting request.
-- ---------------------------------------------------------------------------
DROP POLICY IF EXISTS account_delegates_isolation ON account_delegates;
CREATE POLICY account_delegates_isolation ON account_delegates
  USING (owner_user_id = (SELECT app_current_user_id())
      OR delegate_user_id = (SELECT app_real_user_id())
      OR (SELECT app_bypass_rls()))
  WITH CHECK (owner_user_id = (SELECT app_current_user_id())
      OR delegate_user_id = (SELECT app_real_user_id())
      OR (SELECT app_bypass_rls()));

-- ---------------------------------------------------------------------------
-- delegate_account_favourites -- belongs to the delegate personally.
--
-- Keyed by the delegate's own identity even while they act as the owner
-- (current = owner, real = delegate), so this is the one table scoped by
-- app.real_user_id alone. Matching app.current_user_id as well would let an
-- owner read the private favourites of the delegates they share with.
-- ---------------------------------------------------------------------------
DROP POLICY IF EXISTS delegate_account_favourites_isolation ON delegate_account_favourites;
CREATE POLICY delegate_account_favourites_isolation ON delegate_account_favourites
  USING (delegate_user_id = (SELECT app_real_user_id())
      OR (SELECT app_bypass_rls()))
  WITH CHECK (delegate_user_id = (SELECT app_real_user_id())
      OR (SELECT app_bypass_rls()));

-- ---------------------------------------------------------------------------
-- emergency_access_settings / emergency_access_contacts -- owner-keyed only.
--
-- The authenticated surface (emergency-access.controller.ts, class-guarded by
-- AuthGuard('jwt') + StepUpGuard, no @AllowDelegate) is entirely owner-keyed:
-- every service call passes req.user.id as the owner and every query filters
-- owner_user_id. There is no "who named me as an emergency contact" lookup, so
-- no grantee-side arm is needed (audited in task C4).
--
-- The grantee-facing side is the public claim flow, which identifies the
-- grantee by emailed claim token rather than by user id and runs entirely under
-- withSystemContext -- the bypass arm.
-- ---------------------------------------------------------------------------
DROP POLICY IF EXISTS emergency_access_settings_isolation ON emergency_access_settings;
CREATE POLICY emergency_access_settings_isolation ON emergency_access_settings
  USING (owner_user_id = (SELECT app_current_user_id()) OR (SELECT app_bypass_rls()))
  WITH CHECK (owner_user_id = (SELECT app_current_user_id()) OR (SELECT app_bypass_rls()));

DROP POLICY IF EXISTS emergency_access_contacts_isolation ON emergency_access_contacts;
CREATE POLICY emergency_access_contacts_isolation ON emergency_access_contacts
  USING (owner_user_id = (SELECT app_current_user_id()) OR (SELECT app_bypass_rls()))
  WITH CHECK (owner_user_id = (SELECT app_current_user_id()) OR (SELECT app_bypass_rls()));

-- ---------------------------------------------------------------------------
-- Deliberately NOT policied (and therefore never enabled in M3).
--
-- The catalog-driven test in T2 asserts this exact list: a new table that lands
-- in neither a policy migration nor this exemption list fails the suite, so
-- forgetting one is a test failure rather than a review miss.
--
--   currencies       Global reference data keyed by ISO 4217 code, shared
--                    across all users. It does carry created_by_user_id, but
--                    that column is attribution (NULL = system currency), not
--                    ownership: any user may reference a custom code through
--                    accounts.currency_code, and a created_by_user_id policy
--                    would hide every system currency (the column is NULL
--                    there) and break those foreign keys. Per-user visibility
--                    is already expressed by user_currency_preferences, which
--                    IS policied.
--
--   exchange_rates   Global reference data with no owner column at all;
--                    written by the scheduled refresh under system context.
--
--   oauth_payloads   No owner column exists -- rows are keyed by opaque
--                    id/model/grant_id/uid. Every access happens in the
--                    pre-session OAuth flow, which runs under withSystemContext
--                    regardless, so a policy would consist of nothing but its
--                    bypass arm. Reviewed and confirmed in task C1: keep the
--                    runtime role's DML grants, leave the table exempt. The
--                    stronger option (revoke the grants and give the OAuth
--                    module an owner DataSource) was considered and declined --
--                    the table is a short-lived token store keyed by random id
--                    and is never queried per end-user.
--
--   schema_migrations  Migration infrastructure, written only by db-migrate
--                    running as the owner.
-- ---------------------------------------------------------------------------

-- Verification helper (run manually; not part of the migration's effect):
--   SELECT tablename, policyname FROM pg_policies
--    WHERE schemaname = 'public' ORDER BY tablename;
-- Expected: 50 policies -- 26 direct + 4 real-user-keyed (112),
--           15 indirect (113), 5 special (114).
