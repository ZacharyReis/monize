import { AsyncLocalStorage } from "node:async_hooks";
import { DataSource, EntityManager } from "typeorm";
import { getRequestContext } from "../request-context";
import { getRlsMode } from "./rls-config";

/**
 * The single sanctioned door to the database under Row-Level Security.
 *
 * `tenantTx` opens a transaction, sets the identity GUC transaction-locally
 * (`set_config(..., true)`, i.e. `SET LOCAL` semantics) as its first statement,
 * and runs `fn` with the transaction's EntityManager. Because the GUC dies with
 * the transaction, no pooled connection can ever carry a prior request's
 * identity -- there is no reset code, no release hook. See the RLS design doc,
 * Phase 2b.
 *
 * It **throws** when no ambient context exists: a silent fallback to
 * `dataSource.manager` would run a query with no GUC under enforcement (zero
 * rows that look exactly like empty data). Refusing instead moves that whole
 * failure class to dev/CI at `RLS_MODE=off`, long before enforcement.
 */

// The active transaction's EntityManager, carried in its own ALS scope so a
// nested tenantTx can join the ambient transaction instead of opening a second
// one. A second `dataSource.transaction` would take a second pooled connection
// inside the first and deadlock the pool under load (see design Phase 2b).
const activeManagerStorage = new AsyncLocalStorage<EntityManager>();

export function getActiveTenantManager(): EntityManager | undefined {
  return activeManagerStorage.getStore();
}

/**
 * Run `fn` while `manager` is registered as the ambient transaction. Exported
 * for tests and for advanced callers that already hold a manager; ordinary code
 * should use `tenantTx`.
 */
export function runWithActiveTenantManager<T>(
  manager: EntityManager,
  fn: () => T,
): T {
  return activeManagerStorage.run(manager, fn);
}

export const MISSING_CONTEXT_MESSAGE =
  "DB access outside request/user/system context -- wrap the call path in withUserContext/withSystemContext";

export async function tenantTx<T>(
  dataSource: DataSource,
  fn: (manager: EntityManager) => Promise<T>,
): Promise<T> {
  const ctx = getRequestContext();
  if (!ctx || (!ctx.userId && !ctx.system)) {
    throw new Error(MISSING_CONTEXT_MESSAGE);
  }

  const active = getActiveTenantManager();
  if (active) {
    // Re-entrant call: join the ambient transaction (same connection, same
    // GUCs, same atomicity). Never open a second transaction.
    return fn(active);
  }

  return dataSource.transaction(async (manager) => {
    const mode = getRlsMode();
    if (mode !== "off") {
      if (ctx.system) {
        // Privileged escape hatch -- policies OR in app_bypass_rls().
        await manager.query("SELECT set_config('app.bypass_rls', 'on', true)");
      } else {
        // Both identity GUCs. `real` defaults to `current` outside delegation.
        await manager.query(
          "SELECT set_config('app.current_user_id', $1, true)",
          [ctx.userId],
        );
        await manager.query("SELECT set_config('app.real_user_id', $1, true)", [
          ctx.realUserId ?? ctx.userId,
        ]);
      }
    }

    if (ctx.preserveTimestamps) {
      // NOT gated on the RLS mode: this replaces the backup restore path's old
      // `DISABLE TRIGGER` DDL and must work in every mode (including `off`) once
      // the GUC-aware `updated_at` trigger has shipped (migration M1).
      await manager.query(
        "SELECT set_config('app.preserve_timestamps', 'on', true)",
      );
    }

    return runWithActiveTenantManager(manager, () => fn(manager));
  });
}
