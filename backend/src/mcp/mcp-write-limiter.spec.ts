import { McpWriteLimiter, MCP_DAILY_WRITE_LIMIT } from "./mcp-write-limiter";

describe("McpWriteLimiter", () => {
  let limiter: McpWriteLimiter;

  beforeEach(() => {
    limiter = new McpWriteLimiter();
  });

  describe("checkLimit()", () => {
    it("allows operations when no previous writes exist", () => {
      const result = limiter.checkLimit("user-1");
      expect(result.allowed).toBe(true);
      expect(result.currentCount).toBe(0);
      expect(result.limit).toBe(MCP_DAILY_WRITE_LIMIT);
    });

    it("tracks operations per user", () => {
      limiter.record("user-1", "create_transaction");
      limiter.record("user-1", "categorize_transaction");

      const u1 = limiter.checkLimit("user-1");
      expect(u1.currentCount).toBe(2);
      expect(u1.allowed).toBe(true);

      const u2 = limiter.checkLimit("user-2");
      expect(u2.currentCount).toBe(0);
      expect(u2.allowed).toBe(true);
    });

    it("blocks when daily limit is reached", () => {
      for (let i = 0; i < MCP_DAILY_WRITE_LIMIT; i++) {
        limiter.record("user-1", "create_transaction");
      }

      const result = limiter.checkLimit("user-1");
      expect(result.allowed).toBe(false);
      expect(result.currentCount).toBe(MCP_DAILY_WRITE_LIMIT);
      expect(result.limit).toBe(MCP_DAILY_WRITE_LIMIT);
    });

    it("allows operations up to but not beyond the limit", () => {
      for (let i = 0; i < MCP_DAILY_WRITE_LIMIT - 1; i++) {
        limiter.record("user-1", "create_transaction");
      }

      const beforeLimit = limiter.checkLimit("user-1");
      expect(beforeLimit.allowed).toBe(true);
      expect(beforeLimit.currentCount).toBe(MCP_DAILY_WRITE_LIMIT - 1);

      limiter.record("user-1", "create_transaction");

      const atLimit = limiter.checkLimit("user-1");
      expect(atLimit.allowed).toBe(false);
      expect(atLimit.currentCount).toBe(MCP_DAILY_WRITE_LIMIT);
    });

    it("does not count operations from other users", () => {
      for (let i = 0; i < MCP_DAILY_WRITE_LIMIT; i++) {
        limiter.record("user-2", "create_transaction");
      }

      const result = limiter.checkLimit("user-1");
      expect(result.allowed).toBe(true);
      expect(result.currentCount).toBe(0);
    });
  });

  describe("record()", () => {
    it("records an operation", () => {
      limiter.record("user-1", "create_transaction");

      const result = limiter.checkLimit("user-1");
      expect(result.currentCount).toBe(1);
    });

    it("records multiple operations", () => {
      limiter.record("user-1", "create_transaction");
      limiter.record("user-1", "categorize_transaction");
      limiter.record("user-1", "create_transaction");

      const result = limiter.checkLimit("user-1");
      expect(result.currentCount).toBe(3);
    });
  });

  describe("pruning expired operations", () => {
    it("prunes operations older than 24 hours", () => {
      // Record operations and manually set old timestamps
      limiter.record("user-1", "create_transaction");

      // Access internal state to set an old timestamp
      const operations = (limiter as any).operations;
      operations[0].timestamp = Date.now() - 25 * 60 * 60 * 1000; // 25 hours ago

      // Check should trigger pruning
      const result = limiter.checkLimit("user-1");
      expect(result.currentCount).toBe(0);
      expect(result.allowed).toBe(true);
    });

    it("keeps operations within 24 hours", () => {
      limiter.record("user-1", "create_transaction");

      // Still recent, should be counted
      const result = limiter.checkLimit("user-1");
      expect(result.currentCount).toBe(1);
    });
  });

  describe("reserve()", () => {
    it("allows a reservation under the limit", () => {
      expect(limiter.reserve("user-1", 5)).toBeUndefined();
    });

    it("allows a reservation that exactly reaches the limit", () => {
      expect(limiter.reserve("user-1", MCP_DAILY_WRITE_LIMIT)).toBeUndefined();
    });

    it("blocks a reservation that would exceed the limit", () => {
      const result = limiter.reserve("user-1", MCP_DAILY_WRITE_LIMIT + 1);
      expect(result).toBeDefined();
      expect(result?.isError).toBe(true);
      expect(result?.content[0].text).toContain("Daily write limit reached");
    });

    it("accounts for already-recorded writes when reserving", () => {
      for (let i = 0; i < MCP_DAILY_WRITE_LIMIT - 2; i++) {
        limiter.record("user-1", "create_transaction");
      }

      // Two slots remain: reserving two is allowed, three is not.
      expect(limiter.reserve("user-1", 2)).toBeUndefined();
      expect(limiter.reserve("user-1", 3)).toBeDefined();
    });

    it("shares the budget across operations regardless of tool name", () => {
      for (let i = 0; i < MCP_DAILY_WRITE_LIMIT; i++) {
        limiter.record(
          "user-1",
          i % 2 === 0 ? "create_transaction" : "create_payee",
        );
      }

      // A single shared cap: once exhausted, any further write is blocked no
      // matter which domain/tool it belongs to.
      expect(limiter.reserve("user-1", 1)).toBeDefined();
    });
  });

  describe("MCP_DAILY_WRITE_LIMIT constant", () => {
    it("is set to 50", () => {
      expect(MCP_DAILY_WRITE_LIMIT).toBe(50);
    });
  });

  describe("configurable limit via MCP_DAILY_WRITE_LIMIT env var", () => {
    const stubConfig = (value: unknown) =>
      ({ get: jest.fn().mockReturnValue(value) }) as any;

    it("uses the env value when set to a positive integer", () => {
      const configured = new McpWriteLimiter(stubConfig(5));
      for (let i = 0; i < 5; i++) {
        configured.record("user-1", "create_transaction");
      }
      const result = configured.checkLimit("user-1");
      expect(result.limit).toBe(5);
      expect(result.allowed).toBe(false);
    });

    it("accepts the env value as a string (env vars are strings)", () => {
      const configured = new McpWriteLimiter(stubConfig("3"));
      expect(configured.checkLimit("user-1").limit).toBe(3);
    });

    it("falls back to the default when the env value is missing", () => {
      const configured = new McpWriteLimiter(stubConfig(undefined));
      expect(configured.checkLimit("user-1").limit).toBe(MCP_DAILY_WRITE_LIMIT);
    });

    it("falls back to the default for invalid or non-positive values", () => {
      for (const bad of ["abc", "0", "-5", "2.5", ""]) {
        expect(new McpWriteLimiter(stubConfig(bad)).checkLimit("u").limit).toBe(
          MCP_DAILY_WRITE_LIMIT,
        );
      }
    });
  });
});
