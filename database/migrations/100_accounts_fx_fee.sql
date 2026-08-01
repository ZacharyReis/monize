-- Per-account foreign-transaction fee. When an account is configured with a
-- foreign-currency conversion fee (a percentage), a foreign-entered transaction
-- on that account folds the bank's FX fee into the converted amount. Nullable;
-- unset means no fee.
ALTER TABLE accounts
  ADD COLUMN IF NOT EXISTS fx_fee_percent NUMERIC(8, 4);
