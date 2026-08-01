-- Row-Level Security, task M1: identity helper functions + GUC-aware updated_at trigger.
--
-- Behaviour-inert on its own. It creates no policy and enables RLS on no table;
-- the helpers simply return NULL/false while their GUCs are unset, and the
-- replacement trigger function is byte-for-byte equivalent to the old one until
-- app.preserve_timestamps is set.
--
-- IMPORTANT: this file deliberately contains NO role and NO grant statements.
-- Migrations run unconditionally at startup on every deployment; a GRANT naming
-- the runtime role would fail on any deployment where that role does not exist,
-- exiting db-migrate and crash-looping the container. Role creation and grants
-- live in backend/src/db-init.ts (task F1), which tolerates their absence.
--
-- See docs/future-plans/row-level-security.md (Phase 3).

-- Identity GUCs, read fail-closed.
--
-- app.current_user_id -- the effective user (the account owner when a delegate
--   is acting on their behalf).
-- app.real_user_id    -- the authenticated identity (the delegate while acting);
--   equal to current_user_id outside delegation.
-- app.bypass_rls      -- set only inside an explicit withSystemContext scope, for
--   cross-user work (cron fan-out, seeders, admin, pre-session auth).
--
-- Fail-closed semantics: an unset or empty GUC yields NULL, which makes every
-- policy predicate false and returns zero rows -- deny, never allow. A GUC
-- holding a non-UUID string does NOT return zero rows: the ::uuid cast raises
-- 22P02 and the statement errors. Both are fail-closed, but they are distinct
-- failure classes and the RLS test suite asserts each by its own class.
--
-- The 'missing_ok' second argument to current_setting is required: without it,
-- reading an unset GUC raises 42704 instead of returning NULL.
--
-- STABLE (not VOLATILE) lets the planner hoist these into a once-per-statement
-- InitPlan when policies call them as scalar subqueries -- (SELECT app_...()) --
-- instead of re-evaluating per row.

CREATE OR REPLACE FUNCTION app_current_user_id() RETURNS uuid
LANGUAGE sql STABLE AS $$
  SELECT NULLIF(current_setting('app.current_user_id', true), '')::uuid
$$;

CREATE OR REPLACE FUNCTION app_real_user_id() RETURNS uuid
LANGUAGE sql STABLE AS $$
  SELECT NULLIF(current_setting('app.real_user_id', true), '')::uuid
$$;

-- COALESCE is deliberate. Without it an unset GUC makes current_setting return
-- NULL and the comparison yields NULL rather than false. In the OR-ed policy
-- predicates that is still fail-closed (`false OR NULL` is NULL, which filters
-- the row out), but a boolean function that can return NULL is a trap for any
-- future caller writing `NOT app_bypass_rls()` -- that would be NULL too, and
-- silently match nothing. Returning a proper false keeps the function honest in
-- every position.
CREATE OR REPLACE FUNCTION app_bypass_rls() RETURNS boolean
LANGUAGE sql STABLE AS $$
  SELECT COALESCE(current_setting('app.bypass_rls', true) = 'on', false)
$$;

COMMENT ON FUNCTION app_current_user_id() IS
  'RLS: effective user id from the app.current_user_id GUC (owner when a delegate acts). NULL when unset -- policies then match no rows.';
COMMENT ON FUNCTION app_real_user_id() IS
  'RLS: authenticated user id from the app.real_user_id GUC (the delegate while acting; equals app_current_user_id() otherwise).';
COMMENT ON FUNCTION app_bypass_rls() IS
  'RLS: true inside a withSystemContext scope, letting cross-user jobs (cron, seed, admin, pre-session auth) see every row.';

-- GUC-aware replacement of the shared updated_at trigger function.
--
-- Backup restore must write rows carrying their ORIGINAL updated_at values.
-- Today it achieves that with ALTER TABLE ... DISABLE TRIGGER, which requires
-- table ownership -- a privilege the unprivileged runtime role must not have.
-- Honouring an app.preserve_timestamps GUC instead removes the DDL entirely
-- (task C5 switches the restore path over).
--
-- Inert until then: with the GUC unset, current_setting(..., true) returns NULL,
-- NULL = 'on' is NULL (not true), the IF does not fire, and the function stamps
-- CURRENT_TIMESTAMP exactly as before. Existing triggers pick the new body up
-- automatically -- they reference the function by name, so no trigger is
-- recreated here.

CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    IF current_setting('app.preserve_timestamps', true) = 'on' THEN
        -- Restore path: keep the updated_at value supplied by the caller.
        RETURN NEW;
    END IF;
    NEW.updated_at = CURRENT_TIMESTAMP;
    RETURN NEW;
END;
$$ language 'plpgsql';

COMMENT ON FUNCTION update_updated_at_column() IS
  'Stamps NEW.updated_at with CURRENT_TIMESTAMP, unless the app.preserve_timestamps GUC is ''on'' (backup restore).';
