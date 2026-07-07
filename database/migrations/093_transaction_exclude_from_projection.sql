-- 093_transaction_exclude_from_projection.sql
-- Cash-flow projection recurrence intent (t-550). Tri-state:
--   NULL  = defer to the statistical heuristic (default / today's behavior)
--   TRUE  = user marked one-time; never project forward
--   FALSE = user marked recurring; always project (override an aggressive guess)
ALTER TABLE transactions
    ADD COLUMN IF NOT EXISTS exclude_from_projection BOOLEAN NULL;
