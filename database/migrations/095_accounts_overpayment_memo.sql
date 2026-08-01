-- Per-loan overpayment memo match. Alongside (or instead of) the overpayment
-- category, the user can specify memo text that marks a payment as a standalone
-- overpayment. A case-insensitive substring match against a transaction's memo
-- (its description, the linked source transaction's memo, or a split memo) flags
-- the payment as 100% principal. Nullable free text; no constraint.
ALTER TABLE accounts
  ADD COLUMN IF NOT EXISTS overpayment_memo VARCHAR(255);
