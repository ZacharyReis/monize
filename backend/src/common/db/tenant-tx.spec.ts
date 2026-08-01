import { DataSource, EntityManager } from "typeorm";
import { requestContextStorage, RequestContext } from "../request-context";
import {
  MISSING_CONTEXT_MESSAGE,
  getActiveTenantManager,
  tenantTx,
} from "./tenant-tx";

interface RecordedQuery {
  text: string;
  params?: unknown[];
}

function makeDataSource() {
  const queries: RecordedQuery[] = [];
  const manager = {
    query: jest.fn((text: string, params?: unknown[]) => {
      queries.push({ text, params });
      return Promise.resolve([]);
    }),
  } as unknown as EntityManager;
  const transaction = jest.fn(
    async <T>(cb: (m: EntityManager) => Promise<T>): Promise<T> => cb(manager),
  );
  const dataSource = { transaction } as unknown as DataSource;
  return { dataSource, manager, queries, transaction };
}

function run<T>(ctx: RequestContext, fn: () => Promise<T>): Promise<T> {
  return requestContextStorage.run(ctx, fn);
}

const originalMode = process.env.RLS_MODE;

afterEach(() => {
  if (originalMode === undefined) {
    delete process.env.RLS_MODE;
  } else {
    process.env.RLS_MODE = originalMode;
  }
});

describe("tenantTx -- context guard", () => {
  it.each(["off", "shadow", "enforce"])(
    "throws when there is no ambient context (mode %s)",
    async (mode) => {
      process.env.RLS_MODE = mode;
      const { dataSource, transaction } = makeDataSource();
      await expect(
        tenantTx(dataSource, async () => "unreachable"),
      ).rejects.toThrow(MISSING_CONTEXT_MESSAGE);
      expect(transaction).not.toHaveBeenCalled();
    },
  );

  it("throws when the context carries neither userId nor system", async () => {
    process.env.RLS_MODE = "enforce";
    const { dataSource } = makeDataSource();
    await expect(
      run({ timezone: "UTC" }, () =>
        tenantTx(dataSource, async () => "unreachable"),
      ),
    ).rejects.toThrow(MISSING_CONTEXT_MESSAGE);
  });
});

describe("tenantTx -- identity GUC emission", () => {
  it("emits both identity GUCs for a user context (enforce)", async () => {
    process.env.RLS_MODE = "enforce";
    const { dataSource, queries } = makeDataSource();
    await run({ userId: "user-a", realUserId: "delegate-b" }, () =>
      tenantTx(dataSource, async () => undefined),
    );
    expect(queries).toEqual([
      {
        text: "SELECT set_config('app.current_user_id', $1, true)",
        params: ["user-a"],
      },
      {
        text: "SELECT set_config('app.real_user_id', $1, true)",
        params: ["delegate-b"],
      },
    ]);
  });

  it("defaults real_user_id to userId when realUserId is absent", async () => {
    process.env.RLS_MODE = "shadow";
    const { dataSource, queries } = makeDataSource();
    await run({ userId: "user-a" }, () =>
      tenantTx(dataSource, async () => undefined),
    );
    expect(queries[1]).toEqual({
      text: "SELECT set_config('app.real_user_id', $1, true)",
      params: ["user-a"],
    });
  });

  it("emits the bypass GUC (not identity) for a system context", async () => {
    process.env.RLS_MODE = "enforce";
    const { dataSource, queries } = makeDataSource();
    await run({ system: true }, () =>
      tenantTx(dataSource, async () => undefined),
    );
    expect(queries).toEqual([
      {
        text: "SELECT set_config('app.bypass_rls', 'on', true)",
        params: undefined,
      },
    ]);
  });

  it("emits NO identity GUC at RLS_MODE=off", async () => {
    process.env.RLS_MODE = "off";
    const { dataSource, queries, transaction } = makeDataSource();
    const result = await run({ userId: "user-a" }, () =>
      tenantTx(dataSource, async () => "value"),
    );
    // Still wraps a transaction and runs fn, but sets no GUCs.
    expect(transaction).toHaveBeenCalledTimes(1);
    expect(queries).toEqual([]);
    expect(result).toBe("value");
  });

  it("emits no bypass GUC for a system context at off", async () => {
    process.env.RLS_MODE = "off";
    const { dataSource, queries } = makeDataSource();
    await run({ system: true }, () =>
      tenantTx(dataSource, async () => undefined),
    );
    expect(queries).toEqual([]);
  });
});

describe("tenantTx -- preserveTimestamps", () => {
  it.each(["off", "shadow", "enforce"])(
    "emits app.preserve_timestamps in every mode including %s",
    async (mode) => {
      process.env.RLS_MODE = mode;
      const { dataSource, queries } = makeDataSource();
      await run({ userId: "user-a", preserveTimestamps: true }, () =>
        tenantTx(dataSource, async () => undefined),
      );
      expect(queries).toContainEqual({
        text: "SELECT set_config('app.preserve_timestamps', 'on', true)",
        params: undefined,
      });
    },
  );

  it("emits only preserve_timestamps (no identity) at off", async () => {
    process.env.RLS_MODE = "off";
    const { dataSource, queries } = makeDataSource();
    await run({ userId: "user-a", preserveTimestamps: true }, () =>
      tenantTx(dataSource, async () => undefined),
    );
    expect(queries).toEqual([
      {
        text: "SELECT set_config('app.preserve_timestamps', 'on', true)",
        params: undefined,
      },
    ]);
  });
});

describe("tenantTx -- re-entrancy", () => {
  it("joins the ambient transaction and opens no second one", async () => {
    process.env.RLS_MODE = "enforce";
    const { dataSource, transaction, manager } = makeDataSource();

    await run({ userId: "user-a" }, () =>
      tenantTx(dataSource, async (outer) => {
        expect(outer).toBe(manager);
        expect(transaction).toHaveBeenCalledTimes(1);
        expect(getActiveTenantManager()).toBe(manager);

        const innerManager = await tenantTx(dataSource, async (inner) => {
          // Same manager, no new transaction opened.
          expect(transaction).toHaveBeenCalledTimes(1);
          return inner;
        });
        expect(innerManager).toBe(outer);
        // Still exactly one transaction after the nested call.
        expect(transaction).toHaveBeenCalledTimes(1);
      }),
    );
  });

  it("does not re-emit identity GUCs in the nested call", async () => {
    process.env.RLS_MODE = "enforce";
    const { dataSource, queries } = makeDataSource();
    await run({ userId: "user-a" }, () =>
      tenantTx(dataSource, async () => {
        const before = queries.length;
        await tenantTx(dataSource, async () => undefined);
        // No additional set_config calls from the nested tenantTx.
        expect(queries.length).toBe(before);
      }),
    );
  });

  it("clears the active manager after the transaction completes", async () => {
    process.env.RLS_MODE = "enforce";
    const { dataSource } = makeDataSource();
    await run({ userId: "user-a" }, () =>
      tenantTx(dataSource, async () => undefined),
    );
    expect(getActiveTenantManager()).toBeUndefined();
  });
});
