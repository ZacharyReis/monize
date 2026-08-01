/**
 * Row-Level Security (RLS) runtime mode.
 *
 * A single enum selects both GUC emission and the runtime DB role, so the
 * dangerous "unprivileged role with no GUC emission" state a two-boolean design
 * would allow is unrepresentable by construction (see the RLS design doc,
 * Phase 1/6):
 *   - `off`     : no identity GUCs emitted, runtime connects as the owner --
 *                 byte-for-byte identical to pre-RLS behavior.
 *   - `shadow`  : identity GUCs emitted per transaction, runtime still the owner
 *                 (policies bypassed) -- exercises the whole mechanism safely.
 *   - `enforce` : identity GUCs emitted and runtime connects as the
 *                 unprivileged `monize_app` role.
 */
export const RLS_MODES = ["off", "shadow", "enforce"] as const;

export type RlsMode = (typeof RLS_MODES)[number];

/** Default runtime role name when `DATABASE_APP_USER` is not set. */
export const DEFAULT_APP_USER = "monize_app";

/**
 * Parse and validate a raw `RLS_MODE` value. An unset/blank value defaults to
 * `off`. Any other unrecognized value throws so startup refuses to boot on a
 * typo rather than silently falling back to a mode the operator did not intend.
 */
export function parseRlsMode(raw: string | undefined | null): RlsMode {
  const value = (raw ?? "").trim().toLowerCase();
  if (value === "") {
    return "off";
  }
  if ((RLS_MODES as readonly string[]).includes(value)) {
    return value as RlsMode;
  }
  throw new Error(
    `Invalid RLS_MODE "${raw}". Must be one of: ${RLS_MODES.join(", ")} ` +
      "(unset defaults to off).",
  );
}

/**
 * Resolve the current RLS mode from the environment. Read fresh from
 * `process.env` so `tenantTx` reflects the process's configured mode without
 * threading a provider through every call site.
 */
export function getRlsMode(): RlsMode {
  return parseRlsMode(process.env.RLS_MODE);
}

export interface RlsDatabaseAuthInput {
  mode: RlsMode;
  databaseUser: string | undefined;
  databasePassword: string | undefined;
  appUser: string | undefined;
  appPassword: string | undefined;
}

export interface RlsDatabaseAuth {
  username: string | undefined;
  password: string | undefined;
}

/**
 * Choose the DB credentials the runtime connects with, based on the RLS mode.
 *
 * At `enforce` the runtime must connect as the unprivileged `monize_app` role,
 * so a missing `DATABASE_APP_PASSWORD` is a fatal misconfiguration -- throwing
 * here refuses the boot rather than silently connecting as the owner (which
 * would bypass every policy and defeat enforcement). In `off`/`shadow` the
 * runtime keeps the owner credentials, so the image is safe to deploy before
 * the role exists and a revert is a single flag flip.
 */
export function resolveRlsDatabaseAuth(
  input: RlsDatabaseAuthInput,
): RlsDatabaseAuth {
  if (input.mode === "enforce") {
    if (!input.appPassword) {
      throw new Error(
        "RLS_MODE=enforce requires DATABASE_APP_PASSWORD (the unprivileged " +
          "monize_app role's password). Set it, or use RLS_MODE=shadow/off.",
      );
    }
    return {
      username: input.appUser || DEFAULT_APP_USER,
      password: input.appPassword,
    };
  }
  return { username: input.databaseUser, password: input.databasePassword };
}
