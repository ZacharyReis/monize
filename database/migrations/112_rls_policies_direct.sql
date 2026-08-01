-- Row-Level Security, task M2 (1/3): policies for tables that carry their own
-- user_id column.
--
-- INERT. A policy on a table that has not run ALTER TABLE ... ENABLE ROW LEVEL
-- SECURITY is never consulted by the planner, so this migration changes no
-- query result. Enabling is a separate migration (M3) and a separate release
-- (flip B of the rollout) -- deliberately, so the policies can soak in prod
-- before they take effect.
--
-- Contains NO role and NO grant statements: migrations run unconditionally at
-- startup, so naming a role that may not exist would crash-loop the deployment.
-- Role and grants live in backend/src/db-init.ts (task F1).
--
-- Predicate form: every policy calls the helpers as scalar subqueries --
-- (SELECT app_current_user_id()) -- so the planner evaluates them once per
-- statement as an InitPlan rather than once per row. A bare function call would
-- rely on SQL-function inlining, which is not guaranteed across planner
-- versions; this is the standard RLS idiom and it matters on the sequential
-- scans that backup export and bulk reports perform.
--
-- Fail-closed: with the GUCs unset the helpers return NULL, `user_id = NULL` is
-- NULL (not true), and the row is filtered out. Missing context yields zero
-- rows, never an open door.
--
-- See docs/future-plans/row-level-security.md (Phase 3).

-- ---------------------------------------------------------------------------
-- Group A: keyed by the EFFECTIVE user (26 tables)
--
-- These hold the account owner's financial data. When a delegate acts on an
-- owner's behalf, app.current_user_id is the OWNER, which is exactly the
-- scoping these tables want -- a delegate browsing shared accounts must see the
-- owner's transactions, not their own.
--
-- Applied by a loop rather than 26 copy-pasted blocks: the predicate is
-- identical for every table, so a single source of truth removes the chance of
-- one table silently getting a different one. CREATE POLICY validates its
-- expression against the table, so a table missing user_id would fail loudly
-- here rather than mis-scoping at runtime.
-- ---------------------------------------------------------------------------

DO $$
DECLARE
    t text;
    direct_tables text[] := ARRAY[
        'accounts',
        'action_history',
        'ai_insights',
        'ai_provider_configs',
        'ai_usage_logs',
        'auto_backup_settings',
        'budget_alerts',
        'budgets',
        'categories',
        'custom_reports',
        'import_column_mappings',
        'institutions',
        'investment_reports',
        'investment_transactions',
        'loan_rate_changes',
        'loan_scenarios',
        'monte_carlo_scenarios',
        'monthly_account_balances',
        'payee_aliases',
        'payees',
        'scheduled_transactions',
        'securities',
        'tags',
        'transaction_attachments',
        'transactions',
        'user_currency_preferences'
    ];
BEGIN
    FOREACH t IN ARRAY direct_tables LOOP
        EXECUTE format('DROP POLICY IF EXISTS %I ON %I', t || '_isolation', t);
        EXECUTE format(
            'CREATE POLICY %I ON %I
               USING (user_id = (SELECT app_current_user_id()) OR (SELECT app_bypass_rls()))
               WITH CHECK (user_id = (SELECT app_current_user_id()) OR (SELECT app_bypass_rls()))',
            t || '_isolation', t
        );
    END LOOP;
END $$;

-- ---------------------------------------------------------------------------
-- Group B: keyed by the AUTHENTICATED user (4 tables)
--
-- These four also have a user_id column, but the id stored in it is the
-- *authenticated* identity, not the effective one. Under delegation those
-- differ, so the uniform Group A predicate would silently return zero rows for
-- the acting delegate -- inside normal request scope, where nothing throws and
-- nothing logs. Verified against the call sites rather than assumed; see the
-- per-table notes below.
--
-- Adding the app_real_user_id() arm cannot widen isolation: app.real_user_id
-- only ever holds the id the JWT layer authenticated, so the arm exposes the
-- caller's own rows and never a third party's. Outside delegation the two GUCs
-- are equal and the arm is redundant.
-- ---------------------------------------------------------------------------

