import { AsyncLocalStorage } from "node:async_hooks";

/**
 * Request-scoped (or job-scoped) ambient context, entered via the
 * RequestContextInterceptor for HTTP requests and via
 * `withUserContext`/`withSystemContext` for out-of-request code paths.
 *
 * The two identity fields feed Row-Level Security (see the RLS design doc):
 *   - `userId`      -- the *effective* user (the owner's id when a delegate is
 *                      acting), scopes the `app.current_user_id` GUC.
 *   - `realUserId`  -- the *authenticated* identity (the delegate's own id while
 *                      acting; equals `userId` outside delegation), scopes the
 *                      `app.real_user_id` GUC so delegate-keyed rows (the
 *                      delegate's own `users` row, `delegate_account_favourites`,
 *                      the delegate side of `account_delegates`) stay reachable.
 *   - `system`      -- set by `withSystemContext`; makes `tenantTx` emit
 *                      `app.bypass_rls` instead of an identity GUC.
 *   - `preserveTimestamps` -- set by the backup restore path; makes `tenantTx`
 *                      emit `app.preserve_timestamps` (in every mode) so the
 *                      GUC-aware `updated_at` trigger keeps restored values.
 */
export interface RequestContext {
  userId?: string;
  realUserId?: string;
  timezone?: string;
  system?: boolean;
  preserveTimestamps?: boolean;
}

export const requestContextStorage = new AsyncLocalStorage<RequestContext>();

export function getRequestContext(): RequestContext | undefined {
  return requestContextStorage.getStore();
}

export function getRequestTimezone(): string | undefined {
  return requestContextStorage.getStore()?.timezone;
}
