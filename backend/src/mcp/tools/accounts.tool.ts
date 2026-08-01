import { Injectable } from "@nestjs/common";
import { z } from "zod";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { AccountsService } from "../../accounts/accounts.service";
import { AccountType } from "../../accounts/entities/account.entity";
import {
  UserContextResolver,
  requireScope,
  toolResult,
  toolError,
  safeToolError,
} from "../mcp-context";
import { listAccountsOutput } from "../tool-output-schemas";
import { READ_ONLY } from "../mcp-annotations";

@Injectable()
export class McpAccountsTools {
  constructor(private readonly accountsService: AccountsService) {}

  register(server: McpServer, resolve: UserContextResolver) {
    server.registerTool(
      "list_accounts",
      {
        title: "List accounts",
        annotations: READ_ONLY,
        description:
          "List the user's accounts with full details and an overall summary. " +
          "Returns, for each account, its id, name, type, sub-type, balance " +
          "(brokerage accounts show market value; every other account shows " +
          "currentBalance + future transactions), raw currentBalance, credit " +
          "limit, interest rate, currency, closed status, exclude-from-net-worth " +
          "flag, institution name, and account number. Loan and mortgage " +
          "accounts additionally include their payment amount, payment " +
          "frequency, payment start date, amortization months, and original " +
          "principal (null on other account types) so a loan's schedule can be " +
          "reasoned about. Also returns a summary: " +
          "total assets, total liabilities, net worth (all matching the dashboard " +
          "Net Worth widget), and totalAccounts (the count AFTER filtering). " +
          "Filter with accountTypes, status (open/closed/all, default open), " +
          "accountNames (exact, case-insensitive), accountIds (UUIDs), or " +
          "nameQuery (case-insensitive substring on the name). Use this for any " +
          "question about which accounts the user has or how much money is in " +
          "them. This single tool replaces the former get_accounts, " +
          "get_account_balance, and get_account_balances tools.",
        inputSchema: {
          accountNames: z
            .array(z.string().max(100))
            .max(100)
            .optional()
            .describe(
              "Optional: filter to specific account names (exact, case-insensitive). Omit to cover all accounts.",
            ),
          accountIds: z
            .array(z.string().uuid())
            .optional()
            .describe("Optional: filter to specific account IDs (UUIDs)."),
          nameQuery: z
            .string()
            .max(100)
            .optional()
            .describe(
              "Optional: case-insensitive substring match on the account name.",
            ),
          status: z
            .enum(["open", "closed", "all"])
            .optional()
            .describe(
              "Which accounts to include by status. Defaults to 'open'.",
            ),
          accountTypes: z
            .array(z.nativeEnum(AccountType))
            .max(10)
            .optional()
            .describe(
              "Optional: filter to specific account types (CHEQUING, SAVINGS, CREDIT_CARD, LOAN, MORTGAGE, INVESTMENT, CASH, LINE_OF_CREDIT, ASSET, OTHER). Omit to include all types.",
            ),
        },
        outputSchema: listAccountsOutput,
      },
      async (args, extra) => {
        const ctx = resolve(extra.sessionId);
        if (!ctx) return toolError("No user context");
        const check = requireScope(ctx.scopes, "read");
        if (check.error) return check.result;

        try {
          // Service owns the "open" default so it stays in one place.
          const data = await this.accountsService.getLlmAccounts(ctx.userId, {
            accountNames: args.accountNames,
            accountIds: args.accountIds,
            nameQuery: args.nameQuery,
            status: args.status,
            accountTypes: args.accountTypes,
          });
          return toolResult(data);
        } catch (err: unknown) {
          return safeToolError(err);
        }
      },
    );
  }
}
