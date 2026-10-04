import {
  Controller,
  Post,
  Get,
  Delete,
  Req,
  Res,
  OnModuleDestroy,
  Logger,
} from "@nestjs/common";
import { ApiTags, ApiExcludeController } from "@nestjs/swagger";
import { Throttle } from "@nestjs/throttler";
import { Request, Response } from "express";
import { createHash, randomUUID } from "crypto";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { SkipCsrf } from "../common/decorators/skip-csrf.decorator";
import { SetMetadata } from "@nestjs/common";
import { SKIP_PASSWORD_CHECK_KEY } from "../auth/guards/must-change-password.guard";
import { McpServerService } from "./mcp-server.service";
import { PatService } from "../auth/pat.service";
import { McpUserContext } from "./mcp-context";
import { OAuthProviderService } from "../oauth/oauth-provider.service";
import { ConfigService } from "@nestjs/config";

const SkipPasswordCheck = () => SetMetadata(SKIP_PASSWORD_CHECK_KEY, true);

/**
 * Who holds a session, for the session log. Everything here is either
 * client-supplied (sanitized before logging) or a one-way fingerprint.
 */
interface SessionMeta {
  client: string; // clientInfo name/version from `initialize`, or "?"
  userAgent: string;
  tokenFp: string; // "pat:" / "oauth:" + first 8 hex of sha256(token)
  lastUsedAt: number;
  requests: number;
  inFlight: number; // responses still open on this session, SSE streams included
  closeReason?: CloseReason; // set when the close is ours to name, before it happens
}

type CloseReason =
  | "delete"
  | "transport-close"
  | "evicted"
  | "expired"
  | "expired-on-access";

