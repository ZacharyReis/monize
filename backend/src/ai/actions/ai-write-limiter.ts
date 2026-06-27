import { Injectable, Optional } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import {
  DailyWriteLimiter,
  resolveDailyWriteLimit,
} from "../../common/daily-write-limiter";

/**
 * Default maximum number of AI-Assistant-confirmed write operations per user
 * per day. Mirrors the MCP daily cap so the two LLM write surfaces are bounded
 * the same way. Override at deploy time with the `AI_DAILY_WRITE_LIMIT`
 * environment variable (a positive integer).
 */
export const AI_DAILY_WRITE_LIMIT = 50;

/**
 * Injectable per-user daily write limiter for the AI Assistant action
 * confirmation endpoint. The effective limit comes from the
 * `AI_DAILY_WRITE_LIMIT` env var when set, otherwise the default above.
 */
@Injectable()
export class AiWriteLimiter extends DailyWriteLimiter {
  constructor(@Optional() configService?: ConfigService) {
    super(
      resolveDailyWriteLimit(
        configService?.get("AI_DAILY_WRITE_LIMIT"),
        AI_DAILY_WRITE_LIMIT,
      ),
    );
  }
}
