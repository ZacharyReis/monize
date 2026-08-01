import { Logger } from "@nestjs/common";
import { requestContextStorage } from "../request-context";
import { UUID_REGEX } from "../query-param-utils";

/**
 * Ambient-context helpers for code with no HTTP request (guards/strategies,
 * cron jobs, seeders, backup restore). They seed the same AsyncLocalStorage
 * scope the RequestContextInterceptor does, so every `tenantTx` inside `fn`
 * emits the matching GUC. They hold no connection and need no cleanup.
 *
 * Importing this module is restricted to an allowlist by lint (task L1) so the
 * `withSystemContext` bypass cannot metastasize: widening the allowlist is a
 * reviewed decision, not a drive-by fix. See the RLS design doc, Phase 4.
 */

const bypassLogger = new Logger("SystemContext");

// Rate-limit the bypass audit log per call site so a hot cron/job path does not
// flood the logs while still making every distinct bypass site observable.
const BYPASS_LOG_INTERVAL_MS = 60 * 1000;
const lastBypassLogByCallSite = new Map<string, number>();

/**
 * Seed a *user* context: `tenantTx` will emit `app.current_user_id` /
 * `app.real_user_id` for this user. Validates the id is a UUID -- a garbage
 * value would make every policied statement raise 22P02 at enforcement, so we
 * fail here, at the wrap site, instead.
 */
export function withUserContext<T>(userId: string, fn: () => T): T {
  if (!UUID_REGEX.test(userId)) {
    throw new Error(
      `withUserContext requires a valid UUID userId (got "${userId}")`,
    );
  }
  return requestContextStorage.run({ userId }, fn);
}

/**
 * Seed a *system* context: `tenantTx` will emit `app.bypass_rls` so the body
 * can read/write across users (admin, auth bootstrap, cron fan-out, seeders,
 * emergency-access claim, expiry sweeps). Each invocation is logged (rate-
 * limited, with its call site) so bypass usage is auditable in prod.
 */
export function withSystemContext<T>(fn: () => T): T {
  auditBypassInvocation();
  return requestContextStorage.run({ system: true }, fn);
}

function auditBypassInvocation(): void {
  const callSite = resolveCallSite();
  const now = Date.now();
  const last = lastBypassLogByCallSite.get(callSite) ?? 0;
  if (now - last < BYPASS_LOG_INTERVAL_MS) {
    return;
  }
  lastBypassLogByCallSite.set(callSite, now);
  bypassLogger.log(`RLS bypass (withSystemContext) entered from ${callSite}`);
}

/**
 * Best-effort caller location: the first stack frame outside this module.
 * Used only as a rate-limit key and a log detail, so an "unknown" fallback is
 * harmless.
 */
function resolveCallSite(): string {
  return callSiteFromStack(new Error().stack);
}

// This module's own frames (with-context.ts / with-context.js). The
// `\.(?:ts|js)` anchor deliberately does NOT match a `with-context.spec.ts`
// caller, so a test (or any legitimately similarly-named caller) is reported,
// not skipped.
const OWN_FRAME = /with-context\.(?:ts|js)/;

/**
 * Extract the first caller frame from a stack trace, skipping this module's own
 * frames. Exported for unit testing; returns "unknown" when the stack is absent
 * or holds no external frame.
 */
export function callSiteFromStack(stack: string | undefined): string {
  if (!stack) {
    return "unknown";
  }
  for (const raw of stack.split("\n").slice(1)) {
    const line = raw.trim();
    if (line.startsWith("at ") && !OWN_FRAME.test(line)) {
      return line.replace(/^at\s+/, "");
    }
  }
  return "unknown";
}
