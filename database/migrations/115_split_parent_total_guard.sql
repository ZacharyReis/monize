-- 115: enforce the split-parent invariant  transactions.amount = SUM(transaction_splits.amount)
--
-- Why this exists
-- ---------------
-- A transfer created from a split line records its linkage on the split row,
-- while the counterpart transaction's linked_transaction_id points at the split
-- PARENT. updateTransfer() used to treat that parent as the plain "from" leg of
-- a two-row transfer and write the leg's own amount/date/payee/category onto it,
-- silently destroying the parent's split-derived total.
--
-- Observed live on 2026-07-18: a $547.28 paycheck split (gross 1847.28 with a
-- -1300.00 transfer leg out to SoFi Checking) was rewritten to -1300.00 when the
-- SoFi counterpart was edited, drifting the account balance by 1847.28 and
-- leaving the ledger $1,300.00 below the bank's statement balance.
--
-- The service-layer fix is transaction-transfer.service.ts
-- (updateSplitTransferLeg, which re-derives the parent from its splits and
-- never writes leg fields onto it). Upstream shipped that fix independently in
-- v1.13.0; this fork's earlier equivalent was dropped in favour of it during the
-- v1.13.0 merge. This migration is the backstop -- upstream has no such
-- constraint -- so any *future* code path that breaks the invariant fails loudly
-- instead of quietly corrupting a balance.
--
-- The trigger is DEFERRABLE INITIALLY DEFERRED: split rewrites legitimately pass
-- through inconsistent intermediate states inside a single transaction (delete
-- all splits, re-insert, then update the parent), so the invariant is only
-- judged once at COMMIT.

CREATE OR REPLACE FUNCTION assert_split_parent_total() RETURNS TRIGGER AS $$
DECLARE
  target_id       uuid;
  parent_amt      numeric(20, 4);
  parent_is_split boolean;
  split_sum       numeric(20, 4);
BEGIN
  IF TG_TABLE_NAME = 'transaction_splits' THEN
    IF TG_OP = 'DELETE' THEN
      target_id := OLD.transaction_id;
    ELSE
      target_id := NEW.transaction_id;
    END IF;
  ELSE
    -- A deleted parent has no invariant left to satisfy.
    IF TG_OP = 'DELETE' THEN
      RETURN NULL;
    END IF;
    target_id := NEW.id;
  END IF;

  IF target_id IS NULL THEN
    RETURN NULL;
  END IF;

  SELECT t.amount, t.is_split
    INTO parent_amt, parent_is_split
    FROM transactions t
   WHERE t.id = target_id;

  -- Parent removed later in this same transaction, or no longer a split parent
  -- (un-split): nothing to enforce.
  IF NOT FOUND OR parent_is_split IS NOT TRUE THEN
    RETURN NULL;
  END IF;

  SELECT COALESCE(SUM(s.amount), 0)
    INTO split_sum
    FROM transaction_splits s
   WHERE s.transaction_id = target_id;

  -- Tolerance absorbs sub-cent representation dust; the defect class this
  -- guards against is off by whole currency units.
  IF ABS(parent_amt - split_sum) > 0.01 THEN
    RAISE EXCEPTION
      'split parent % has amount % but SUM(splits) is % (drift %)',
      target_id, parent_amt, split_sum, parent_amt - split_sum
      USING ERRCODE = 'check_violation',
            HINT = 'A split parent''s amount must be re-derived from its splits, never assigned from a single leg.';
  END IF;

  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

-- Only split parents are checked, so ordinary inserts/updates skip the trigger
-- body entirely (imports touch thousands of non-split rows).
DROP TRIGGER IF EXISTS trg_split_parent_total_tx ON transactions;
CREATE CONSTRAINT TRIGGER trg_split_parent_total_tx
  AFTER INSERT OR UPDATE ON transactions
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW
  WHEN (NEW.is_split IS TRUE)
  EXECUTE FUNCTION assert_split_parent_total();

DROP TRIGGER IF EXISTS trg_split_parent_total_splits ON transaction_splits;
CREATE CONSTRAINT TRIGGER trg_split_parent_total_splits
  AFTER INSERT OR UPDATE OR DELETE ON transaction_splits
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW
  EXECUTE FUNCTION assert_split_parent_total();
