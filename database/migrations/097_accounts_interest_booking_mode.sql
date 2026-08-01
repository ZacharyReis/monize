-- Per-loan interest booking mode, so rate detection reads interest correctly
-- regardless of how the ledger records it:
--   'AUTO'     -- a categorized split leg of the payment when present, else a
--                 separate expense in the interest category (principal transfers
--                 are never counted as interest);
--   'SPLIT'    -- interest is only ever a categorized split leg of the payment;
--   'SEPARATE' -- interest is a standalone expense in the interest category,
--                 with principal booked as a transfer to the loan.
-- Defaults to AUTO (universal); existing rows keep the previous auto behaviour.
ALTER TABLE accounts
  ADD COLUMN IF NOT EXISTS interest_booking_mode VARCHAR(16) NOT NULL DEFAULT 'AUTO';
