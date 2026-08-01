-- Per-loan "Overpayment / Extra Principal" category. When a user tags a
-- standalone overpayment with this category, the loan schedule can tell it
-- apart from a regular installment (an overpayment is 100% principal, no
-- interest). Nullable; ON DELETE SET NULL so removing the category just clears
-- the loan's setting.
ALTER TABLE accounts
  ADD COLUMN IF NOT EXISTS overpayment_category_id UUID;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'fk_accounts_overpayment_category'
  ) THEN
    ALTER TABLE accounts
      ADD CONSTRAINT fk_accounts_overpayment_category
      FOREIGN KEY (overpayment_category_id) REFERENCES categories(id) ON DELETE SET NULL;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_accounts_overpayment_category
  ON accounts(overpayment_category_id);
