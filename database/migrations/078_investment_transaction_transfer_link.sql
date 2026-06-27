-- Link the two legs of a security transfer (TRANSFER_OUT <-> TRANSFER_IN) so
-- editing or deleting one leg cascades to its pair. Self-referencing FK; on
-- delete the surviving leg's pointer is nulled (the service deletes both legs
-- together in a single transaction).
ALTER TABLE investment_transactions
    ADD COLUMN IF NOT EXISTS linked_transaction_id UUID
        REFERENCES investment_transactions(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_investment_transactions_linked
    ON investment_transactions(linked_transaction_id);
