/**
 * LLM08-F1: Rate limiter for MCP write operations.
 *
 * Enforces a per-user daily limit on write operations (create, update, categorize)
 * performed through MCP tools to prevent an external AI tool from making
 * excessive modifications to financial data.
 *
 * The mechanism lives in the shared `DailyWriteLimiter` so the AI Assistant's
 * action-confirmation endpoint enforces the same kind of cap.
 */

import { Injectable, Optional } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import {
  DailyWriteLimiter,
  WriteOperation,
  resolveDailyWriteLimit,
} from "../common/daily-write-limiter";
import { toolError } from "./mcp-context";

export type { WriteOperation };

/**
 * Default maximum number of write operations per user per day via MCP. Override
 * at deploy time with the `MCP_DAILY_WRITE_LIMIT` environment variable (a
 * positive integer). The cap exists to bound how much an external AI tool can
 * mutate a user's financial data per day -- a soft guardrail against a
 * misbehaving model or a runaway loop, not a hard security boundary.
 */
export const MCP_DAILY_WRITE_LIMIT = 50;

/**
 * Single per-user daily write cap shared across every MCP write tool. It is an
 * `@Injectable()` singleton (provided once in `mcp.module.ts`) so the cap spans
 * all write domains -- transactions, payees, securities, and investment
 * transactions -- rather than each tool class enforcing its own separate budget.
 *
 * The effective limit comes from the `MCP_DAILY_WRITE_LIMIT` env var when set,
 * otherwise the default above.
 */
@Injectable()
export class McpWriteLimiter extends DailyWriteLimiter {
  constructor(@Optional() configService?: ConfigService) {
    super(
      resolveDailyWriteLimit(
        configService?.get("MCP_DAILY_WRITE_LIMIT"),
        MCP_DAILY_WRITE_LIMIT,
      ),
    );
  }

  /**
   * Reserve `count` writes against the daily cap. Returns a `toolError` result
   * when the reservation would exceed the limit, or `undefined` when allowed.
   * Built on top of `checkLimit` so callers can record the writes afterwards.
   */
  reserve(userId: string, count: number) {
    const limitCheck = this.checkLimit(userId);
    if (limitCheck.currentCount + count > limitCheck.limit) {
      return toolError(
        `Daily write limit reached (${limitCheck.limit} operations per day). Try again tomorrow.`,
      );
    }
    return undefined;
  }
}
