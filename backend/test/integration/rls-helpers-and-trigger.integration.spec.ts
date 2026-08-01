import { DataSource } from "typeorm";
import * as fs from "fs";
import * as path from "path";

import { INTEGRATION_TYPEORM_OPTIONS } from "../helpers/integration-setup";

/**
 * Acceptance coverage for RLS task M1 -- `database/migrations/111_rls_helpers_and_trigger.sql`.
 *
 * The migration is deliberately *inert*: it adds the three identity helper
 * functions and swaps `update_updated_at_column()` for a GUC-aware version that
 * must behave identically while `app.preserve_timestamps` is unset. This spec
 * proves both halves of that claim against a real PostgreSQL, and asserts the
 * fail-closed semantics the policies in M2 depend on.
 *
 * It runs the migration file **read from disk** rather than a copy of its SQL,
 * so the assertions can never drift from what ships. It owns its own scratch
 * table and never touches application tables, so it is independent of the
 * broader harness work in T1.
 */
describe("RLS helpers and updated_at trigger (migration 111)", () => {
  let dataSource: DataSource;

  const MIGRATION = path.join(
    __dirname,
    "../../../database/migrations/111_rls_helpers_and_trigger.sql",
  );

  const UUID_A = "11111111-1111-1111-1111-111111111111";
  const UUID_B = "22222222-2222-2222-2222-222222222222";
  const OLD_TIMESTAMP = "2001-01-01 00:00:00";

  beforeAll(async () => {
    dataSource = new DataSource({
      ...INTEGRATION_TYPEORM_OPTIONS,
      // This spec needs no entities: it works against its own scratch table.
      entities: [],
      synchronize: false,
      dropSchema: false,
    } as never);
    await dataSource.initialize();

    // Fail loudly rather than silently skipping if the migration is missing.
    if (!fs.existsSync(MIGRATION)) {
      throw new Error(`RLS migration not found at ${MIGRATION}`);
    }
    await dataSource.query(fs.readFileSync(MIGRATION, "utf8"));

    // A scratch table carrying the same updated_at trigger the real tables use.
    // `synchronize` builds the schema from entities and creates no DB triggers,
    // so the trigger under test has to be created explicitly here.
    await dataSource.query(`DROP TABLE IF EXISTS rls_trigger_probe`);
    await dataSource.query(`
      CREATE TABLE rls_trigger_probe (
        id SERIAL PRIMARY KEY,
        label TEXT,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);
    await dataSource.query(`
      CREATE TRIGGER update_rls_trigger_probe_updated_at
      BEFORE UPDATE ON rls_trigger_probe
      FOR EACH ROW EXECUTE FUNCTION update_updated_at_column()
    `);
  });

  afterAll(async () => {
    if (dataSource?.isInitialized) {
      await dataSource.query(`DROP TABLE IF EXISTS rls_trigger_probe`);
      await dataSource.destroy();
    }
  });

  beforeEach(async () => {
    await dataSource.query(`TRUNCATE rls_trigger_probe RESTART IDENTITY`);
    await dataSource.query(
      `INSERT INTO rls_trigger_probe (id, label) VALUES (1, 'initial')`,
    );
  });

  describe("migration hygiene", () => {
    it("contains no role or grant statements", () => {
      // A GRANT naming the runtime role would crash-loop every deployment where
      // that role does not exist -- role and grants belong to db-init (F1).
      const sql = fs
        .readFileSync(MIGRATION, "utf8")
        // Strip line comments: the file *documents* this rule in prose.
        .replace(/^\s*--.*$/gm, "");

      expect(sql).not.toMatch(/\bGRANT\b/i);
      expect(sql).not.toMatch(/\bREVOKE\b/i);
      expect(sql).not.toMatch(/\b(CREATE|ALTER|DROP)\s+ROLE\b/i);
      expect(sql).not.toMatch(/monize_app/i);
    });

    it("is idempotent -- re-applying changes nothing", async () => {
      await dataSource.query(fs.readFileSync(MIGRATION, "utf8"));

      const [row] = await dataSource.query(`
        SELECT app_current_user_id() IS NULL AS is_null,
               app_bypass_rls()             AS bypass
      `);
      expect(row.is_null).toBe(true);
      expect(row.bypass).toBe(false);
    });
  });

  describe("identity helpers fail closed", () => {
    it("returns NULL / false when the GUCs are unset", async () => {
      const [row] = await dataSource.query(`
        SELECT app_current_user_id() AS current_id,
               app_real_user_id()    AS real_id,
               app_bypass_rls()      AS bypass
      `);

      expect(row.current_id).toBeNull();
      expect(row.real_id).toBeNull();
      // false, not NULL -- see the COALESCE note in the migration.
      expect(row.bypass).toBe(false);
    });

    it("treats an empty GUC as unset rather than raising", async () => {
      const runner = dataSource.createQueryRunner();
      await runner.connect();
      await runner.startTransaction();
      try {
        await runner.query(
          `SELECT set_config('app.current_user_id', '', true)`,
        );
        const [row] = await runner.query(
          `SELECT app_current_user_id() IS NULL AS is_null`,
        );
        expect(row.is_null).toBe(true);
      } finally {
        await runner.rollbackTransaction();
        await runner.release();
      }
    });

    it("reads both identity GUCs independently", async () => {
      const runner = dataSource.createQueryRunner();
      await runner.connect();
      await runner.startTransaction();
      try {
        await runner.query(
          `SELECT set_config('app.current_user_id', $1, true)`,
          [UUID_A],
        );
        await runner.query(`SELECT set_config('app.real_user_id', $1, true)`, [
          UUID_B,
        ]);
        const [row] = await runner.query(`
          SELECT app_current_user_id() AS current_id,
                 app_real_user_id()    AS real_id
        `);
        expect(row.current_id).toBe(UUID_A);
        expect(row.real_id).toBe(UUID_B);
      } finally {
        await runner.rollbackTransaction();
        await runner.release();
      }
    });

    it("raises 22P02 for a non-UUID GUC instead of returning NULL", async () => {
      // This is a distinct failure class from "unset": garbage must be a loud
      // cast error, never a silent empty result that reads like real data.
      const runner = dataSource.createQueryRunner();
      await runner.connect();
      await runner.startTransaction();
      try {
        await runner.query(
          `SELECT set_config('app.current_user_id', 'not-a-uuid', true)`,
        );
        await expect(
          runner.query(`SELECT app_current_user_id()`),
        ).rejects.toMatchObject({ code: "22P02" });
      } finally {
        await runner.rollbackTransaction();
        await runner.release();
      }
    });

    it("reverts the GUCs at COMMIT, so a pooled connection carries no identity", async () => {
      const runner = dataSource.createQueryRunner();
      await runner.connect();
      try {
        await runner.startTransaction();
        await runner.query(
          `SELECT set_config('app.current_user_id', $1, true)`,
          [UUID_A],
        );
        const [inside] = await runner.query(
          `SELECT app_current_user_id() AS current_id`,
        );
        expect(inside.current_id).toBe(UUID_A);
        await runner.commitTransaction();

        // Same physical connection, after COMMIT.
        const [after] = await runner.query(
          `SELECT app_current_user_id() IS NULL AS is_null`,
        );
        expect(after.is_null).toBe(true);
      } finally {
        await runner.release();
      }
    });

    it("reports bypass only when the GUC is exactly 'on'", async () => {
      const runner = dataSource.createQueryRunner();
      await runner.connect();
      await runner.startTransaction();
      try {
        await runner.query(`SELECT set_config('app.bypass_rls', 'off', true)`);
        const [off] = await runner.query(`SELECT app_bypass_rls() AS bypass`);
        expect(off.bypass).toBe(false);

        await runner.query(`SELECT set_config('app.bypass_rls', 'on', true)`);
        const [on] = await runner.query(`SELECT app_bypass_rls() AS bypass`);
        expect(on.bypass).toBe(true);
      } finally {
        await runner.rollbackTransaction();
        await runner.release();
      }
    });
  });

  describe("updated_at trigger", () => {
    it("still stamps CURRENT_TIMESTAMP when app.preserve_timestamps is unset", async () => {
      // The inertness claim: with the GUC unset the new function is the old one.
      await dataSource.query(
        `UPDATE rls_trigger_probe SET label = 'changed', updated_at = $1 WHERE id = 1`,
        [OLD_TIMESTAMP],
      );

      const [row] = await dataSource.query(
        `SELECT updated_at FROM rls_trigger_probe WHERE id = 1`,
      );
      expect(new Date(row.updated_at).getFullYear()).toBeGreaterThan(2020);
    });

    it("preserves the supplied updated_at when the GUC is 'on'", async () => {
      const runner = dataSource.createQueryRunner();
      await runner.connect();
      await runner.startTransaction();
      try {
        await runner.query(
          `SELECT set_config('app.preserve_timestamps', 'on', true)`,
        );
        await runner.query(
          `UPDATE rls_trigger_probe SET label = 'restored', updated_at = $1 WHERE id = 1`,
          [OLD_TIMESTAMP],
        );

        const [row] = await runner.query(
          `SELECT updated_at FROM rls_trigger_probe WHERE id = 1`,
        );
        expect(new Date(row.updated_at).getFullYear()).toBe(2001);
        await runner.commitTransaction();
      } catch (error) {
        await runner.rollbackTransaction();
        throw error;
      } finally {
        await runner.release();
      }
    });

    it("resumes stamping once the preserving transaction has committed", async () => {
      // The GUC is transaction-local, so nothing has to reset it afterwards.
      const runner = dataSource.createQueryRunner();
      await runner.connect();
      await runner.startTransaction();
      await runner.query(
        `SELECT set_config('app.preserve_timestamps', 'on', true)`,
      );
      await runner.query(
        `UPDATE rls_trigger_probe SET updated_at = $1 WHERE id = 1`,
        [OLD_TIMESTAMP],
      );
      await runner.commitTransaction();

      await runner.query(
        `UPDATE rls_trigger_probe SET updated_at = $1 WHERE id = 1`,
        [OLD_TIMESTAMP],
      );
      const [row] = await runner.query(
        `SELECT updated_at FROM rls_trigger_probe WHERE id = 1`,
      );
      await runner.release();

      expect(new Date(row.updated_at).getFullYear()).toBeGreaterThan(2020);
    });
  });
});
