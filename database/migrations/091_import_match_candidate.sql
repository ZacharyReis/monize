-- 091_import_match_candidate.sql
-- OFX/QIF/CSV import matching (t-235): staging store for proposed matches between
-- an incoming bank row and existing UNRECONCILED transaction(s). Survives dismissal
-- of the post-import review dialog. The bank row is NOT inserted until resolved.
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
      CHECK (state IN ('pending', 'merged', 'kept'))
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
