-- Row-Level Security, task M2 (2/3): policies for tables that have no user_id
-- of their own and resolve ownership through a parent row.
--
-- INERT (no ENABLE here -- that is M3 / flip B) and free of role and grant
-- statements, for the reasons given in 112_rls_policies_direct.sql.
--
-- Every parent link below was read off database/schema.sql, not inherited from
-- a list: a wrong column name in CREATE POLICY fails at migration time and
-- crash-loops the deployment.
--
-- Performance: each EXISTS is an index probe on the parent's primary key or an
-- existing FK index, and app-level WHERE user_id filtering already narrows the
-- candidate set before the policy runs -- so in practice the predicate
-- re-validates an already-correct, already-small set. The two-hop cases
-- (transaction_split_tags, scheduled_transaction_split_tags,
-- budget_period_categories) chain two such probes.
--
-- Junction tables are scoped through their OWNING parent only, not through both
-- foreign keys. Tagging tables link a user's own row to a user's own tag, so the
-- owning-side predicate is what enforces isolation; adding a second EXISTS on
-- the tag side would double the per-row cost to close a gap that leaks nothing
-- readable (the tag row itself is protected by the tags policy).
--
-- See docs/future-plans/row-level-security.md (Phase 3).

-- ---------------------------------------------------------------------------
-- Transactions family
-- ---------------------------------------------------------------------------

-- transaction_splits -> transactions.user_id
DROP POLICY IF EXISTS transaction_splits_isolation ON transaction_splits;
CREATE POLICY transaction_splits_isolation ON transaction_splits
  USING ((SELECT app_bypass_rls()) OR EXISTS (
    SELECT 1 FROM transactions t
    WHERE t.id = transaction_splits.transaction_id
      AND t.user_id = (SELECT app_current_user_id())))
  WITH CHECK ((SELECT app_bypass_rls()) OR EXISTS (
    SELECT 1 FROM transactions t
    WHERE t.id = transaction_splits.transaction_id
      AND t.user_id = (SELECT app_current_user_id())));

-- transaction_tags -> transactions.user_id
DROP POLICY IF EXISTS transaction_tags_isolation ON transaction_tags;
CREATE POLICY transaction_tags_isolation ON transaction_tags
  USING ((SELECT app_bypass_rls()) OR EXISTS (
    SELECT 1 FROM transactions t
    WHERE t.id = transaction_tags.transaction_id
      AND t.user_id = (SELECT app_current_user_id())))
  WITH CHECK ((SELECT app_bypass_rls()) OR EXISTS (
    SELECT 1 FROM transactions t
    WHERE t.id = transaction_tags.transaction_id
      AND t.user_id = (SELECT app_current_user_id())));

-- transaction_split_tags -> transaction_splits -> transactions.user_id (two-hop)
DROP POLICY IF EXISTS transaction_split_tags_isolation ON transaction_split_tags;
CREATE POLICY transaction_split_tags_isolation ON transaction_split_tags
  USING ((SELECT app_bypass_rls()) OR EXISTS (
    SELECT 1 FROM transaction_splits ts
    JOIN transactions t ON t.id = ts.transaction_id
    WHERE ts.id = transaction_split_tags.transaction_split_id
      AND t.user_id = (SELECT app_current_user_id())))
  WITH CHECK ((SELECT app_bypass_rls()) OR EXISTS (
    SELECT 1 FROM transaction_splits ts
    JOIN transactions t ON t.id = ts.transaction_id
    WHERE ts.id = transaction_split_tags.transaction_split_id
      AND t.user_id = (SELECT app_current_user_id())));

-- attachment_blobs -> transaction_attachments.user_id
-- (transaction_attachments is itself a direct table -- see 112.)
DROP POLICY IF EXISTS attachment_blobs_isolation ON attachment_blobs;
CREATE POLICY attachment_blobs_isolation ON attachment_blobs
  USING ((SELECT app_bypass_rls()) OR EXISTS (
    SELECT 1 FROM transaction_attachments ta
    WHERE ta.id = attachment_blobs.attachment_id
      AND ta.user_id = (SELECT app_current_user_id())))
  WITH CHECK ((SELECT app_bypass_rls()) OR EXISTS (
    SELECT 1 FROM transaction_attachments ta
    WHERE ta.id = attachment_blobs.attachment_id
      AND ta.user_id = (SELECT app_current_user_id())));

-- ---------------------------------------------------------------------------
-- Scheduled transactions family
-- ---------------------------------------------------------------------------

