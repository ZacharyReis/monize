-- Drop the legacy transactions.is_cleared / is_reconciled boolean flags.
-- Reconciliation state is carried solely by transactions.status
-- ('UNRECONCILED', 'CLEARED', 'RECONCILED', 'VOID'); the booleans were left
-- behind as unused duplicates and are not mapped by the TypeORM entity.
-- Any row whose status never got set (older seed data wrote only the flags) is
-- backfilled from the flags before they are removed.

DO $$
BEGIN
    IF EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'public'
          AND table_name = 'transactions'
          AND column_name = 'is_reconciled'
    ) THEN
        UPDATE transactions
        SET status = 'RECONCILED'
        WHERE is_reconciled = true
          AND (status IS NULL OR status = 'UNRECONCILED');
    END IF;

    IF EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'public'
          AND table_name = 'transactions'
          AND column_name = 'is_cleared'
    ) THEN
        UPDATE transactions
        SET status = 'CLEARED'
        WHERE is_cleared = true
          AND (status IS NULL OR status = 'UNRECONCILED');
    END IF;
END $$;

DROP INDEX IF EXISTS idx_transactions_cleared;
DROP INDEX IF EXISTS idx_transactions_reconciled;
DROP INDEX IF EXISTS idx_transactions_user_cleared;

ALTER TABLE transactions DROP COLUMN IF EXISTS is_cleared;
ALTER TABLE transactions DROP COLUMN IF EXISTS is_reconciled;