-- refresh_tokens: user_id is ALWAYS the real authenticated user; when a
-- delegate acts, the owner is carried separately in acting_as_user_id
-- (see backend/src/auth/token.service.ts -- "sub is ALWAYS the real
-- authenticated user"). POST /auth/switch-context is @AllowDelegate and both
-- revokes and inserts delegate-keyed rows while the request context names the
-- owner, so the real arm is load-bearing.
--
-- The acting_as_user_id arm covers the inverse direction: an owner deleting
-- their account purges the delegate sessions opened against their data
-- (users.service.ts: delete({ actingAsUserId })). Those rows have another
-- user's user_id, so without this arm the purge would silently no-op and leave
-- live delegate sessions pointing at deleted data.
DROP POLICY IF EXISTS refresh_tokens_isolation ON refresh_tokens;
CREATE POLICY refresh_tokens_isolation ON refresh_tokens
  USING (user_id = (SELECT app_current_user_id())
      OR user_id = (SELECT app_real_user_id())
      OR acting_as_user_id = (SELECT app_current_user_id())
      OR (SELECT app_bypass_rls()))
  WITH CHECK (user_id = (SELECT app_current_user_id())
      OR user_id = (SELECT app_real_user_id())
      OR acting_as_user_id = (SELECT app_current_user_id())
      OR (SELECT app_bypass_rls()));

-- trusted_devices: uniformly real-user keyed. Every authenticated route that
-- reads or writes it (list / revoke / revoke-all trusted devices, disable 2FA,
-- change password) passes req.user.realUserId, and those routes ARE
-- @AllowDelegate -- so a delegate reaches their own devices while acting.
DROP POLICY IF EXISTS trusted_devices_isolation ON trusted_devices;
CREATE POLICY trusted_devices_isolation ON trusted_devices
  USING (user_id = (SELECT app_current_user_id())
      OR user_id = (SELECT app_real_user_id())
      OR (SELECT app_bypass_rls()))
  WITH CHECK (user_id = (SELECT app_current_user_id())
      OR user_id = (SELECT app_real_user_id())
      OR (SELECT app_bypass_rls()));

-- personal_access_tokens: the CRUD routes pass req.user.id but PatController
-- carries no @AllowDelegate, so the delegate guard rejects acting tokens and
-- the two ids coincide today. changePassword already revokes by realUserId.
-- The real arm makes the policy correct under either keying, so adding
-- @AllowDelegate later cannot turn into a silent zero-rows bug.
DROP POLICY IF EXISTS personal_access_tokens_isolation ON personal_access_tokens;
CREATE POLICY personal_access_tokens_isolation ON personal_access_tokens
  USING (user_id = (SELECT app_current_user_id())
      OR user_id = (SELECT app_real_user_id())
      OR (SELECT app_bypass_rls()))
  WITH CHECK (user_id = (SELECT app_current_user_id())
      OR user_id = (SELECT app_real_user_id())
      OR (SELECT app_bypass_rls()));

-- user_preferences: mostly effective-user keyed (locale, timezone, currency
-- display -- a delegate sees the owner's), but the 2FA endpoints
-- (confirm-setup, disable, is-enabled) are @AllowDelegate and read/write the
-- DELEGATE's own preferences row via req.user.realUserId. Both arms required.
DROP POLICY IF EXISTS user_preferences_isolation ON user_preferences;
CREATE POLICY user_preferences_isolation ON user_preferences
  USING (user_id = (SELECT app_current_user_id())
      OR user_id = (SELECT app_real_user_id())
      OR (SELECT app_bypass_rls()))
  WITH CHECK (user_id = (SELECT app_current_user_id())
      OR user_id = (SELECT app_real_user_id())
      OR (SELECT app_bypass_rls()));