-- scheduled_transaction_splits -> scheduled_transactions.user_id
DROP POLICY IF EXISTS scheduled_transaction_splits_isolation ON scheduled_transaction_splits;
CREATE POLICY scheduled_transaction_splits_isolation ON scheduled_transaction_splits
  USING ((SELECT app_bypass_rls()) OR EXISTS (
    SELECT 1 FROM scheduled_transactions st
    WHERE st.id = scheduled_transaction_splits.scheduled_transaction_id
      AND st.user_id = (SELECT app_current_user_id())))
  WITH CHECK ((SELECT app_bypass_rls()) OR EXISTS (
    SELECT 1 FROM scheduled_transactions st
    WHERE st.id = scheduled_transaction_splits.scheduled_transaction_id
      AND st.user_id = (SELECT app_current_user_id())));

-- scheduled_transaction_split_tags -> scheduled_transaction_splits
--   -> scheduled_transactions.user_id (two-hop)
DROP POLICY IF EXISTS scheduled_transaction_split_tags_isolation ON scheduled_transaction_split_tags;
CREATE POLICY scheduled_transaction_split_tags_isolation ON scheduled_transaction_split_tags
  USING ((SELECT app_bypass_rls()) OR EXISTS (
    SELECT 1 FROM scheduled_transaction_splits sts
    JOIN scheduled_transactions st ON st.id = sts.scheduled_transaction_id
    WHERE sts.id = scheduled_transaction_split_tags.scheduled_transaction_split_id
      AND st.user_id = (SELECT app_current_user_id())))
  WITH CHECK ((SELECT app_bypass_rls()) OR EXISTS (
    SELECT 1 FROM scheduled_transaction_splits sts
    JOIN scheduled_transactions st ON st.id = sts.scheduled_transaction_id
    WHERE sts.id = scheduled_transaction_split_tags.scheduled_transaction_split_id
      AND st.user_id = (SELECT app_current_user_id())));

-- scheduled_transaction_overrides -> scheduled_transactions.user_id
DROP POLICY IF EXISTS scheduled_transaction_overrides_isolation ON scheduled_transaction_overrides;
CREATE POLICY scheduled_transaction_overrides_isolation ON scheduled_transaction_overrides
  USING ((SELECT app_bypass_rls()) OR EXISTS (
    SELECT 1 FROM scheduled_transactions st
    WHERE st.id = scheduled_transaction_overrides.scheduled_transaction_id
      AND st.user_id = (SELECT app_current_user_id())))
  WITH CHECK ((SELECT app_bypass_rls()) OR EXISTS (
    SELECT 1 FROM scheduled_transactions st
    WHERE st.id = scheduled_transaction_overrides.scheduled_transaction_id
      AND st.user_id = (SELECT app_current_user_id())));

-- ---------------------------------------------------------------------------
-- Securities family
--
-- securities is per-user (symbol is unique per user), so a security's price
-- history and tags belong to exactly one user despite looking like reference
-- data. holdings hang off the account, not the security.
-- ---------------------------------------------------------------------------

-- security_prices -> securities.user_id
DROP POLICY IF EXISTS security_prices_isolation ON security_prices;
CREATE POLICY security_prices_isolation ON security_prices
  USING ((SELECT app_bypass_rls()) OR EXISTS (
    SELECT 1 FROM securities s
    WHERE s.id = security_prices.security_id
      AND s.user_id = (SELECT app_current_user_id())))
  WITH CHECK ((SELECT app_bypass_rls()) OR EXISTS (
    SELECT 1 FROM securities s
    WHERE s.id = security_prices.security_id
      AND s.user_id = (SELECT app_current_user_id())));

-- security_tags -> securities.user_id
DROP POLICY IF EXISTS security_tags_isolation ON security_tags;
CREATE POLICY security_tags_isolation ON security_tags
  USING ((SELECT app_bypass_rls()) OR EXISTS (
    SELECT 1 FROM securities s
    WHERE s.id = security_tags.security_id
      AND s.user_id = (SELECT app_current_user_id())))
  WITH CHECK ((SELECT app_bypass_rls()) OR EXISTS (
    SELECT 1 FROM securities s
    WHERE s.id = security_tags.security_id
      AND s.user_id = (SELECT app_current_user_id())));

-- holdings -> accounts.user_id
DROP POLICY IF EXISTS holdings_isolation ON holdings;
CREATE POLICY holdings_isolation ON holdings
  USING ((SELECT app_bypass_rls()) OR EXISTS (
    SELECT 1 FROM accounts a
    WHERE a.id = holdings.account_id
      AND a.user_id = (SELECT app_current_user_id())))
  WITH CHECK ((SELECT app_bypass_rls()) OR EXISTS (
    SELECT 1 FROM accounts a
    WHERE a.id = holdings.account_id
      AND a.user_id = (SELECT app_current_user_id())));

