-- Accelerate the transaction search (ILIKE '%term%') used by the register and
-- the report search. Without trigram indexes, leading-wildcard ILIKE forces a
-- sequential scan of the transactions table on every search keystroke.
-- pg_trgm GIN indexes support ILIKE directly (no LOWER() needed).
CREATE EXTENSION IF NOT EXISTS pg_trgm;

CREATE INDEX IF NOT EXISTS idx_transactions_payee_name_trgm
    ON transactions USING gin (payee_name gin_trgm_ops);

CREATE INDEX IF NOT EXISTS idx_transactions_description_trgm
    ON transactions USING gin (description gin_trgm_ops);

-- The same search clause filters payee and category names via EXISTS subqueries.
CREATE INDEX IF NOT EXISTS idx_payees_name_trgm
    ON payees USING gin (name gin_trgm_ops);

CREATE INDEX IF NOT EXISTS idx_categories_name_trgm
    ON categories USING gin (name gin_trgm_ops);
