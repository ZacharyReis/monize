-- Drop the dead is_fx_fee flag from transaction_splits. The bank's
-- foreign-transaction fee is folded into the transaction amount and was never
-- stored as a dedicated split, so this column was always false and all of its
-- handling (validation, read-only split rows) has been removed.
ALTER TABLE transaction_splits
  DROP COLUMN IF EXISTS is_fx_fee;