-- ---------------------------------------------------------------------------
-- Budgets family
-- ---------------------------------------------------------------------------

-- budget_categories -> budgets.user_id
DROP POLICY IF EXISTS budget_categories_isolation ON budget_categories;
CREATE POLICY budget_categories_isolation ON budget_categories
  USING ((SELECT app_bypass_rls()) OR EXISTS (
    SELECT 1 FROM budgets b
    WHERE b.id = budget_categories.budget_id
      AND b.user_id = (SELECT app_current_user_id())))
  WITH CHECK ((SELECT app_bypass_rls()) OR EXISTS (
    SELECT 1 FROM budgets b
    WHERE b.id = budget_categories.budget_id
      AND b.user_id = (SELECT app_current_user_id())));

-- budget_periods -> budgets.user_id
DROP POLICY IF EXISTS budget_periods_isolation ON budget_periods;
CREATE POLICY budget_periods_isolation ON budget_periods
  USING ((SELECT app_bypass_rls()) OR EXISTS (
    SELECT 1 FROM budgets b
    WHERE b.id = budget_periods.budget_id
      AND b.user_id = (SELECT app_current_user_id())))
  WITH CHECK ((SELECT app_bypass_rls()) OR EXISTS (
    SELECT 1 FROM budgets b
    WHERE b.id = budget_periods.budget_id
      AND b.user_id = (SELECT app_current_user_id())));

-- budget_period_categories -> budget_periods -> budgets.user_id (two-hop)
DROP POLICY IF EXISTS budget_period_categories_isolation ON budget_period_categories;
CREATE POLICY budget_period_categories_isolation ON budget_period_categories
  USING ((SELECT app_bypass_rls()) OR EXISTS (
    SELECT 1 FROM budget_periods bp
    JOIN budgets b ON b.id = bp.budget_id
    WHERE bp.id = budget_period_categories.budget_period_id
      AND b.user_id = (SELECT app_current_user_id())))
  WITH CHECK ((SELECT app_bypass_rls()) OR EXISTS (
    SELECT 1 FROM budget_periods bp
    JOIN budgets b ON b.id = bp.budget_id
    WHERE bp.id = budget_period_categories.budget_period_id
      AND b.user_id = (SELECT app_current_user_id())));

-- ---------------------------------------------------------------------------
-- Monte Carlo
-- ---------------------------------------------------------------------------

-- monte_carlo_cash_flows -> monte_carlo_scenarios.user_id
DROP POLICY IF EXISTS monte_carlo_cash_flows_isolation ON monte_carlo_cash_flows;
CREATE POLICY monte_carlo_cash_flows_isolation ON monte_carlo_cash_flows
  USING ((SELECT app_bypass_rls()) OR EXISTS (
    SELECT 1 FROM monte_carlo_scenarios s
    WHERE s.id = monte_carlo_cash_flows.scenario_id
      AND s.user_id = (SELECT app_current_user_id())))
  WITH CHECK ((SELECT app_bypass_rls()) OR EXISTS (
    SELECT 1 FROM monte_carlo_scenarios s
    WHERE s.id = monte_carlo_cash_flows.scenario_id
      AND s.user_id = (SELECT app_current_user_id())));

-- ---------------------------------------------------------------------------
-- Delegation grants
--
-- account_delegate_grants -> account_delegates, which has no user_id either:
-- it is owner_user_id / delegate_user_id keyed. The parent predicate therefore
-- mirrors the account_delegates policy in 114 -- visible to the owner through
-- app.current_user_id and to the delegate through app.real_user_id, so a
-- delegate can still read which of the owner's accounts they were granted
-- while acting (current = owner, real = delegate).
-- ---------------------------------------------------------------------------

DROP POLICY IF EXISTS account_delegate_grants_isolation ON account_delegate_grants;
CREATE POLICY account_delegate_grants_isolation ON account_delegate_grants
  USING ((SELECT app_bypass_rls()) OR EXISTS (
    SELECT 1 FROM account_delegates ad
    WHERE ad.id = account_delegate_grants.delegation_id
      AND (ad.owner_user_id = (SELECT app_current_user_id())
        OR ad.delegate_user_id = (SELECT app_real_user_id()))))
  WITH CHECK ((SELECT app_bypass_rls()) OR EXISTS (
    SELECT 1 FROM account_delegates ad
    WHERE ad.id = account_delegate_grants.delegation_id
      AND (ad.owner_user_id = (SELECT app_current_user_id())
        OR ad.delegate_user_id = (SELECT app_real_user_id()))));
