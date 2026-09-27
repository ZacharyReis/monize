import { Logger } from "@nestjs/common";
import { Test, TestingModule } from "@nestjs/testing";
import { ConfigService } from "@nestjs/config";
import { McpHttpController } from "./mcp-http.controller";
import { McpServerService } from "./mcp-server.service";
import { PatService } from "../auth/pat.service";
import { OAuthProviderService } from "../oauth/oauth-provider.service";

// A transport that behaves like the SDK's where the session log cares: it
// assigns a session id on `initialize`, and close() re-enters via onclose
// (which is also what the real one does when it handles a DELETE).
jest.mock("@modelcontextprotocol/sdk/server/streamableHttp.js", () => {
  class FakeTransport {
    sessionId?: string;
    onclose?: () => void;
    constructor(private readonly opts: { sessionIdGenerator: () => string }) {}
    async handleRequest(req: any) {
      if (req.method === "DELETE") {
        await this.close();
        return;
      }
      if (req.body?.method === "initialize") {
        this.sessionId = this.opts.sessionIdGenerator();
      }
    }
    async close() {
      this.onclose?.();
    }
  }
  return { StreamableHTTPServerTransport: FakeTransport };
});

const TOKEN = "pat_supersecret_token_value";

function initReq(
  clientInfo: unknown = { name: "claude-code", version: "2.1.0" },
  userAgent = "claude-code/2.1.0 (cli)",
) {
  return {
    method: "POST",
    headers: { authorization: `Bearer ${TOKEN}`, "user-agent": userAgent },
    body: {
      jsonrpc: "2.0",
      id: 0,
      method: "initialize",
      params: { clientInfo },
    },
  } as any;
}

function sessionReq(method: string, sessionId: string) {
  return {
    method,
    headers: {
      authorization: `Bearer ${TOKEN}`,
      "mcp-session-id": sessionId,
    },
    body: { jsonrpc: "2.0", id: 1, method: "tools/call" },
  } as any;
}

function res() {
  return {
    status: jest.fn().mockReturnThis(),
    json: jest.fn(),
    setHeader: jest.fn(),
  } as any;
}

describe("McpHttpController session log (T-1034)", () => {
  let controller: McpHttpController;
  let logSpy: jest.SpyInstance;
  let warnSpy: jest.SpyInstance;

  const logged = () =>
    [...logSpy.mock.calls, ...warnSpy.mock.calls].map((c) => String(c[0]));
  const lines = (prefix: string) =>
    logged().filter((l) => l.startsWith(prefix));

  async function open(clientInfo?: unknown, userAgent?: string) {
    await controller.handlePost(initReq(clientInfo, userAgent), res());
    const ids = [...(controller as any).transports.keys()] as string[];
    return ids[ids.length - 1];
  }

  beforeEach(async () => {
    logSpy = jest.spyOn(Logger.prototype, "log").mockImplementation(() => {});
    warnSpy = jest.spyOn(Logger.prototype, "warn").mockImplementation(() => {});

    const module: TestingModule = await Test.createTestingModule({
      controllers: [McpHttpController],
      providers: [
        {
          provide: McpServerService,
          useValue: {
            createServer: jest.fn().mockReturnValue({ connect: jest.fn() }),
          },
        },
        {
          provide: PatService,
          useValue: {
            validateToken: jest
              .fn()
              .mockResolvedValue({ userId: "user-1", scopes: "read" }),
          },
        },
        {
          provide: OAuthProviderService,
          useValue: { validateAccessToken: jest.fn().mockResolvedValue(null) },
        },
        {
          provide: ConfigService,
          useValue: { get: jest.fn().mockReturnValue("https://app.test") },
        },
      ],
    }).compile();

    controller = module.get(McpHttpController);
  });

  afterEach(() => {
    controller.onModuleDestroy();
    jest.restoreAllMocks();
  });

  it("logs who opened a session, with a token fingerprint and never the token", async () => {
    const sid = await open();

    const [line] = lines("open ");
    expect(line).toContain(`sid=${sid.slice(0, 8)}`);
    expect(line).toContain("client=claude-code/2.1.0");
    expect(line).toContain('ua="claude-code/2.1.0 (cli)"');
    expect(line).toMatch(/auth=pat:[0-9a-f]{8} /);
    expect(line).toContain("held=1/10");
    expect(logged().join("\n")).not.toContain("supersecret");
  });

  it("strips control characters and quotes from client-supplied strings", async () => {
    await open({ name: 'evil\nclose sid="x"', version: "1" }, "ua\r\nforged");

    const [line] = lines("open ");
    expect(line).not.toMatch(/[\r\n]/);
    expect(line).toContain("client=evilclose sid=x/1");
    expect(line).toContain('ua="uaforged"');
  });

  it("names a client DELETE as the reason, once, despite the transport's re-entrant close", async () => {
    const sid = await open();
    await controller.handlePost(sessionReq("POST", sid), res());

    await controller.handleDelete(sessionReq("DELETE", sid), res());

    const closes = lines("close ");
    expect(closes).toHaveLength(1);
    expect(closes[0]).toContain("reason=delete");
    expect(closes[0]).toContain("client=claude-code/2.1.0");
    expect(closes[0]).toContain("req=2");
    expect(closes[0]).toContain("held=0/10");
    expect((controller as any).sessionMeta.size).toBe(0);
  });

  it("logs the holders when it refuses an eleventh session", async () => {
    const first = await open({ name: "codex-mcp-client", version: "0.9" });
    for (let i = 0; i < 9; i++) await open();

    const refused = res();
    await controller.handlePost(
      initReq({ name: "mcp", version: "0.1" }, "python-httpx/0.28.1"),
      refused,
    );

    expect(refused.status).toHaveBeenCalledWith(429);
    const [line] = lines("refused 429 ");
    expect(line).toContain('client=mcp/0.1 ua="python-httpx/0.28.1"');
    expect(line).toContain("held=10/10");
    expect(line).toContain(
      `${first.slice(0, 8)} codex-mcp-client/0.9 age=0m idle=0m req=1`,
    );
    expect(line.match(/claude-code\/2\.1\.0/g)).toHaveLength(9);
  });

  it("logs expiry from the sweep and on access with distinct reasons", async () => {
    const swept = await open();
    const accessed = await open();
    const createdAt = (controller as any).sessionCreatedAt as Map<
      string,
      number
    >;
    createdAt.set(swept, Date.now() - 3_700_000);

    (controller as any).cleanupExpiredSessions();
    expect(lines("close ")).toEqual([
      expect.stringContaining(`sid=${swept.slice(0, 8)} reason=expired `),
    ]);

    createdAt.set(accessed, Date.now() - 3_700_000);
    await controller.handlePost(sessionReq("POST", accessed), res());
    expect(lines("close ")[1]).toContain(
      `sid=${accessed.slice(0, 8)} reason=expired-on-access `,
    );
    expect(lines("close ")[1]).toContain("age=62m");
  });

  it("logs a census of open sessions at shutdown", async () => {
    await open();
    await open({ name: "codex-mcp-client", version: "0.9" });

    controller.onModuleDestroy();

    const [line] = lines("shutdown: ");
    expect(line).toContain("closing 2 session(s)");
    expect(line).toContain("claude-code/2.1.0");
    expect(line).toContain("codex-mcp-client/0.9");
    expect(lines("close ")).toHaveLength(0);
  });
});