/** Strip control characters and cap length: these strings are client-supplied. */
function forLog(value: unknown, max = 80): string {
  if (typeof value !== "string" || value === "") return "?";
  // eslint-disable-next-line no-control-regex
  const clean = value.replace(/[\x00-\x1f\x7f"]/g, "");
  return clean.length > max ? `${clean.slice(0, max)}...` : clean;
}

function minutes(ms: number): string {
  return `${Math.round(ms / 60_000)}m`;
}

@ApiExcludeController()
@ApiTags("MCP")
@SkipCsrf()
@SkipPasswordCheck()
@Controller("mcp")
export class McpHttpController implements OnModuleDestroy {
  private static readonly SESSION_TTL_MS = 3_600_000; // 1 hour
  private static readonly MAX_SESSIONS_PER_USER = 10;
  private static readonly CLEANUP_INTERVAL_MS = 300_000; // 5 minutes

  private transports = new Map<string, StreamableHTTPServerTransport>();
  private servers = new Map<string, McpServer>();
  private sessionUsers = new Map<string, McpUserContext>();
  private sessionCreatedAt = new Map<string, number>();
  private sessionMeta = new Map<string, SessionMeta>();
  private readonly logger = new Logger("McpSessions");
  private cleanupTimer: ReturnType<typeof setInterval>;

  constructor(
    private readonly mcpServerService: McpServerService,
    private readonly patService: PatService,
    private readonly oauthProviderService: OAuthProviderService,
    private readonly configService: ConfigService,
  ) {
    this.cleanupTimer = setInterval(
      () => this.cleanupExpiredSessions(),
      McpHttpController.CLEANUP_INTERVAL_MS,
    );
  }

  onModuleDestroy() {
    clearInterval(this.cleanupTimer);
    if (this.transports.size > 0) {
      this.logger.log(
        `shutdown: closing ${this.transports.size} session(s) ${this.describeHolders([...this.transports.keys()])}`,
      );
    }
    // Clear before closing: each close() re-enters destroySession via onclose,
    // and the census line above already records these sessions.
    const transports = [...this.transports.values()];
    this.transports.clear();
    this.servers.clear();
    this.sessionUsers.clear();
    this.sessionCreatedAt.clear();
    this.sessionMeta.clear();
    for (const transport of transports) {
      transport.close().catch(() => {});
    }
  }

  private cleanupExpiredSessions() {
    const now = Date.now();
    for (const [sid, createdAt] of this.sessionCreatedAt.entries()) {
      if (now - createdAt > McpHttpController.SESSION_TTL_MS) {
        this.destroySession(sid, "expired");
      }
    }
  }

  private getUserSessionCount(userId: string): number {
    let count = 0;
    for (const ctx of this.sessionUsers.values()) {
      if (ctx.userId === userId) count++;
    }
    return count;
  }

  private isSessionExpired(sessionId: string): boolean {
    const createdAt = this.sessionCreatedAt.get(sessionId);
    if (!createdAt) return true;
    return Date.now() - createdAt > McpHttpController.SESSION_TTL_MS;
  }

  @Post()
  @Throttle({ default: { ttl: 60000, limit: 30 } })
  async handlePost(@Req() req: Request, @Res() res: Response) {
    const authResult = await this.validatePat(req);
    if (!authResult) {
      this.sendUnauthorized(res);
      return;
    }

    const sessionId = req.headers["mcp-session-id"] as string | undefined;

    if (sessionId) {
      const transport = this.transports.get(sessionId);
      if (!transport) {
        res.status(404).json({
          jsonrpc: "2.0",
          error: { code: -32004, message: "Session not found" },
          id: null,
        });
        return;
      }
      if (this.isSessionExpired(sessionId)) {
        this.destroySession(sessionId, "expired-on-access");
        res.status(404).json({
          jsonrpc: "2.0",
          error: { code: -32004, message: "Session expired" },
          id: null,
        });
        return;
      }
      const sessionUser = this.sessionUsers.get(sessionId);
      if (sessionUser?.userId !== authResult.userId) {
        res.status(403).json({
          jsonrpc: "2.0",
          error: { code: -32003, message: "Session user mismatch" },
          id: null,
        });
        return;
      }
      this.touchSession(sessionId, res);
      await transport.handleRequest(req, res, req.body);
      return;
    }

    const meta = this.describeNewClient(req);

    // Enforce per-user session limit. A full pool evicts its stalest idle
    // session rather than refusing: clients that re-initialize without a
    // DELETE (T-1034: Claude desktop every 18 min) otherwise fill the pool
    // with abandoned sessions, and a refused client may never retry. An
    // evicted client that is still alive gets 404 and re-initializes.
    if (
      this.getUserSessionCount(authResult.userId) >=
      McpHttpController.MAX_SESSIONS_PER_USER
    ) {
      this.evictStalestIdle(authResult.userId, meta);
    }
    if (
      this.getUserSessionCount(authResult.userId) >=
      McpHttpController.MAX_SESSIONS_PER_USER
    ) {
      const held = this.userSessionIds(authResult.userId);
      this.logger.warn(
        `refused 429 ${this.describeMeta(meta)} held=${held.length}/${McpHttpController.MAX_SESSIONS_PER_USER} ${this.describeHolders(held)}`,
      );
      res.status(429).json({
        jsonrpc: "2.0",
        error: {
          code: -32005,
          message: "Too many active sessions. Close existing sessions first.",
        },
        id: null,
      });
      return;
    }

    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: () => randomUUID(),
    });

    transport.onclose = () => {
      const sid = transport.sessionId;
      if (sid) {
        this.destroySession(sid, "transport-close");
      }
    };

    const resolve = (sessionId?: string) => {
      if (!sessionId) return undefined;
      return this.sessionUsers.get(sessionId);
    };
    const server = this.mcpServerService.createServer(resolve);
    await server.connect(transport);
    await transport.handleRequest(req, res, req.body);

    if (transport.sessionId) {
      this.transports.set(transport.sessionId, transport);
      this.servers.set(transport.sessionId, server);
      this.sessionUsers.set(transport.sessionId, {
        userId: authResult.userId,
        scopes: authResult.scopes,
      });
      this.sessionCreatedAt.set(transport.sessionId, Date.now());
      this.sessionMeta.set(transport.sessionId, meta);
      this.logger.log(
        `open sid=${transport.sessionId.slice(0, 8)} ${this.describeMeta(meta)} held=${this.getUserSessionCount(authResult.userId)}/${McpHttpController.MAX_SESSIONS_PER_USER}`,
      );
    }
  }

  @Get()
  @Throttle({ default: { ttl: 60000, limit: 30 } })
  async handleGet(@Req() req: Request, @Res() res: Response) {
    const authResult = await this.validatePat(req);
    if (!authResult) {
      this.sendUnauthorized(res);
      return;
    }

    const sessionId = req.headers["mcp-session-id"] as string | undefined;
    if (!sessionId) {
      res.status(400).json({
        jsonrpc: "2.0",
        error: { code: -32000, message: "Session ID required" },
        id: null,
      });
      return;
    }

    const transport = this.transports.get(sessionId);
    if (!transport) {
      res.status(404).json({
        jsonrpc: "2.0",
        error: { code: -32004, message: "Session not found" },
        id: null,
      });
      return;
    }

    if (this.isSessionExpired(sessionId)) {
      this.destroySession(sessionId, "expired-on-access");
      res.status(404).json({
        jsonrpc: "2.0",
        error: { code: -32004, message: "Session expired" },
        id: null,
      });
      return;
    }

    const sessionUser = this.sessionUsers.get(sessionId);
    if (sessionUser?.userId !== authResult.userId) {
      res.status(403).json({
        jsonrpc: "2.0",
        error: { code: -32003, message: "Session user mismatch" },
        id: null,
      });
      return;
    }

    this.touchSession(sessionId, res);
    await transport.handleRequest(req, res);
  }

  @Delete()
  @Throttle({ default: { ttl: 60000, limit: 30 } })
  async handleDelete(@Req() req: Request, @Res() res: Response) {
    const authResult = await this.validatePat(req);
    if (!authResult) {
      this.sendUnauthorized(res);
      return;
    }

    const sessionId = req.headers["mcp-session-id"] as string | undefined;
    if (!sessionId) {
      res.status(400).json({
        jsonrpc: "2.0",
        error: { code: -32000, message: "Session ID required" },
        id: null,
      });
      return;
    }

    const transport = this.transports.get(sessionId);
    if (!transport) {
      res.status(404).json({
        jsonrpc: "2.0",
        error: { code: -32004, message: "Session not found" },
        id: null,
      });
      return;
    }

    if (this.isSessionExpired(sessionId)) {
      this.destroySession(sessionId, "expired-on-access");
      res.status(404).json({
        jsonrpc: "2.0",
        error: { code: -32004, message: "Session expired" },
        id: null,
      });
      return;
    }

    const sessionUser = this.sessionUsers.get(sessionId);
    if (sessionUser?.userId !== authResult.userId) {
      res.status(403).json({
        jsonrpc: "2.0",
        error: { code: -32003, message: "Session user mismatch" },
        id: null,
      });
      return;
    }

    // The transport closes itself on DELETE and re-enters via onclose first,
    // so name the reason before handing the request over.
    const meta = this.sessionMeta.get(sessionId);
    if (meta) meta.closeReason = "delete";
    await transport.handleRequest(req, res);
    this.destroySession(sessionId, "delete");
  }

  private destroySession(sessionId: string, reason: CloseReason) {
    const transport = this.transports.get(sessionId);
    // Log only a session we still hold: our own close() re-enters via onclose.
    if (transport) this.logClose(sessionId, reason);
    // Delete from maps BEFORE calling close() to prevent re-entrant loop:
    // close() fires transport.onclose → destroySession() → close() → stack overflow
    this.transports.delete(sessionId);
    this.servers.delete(sessionId);
    this.sessionUsers.delete(sessionId);
    this.sessionCreatedAt.delete(sessionId);
    this.sessionMeta.delete(sessionId);
    if (transport) transport.close().catch(() => {});
  }

  // ── Session log (T-1034: who fills the per-user cap?) ─────────────

  private describeNewClient(req: Request): SessionMeta {
    const body = req.body as
      | {
          method?: string;
          params?: { clientInfo?: { name?: unknown; version?: unknown } };
        }
      | undefined;
    const info =
      body?.method === "initialize" ? body.params?.clientInfo : undefined;
    const client = info
      ? `${forLog(info.name, 40)}/${forLog(info.version, 20)}`
      : "?";
    const token = req.headers.authorization?.substring(7) ?? "";
    const kind = token.startsWith("pat_") ? "pat" : "oauth";
    const fp = createHash("sha256").update(token).digest("hex").slice(0, 8);
    return {
      client,
      userAgent: forLog(req.headers["user-agent"]),
      tokenFp: `${kind}:${fp}`,
      lastUsedAt: Date.now(),
      requests: 1,
      inFlight: 0,
    };
  }

  private describeMeta(meta: SessionMeta): string {
    return `client=${meta.client} ua="${meta.userAgent}" auth=${meta.tokenFp}`;
  }

  /**
   * Count a request against its session until its response closes. An SSE
   * stream stays in flight for as long as it is open, so a session a client
   * is listening on is never the one evicted.
   */
  private touchSession(sessionId: string, res: Response) {
    const meta = this.sessionMeta.get(sessionId);
    if (!meta) return;
    meta.lastUsedAt = Date.now();
    meta.requests++;
    meta.inFlight++;
    res.once("close", () => {
      meta.inFlight--;
      meta.lastUsedAt = Date.now();
    });
  }

  /** Free one slot for `newcomer` by closing the user's stalest idle session. */
  private evictStalestIdle(userId: string, newcomer: SessionMeta) {
    let victim: string | undefined;
    let victimLastUsed = Infinity;
    for (const sid of this.userSessionIds(userId)) {
      const meta = this.sessionMeta.get(sid);
      if (meta && meta.inFlight > 0) continue;
      const lastUsed = meta?.lastUsedAt ?? 0;
      if (lastUsed < victimLastUsed) {
        victim = sid;
        victimLastUsed = lastUsed;
      }
    }
    if (!victim) return;
    this.logger.warn(
      `evict to admit ${this.describeMeta(newcomer)} held=${this.getUserSessionCount(userId)}/${McpHttpController.MAX_SESSIONS_PER_USER} ${this.describeHolders([victim])}`,
    );
    this.destroySession(victim, "evicted");
  }

  private userSessionIds(userId: string): string[] {
    const ids: string[] = [];
    for (const [sid, ctx] of this.sessionUsers.entries()) {
      if (ctx.userId === userId) ids.push(sid);
    }
    return ids;
  }

  private describeHolders(sessionIds: string[]): string {
    const now = Date.now();
    const parts = sessionIds.map((sid) => {
      const meta = this.sessionMeta.get(sid);
      const createdAt = this.sessionCreatedAt.get(sid) ?? now;
      const idle = meta ? minutes(now - meta.lastUsedAt) : "?";
      return `${sid.slice(0, 8)} ${meta?.client ?? "?"} age=${minutes(now - createdAt)} idle=${idle} req=${meta?.requests ?? "?"}`;
    });
    return `holders=[${parts.join("; ")}]`;
  }

  private logClose(sessionId: string, reason: CloseReason) {
    const now = Date.now();
    const meta = this.sessionMeta.get(sessionId);
    const createdAt = this.sessionCreatedAt.get(sessionId) ?? now;
    const userId = this.sessionUsers.get(sessionId)?.userId;
    // Called before the maps are cleared, so the count still includes this one.
    const remaining = userId ? this.getUserSessionCount(userId) - 1 : "?";
    this.logger.log(
      `close sid=${sessionId.slice(0, 8)} reason=${meta?.closeReason ?? reason} client=${meta?.client ?? "?"} age=${minutes(now - createdAt)} idle=${meta ? minutes(now - meta.lastUsedAt) : "?"} req=${meta?.requests ?? "?"} held=${remaining}/${McpHttpController.MAX_SESSIONS_PER_USER}`,
    );
  }

  private async validatePat(req: Request): Promise<McpUserContext | null> {
    const auth = req.headers.authorization;
    if (!auth || !auth.startsWith("Bearer ")) {
      return null;
    }
    const token = auth.substring(7);

    // PAT bearer tokens (legacy / advanced users)
    if (token.startsWith("pat_")) {
      try {
        const result = await this.patService.validateToken(token);
        return { userId: result.userId, scopes: result.scopes };
      } catch {
        return null;
      }
    }

    // OAuth 2.1 access tokens (issued via /oauth for MCP clients like
    // Claude Desktop's "Add Connector" flow). Audience-bound to the MCP
    // resource URL by the provider's resourceIndicators config.
    const oauthResult =
      await this.oauthProviderService.validateAccessToken(token);
    if (oauthResult) {
      return { userId: oauthResult.userId, scopes: oauthResult.scopes };
    }

    return null;
  }

  private sendUnauthorized(res: Response): void {
    const publicUrl =
      this.configService.get<string>("PUBLIC_APP_URL")?.replace(/\/$/, "") ??
      "";
    const resourceMetadata = `${publicUrl}/.well-known/oauth-protected-resource`;
    res.setHeader(
      "WWW-Authenticate",
      `Bearer realm="monize", resource_metadata="${resourceMetadata}"`,
    );
    res.status(401).json({
      jsonrpc: "2.0",
      error: { code: -32001, message: "Unauthorized" },
      id: null,
    });
  }
}
