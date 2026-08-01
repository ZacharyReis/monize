-- Row-Level Security, task M2 (3/3): tables with bespoke owner columns, plus
-- the documented list of tables deliberately left uncovered.
--
-- INERT (no ENABLE here -- that is M3 / flip B) and free of role and grant
-- statements, for the reasons given in 112_rls_policies_direct.sql.
--
-- None of these five tables has a user_id column: applying the direct-policy
-- template to them would fail at migration time with
-- `column "user_id" does not exist` and crash-loop the deployment. Their owner
-- columns were read off database/schema.sql.
--
-- These are also where both identity GUCs matter. app.current_user_id is the
-- effective user (the OWNER when a delegate is acting); app.real_user_id is the
-- authenticated identity (the DELEGATE while acting). Outside delegation they
-- hold the same id, so every real-arm below is redundant then and load-bearing
-- only while a delegate acts.
--
-- See docs/future-plans/row-level-security.md (Phase 3).

-- ---------------------------------------------------------------------------
-- users -- self-access through EITHER identity.
--
-- A delegate acting for an owner must still reach their OWN row: changePassword
-- deliberately targets req.user.realUserId, as do the 2FA and trusted-device
-- endpoints. Under a current-only policy those reads return no row and the
-- endpoints 404 while a delegate is acting.
--
-- Cross-user reads that legitimately precede a session -- login by email, OIDC
-- account lookup, admin -- carry no identity yet and go through
-- withSystemContext, i.e. the bypass arm.
-- ---------------------------------------------------------------------------
DROP POLICY IF EXISTS users_self ON users;
CREATE POLICY users_self ON users
  USING (id = (SELECT app_current_user_id())
      OR id = (SELECT app_real_user_id())
      OR (SELECT app_bypass_rls()))
  WITH CHECK (id = (SELECT app_current_user_id())
      OR id = (SELECT app_real_user_id())
      OR (SELECT app_bypass_rls()));

-- ---------------------------------------------------------------------------
-- account_delegates -- visible from both sides of the delegation.
--
-- The owner reaches it through app.current_user_id (managing who they share
-- with). The delegate reaches it through app.real_user_id, which works both in
-- their own session (current = real = delegate) and while acting for the owner
-- (current = owner, real = delegate) -- the latter is what lets the delegate
-- guard resolve its own grant row on every acting request.
-- ---------------------------------------------------------------------------
DROP POLICY IF EXISTS account_delegates_isolation ON account_delegates;
CREATE POLICY account_delegates_isolation ON account_delegates
  USING (owner_user_id = (SELECT app_current_user_id())
      OR delegate_user_id = (SELECT app_real_user_id())
      OR (SELECT app_bypass_rls()))
  WITH CHECK (owner_user_id = (SELECT app_current_user_id())
      OR delegate_user_id = (SELECT app_real_user_id())
      OR (SELECT app_bypass_rls()));

-- ---------------------------------------------------------------------------
-- delegate_account_favourites -- belongs to the delegate personally.
--
-- Keyed by the delegate's own identity even while they act as the owner
-- (current = owner, real = delegate), so this is the one table scoped by
-- app.real_user_id alone. Matching app.current_user_id as well would let an
-- owner read the private favourites of the delegates they share with.
-- ---------------------------------------------------------------------------
DROP POLICY IF EXISTS delegate_account_favourites_isolation ON delegate_account_favourites;
CREATE POLICY delegate_account_favourites_isolation ON delegate_account_favourites
  USING (delegate_user_id = (SELECT app_real_user_id())
      OR (SELECT app_bypass_rls()))
  WITH CHECK (delegate_user_id = (SELECT app_real_user_id())
      OR (SELECT app_bypass_rls()));

-- ---------------------------------------------------------------------------
-- emergency_access_settings / emergency_access_contacts -- owner-keyed only.
--
-- The authenticated surface (emergency-access.controller.ts, class-guarded by
-- AuthGuard('jwt') + StepUpGuard, no @AllowDelegate) is entirely owner-keyed:
-- every service call passes req.user.id as the owner and every query filters
-- owner_user_id. There is no "who named me as an emergency contact" lookup, so
-- no grantee-side arm is needed (audited in task C4).
--
-- The grantee-facing side is the public claim flow, which identifies the
-- grantee by emailed claim token rather than by user id and runs entirely under
-- withSystemContext -- the bypass arm.
-- ---------------------------------------------------------------------------
DROP POLICY IF EXISTS emergency_access_settings_isolation ON emergency_access_settings;
CREATE POLICY emergency_access_settings_isolation ON emergency_access_settings
  USING (owner_user_id = (SELECT app_current_user_id()) OR (SELECT app_bypass_rls()))
  WITH CHECK (owner_user_id = (SELECT app_current_user_id()) OR (SELECT app_bypass_rls()));

DROP POLICY IF EXISTS emergency_access_contacts_isolation ON emergency_access_contacts;
CREATE POLICY emergency_access_contacts_isolation ON emergency_access_contacts
  USING (owner_user_id = (SELECT app_current_user_id()) OR (SELECT app_bypass_rls()))
  WITH CHECK (owner_user_id = (SELECT app_current_user_id()) OR (SELECT app_bypass_rls()));

-- ---------------------------------------------------------------------------
-- Deliberately NOT policied (and therefore never enabled in M3).
--
-- The catalog-driven test in T2 asserts this exact list: a new table that lands
-- in neither a policy migration nor this exemption list fails the suite, so
-- forgetting one is a test failure rather than a review miss.
--
--   currencies       Global reference data keyed by ISO 4217 code, shared
--                    across all users. It does carry created_by_user_id, but
--                    that column is attribution (NULL = system currency), not
--                    ownership: any user may reference a custom code through
--                    accounts.currency_code, and a created_by_user_id policy
--                    would hide every system currency (the column is NULL
--                    there) and break those foreign keys. Per-user visibility
--                    is already expressed by user_currency_preferences, which
--                    IS policied.
--
--   exchange_rates   Global reference data with no owner column at all;
--                    written by the scheduled refresh under system context.
--
--   oauth_payloads   No owner column exists -- rows are keyed by opaque
--                    id/model/grant_id/uid. Every access happens in the
--                    pre-session OAuth flow, which runs under withSystemContext
--                    regardless, so a policy would consist of nothing but its
--                    bypass arm. Reviewed and confirmed in task C1: keep the
--                    runtime role's DML grants, leave the table exempt. The
--                    stronger option (revoke the grants and give the OAuth
--                    module an owner DataSource) was considered and declined --
--                    the table is a short-lived token store keyed by random id
--                    and is never queried per end-user.
--
--   schema_migrations  Migration infrastructure, written only by db-migrate
--                    running as the owner.
-- ---------------------------------------------------------------------------

-- Verification helper (run manually; not part of the migration's effect):
--   SELECT tablename, policyname FROM pg_policies
--    WHERE schemaname = 'public' ORDER BY tablename;
-- Expected: 50 policies -- 26 direct + 4 real-user-keyed (112),
--           15 indirect (113), 5 special (114).
