-- Foreign-currency transaction entry. A transaction's amount/currency_code stay
-- in the account's currency (balances and reports are untouched); the amount the
-- user actually paid is stored alongside in original_amount + original_currency_code
-- (both NULL for an ordinary transaction). The per-transaction exchange_rate column
-- (already present) holds account-currency units per 1 unit of original currency.
-- is_fx_fee marks the auto-generated bank-fee split so the form can re-identify it
-- on edit and render it read-only.
ALTER TABLE transactions
  ADD COLUMN IF NOT EXISTS original_amount NUMERIC(20, 4);

ALTER TABLE transactions
  ADD COLUMN IF NOT EXISTS original_currency_code VARCHAR(3);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'fk_transactions_original_currency'
  ) THEN
    ALTER TABLE transactions
      ADD CONSTRAINT fk_transactions_original_currency
      FOREIGN KEY (original_currency_code) REFERENCES currencies(code);
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_transactions_original_currency
  ON transactions(original_currency_code);

ALTER TABLE transaction_splits
  ADD COLUMN IF NOT EXISTS is_fx_fee BOOLEAN NOT NULL DEFAULT false;
