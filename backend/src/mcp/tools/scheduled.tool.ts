import { Injectable } from "@nestjs/common";
import { z } from "zod";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { ScheduledTransactionsService } from "../../scheduled-transactions/scheduled-transactions.service";
import {
  UserContextResolver,
  requireScope,
  toolResult,
  toolError,
  safeToolError,
} from "../mcp-context";
import { getUpcomingBillsOutput } from "../tool-output-schemas";
import { READ_ONLY } from "../mcp-annotations";

const SCHEDULED_KIND_VALUES = [
  "bill",
  "deposit",
  "transfer",
  "investment",
  "all",
] as const;

@Injectable()
export class McpScheduledTools {
  constructor(
    private readonly scheduledService: ScheduledTransactionsService,
  ) {}

  register(server: McpServer, resolve: UserContextResolver) {
    server.registerTool(
      "list_upcoming_bills",
      {
        title: "Upcoming bills and deposits",
        annotations: READ_ONLY,
        description:
          "Get upcoming scheduled bills and deposits due within a date window. Each item is classified as bill / deposit / transfer / investment and includes a daysUntilDue value (negative when overdue). Returns the same shape as the AI Assistant's list_upcoming_bills tool.",
        inputSchema: {
          days: z
            .number()
            .min(1)
            .max(365)
            .optional()
            .default(30)
            .describe("Number of days to look ahead (default 30)"),
          kind: z
            .enum(SCHEDULED_KIND_VALUES)
            .optional()
            .describe(
              "Narrow to a single kind: 'bill', 'deposit', 'transfer', 'investment'. Omit or pass 'all' for everything.",
            ),
          accountIds: z
            .array(z.string().uuid())
            .max(50)
            .optional()
            .describe("Optional account IDs to filter to."),
        },
        outputSchema: getUpcomingBillsOutput,
      },
      async (args, extra) => {
        const ctx = resolve(extra.sessionId);
        if (!ctx) return toolError("No user context");
        const check = requireScope(ctx.scopes, "read");
        if (check.error) return check.result;

        try {
          const upcoming =
            await this.scheduledService.getLlmUpcomingBillsAndDeposits(
              ctx.userId,
              {
                days: args.days ?? 30,
                kind: args.kind,
                accountIds: args.accountIds,
              },
            );
          return toolResult(upcoming);
        } catch (err: unknown) {
          return safeToolError(err);
        }
      },
    );
  }
}
