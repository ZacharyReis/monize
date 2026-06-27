import { Injectable } from "@nestjs/common";
import { z } from "zod";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { AccountsService } from "../../accounts/accounts.service";
import { BuiltInReportsService } from "../../built-in-reports/built-in-reports.service";
import { CategoriesService } from "../../categories/categories.service";
import { PayeesService } from "../../payees/payees.service";
import { ScheduledTransactionsService } from "../../scheduled-transactions/scheduled-transactions.service";
import { NetWorthService } from "../../net-worth/net-worth.service";
import { TransactionsService } from "../../transactions/transactions.service";
import { HoldingsService } from "../../securities/holdings.service";
import { AiRelayService } from "../../ai/relay/ai-relay.service";
import { AiActionBuilderService } from "../../ai/actions/ai-action-builder.service";
import {
  UserContextResolver,
  requireScope,
  toolResult,
  toolError,
  safeToolError,
  confirmWrite,
} from "../mcp-context";
import { McpWriteLimiter } from "../mcp-write-limiter";
import { READ_ONLY, WRITE } from "../mcp-annotations";
import { RELAY_PREVIEW_SHOWN } from "../mcp-relay-confirm";
import { getDefaultPreviousMonth } from "../../common/tool-schemas";
import { formatDateYMD } from "../../common/date-utils";
import { sumMoney } from "../../common/round.util";

type LlmAccount = Awaited<
  ReturnType<AccountsService["getLlmAccounts"]>
>["accounts"][number];

type LlmUpcomingItem = Awaited<
  ReturnType<ScheduledTransactionsService["getLlmUpcomingBillsAndDeposits"]>
>["items"][number];

const num = z.number().nullable();
const str = z.string();
const strNull = z.string().nullable();
const bool = z.boolean();
const looseAnyObject = z.object({}).loose();
const looseItems = z.array(looseAnyObject);

const legacyAccountsOutput = {
  accounts: looseItems,
  data: looseItems.optional(),
};

const legacyAccountBalanceOutput = {
  id: str,
  name: str,
  type: str.optional(),
  accountType: str.optional(),
  currentBalance: num.optional(),
  balance: num.optional(),
  creditLimit: num.optional(),
  currencyCode: str.optional(),
  currency: str.optional(),
};

const legacyAccountSummaryOutput = {
  totalAccounts: num,
  totalBalance: num.optional(),
  totalAssets: num,
  totalLiabilities: num,
  netWorth: num,
};

const legacyCategoriesOutput = {
  categories: looseItems,
  totalCount: num,
};

const legacyItemsOutput = {
  items: looseItems,
};

const legacyUpcomingBillsOutput = {
  bills: looseItems,
  transactions: looseItems.optional(),
  items: looseItems.optional(),
};

const legacyTransactionsOutput = {
  transactions: looseItems,
  total: num,
  hasMore: bool,
};

const legacyAnomaliesOutput = {
  statistics: z.unknown().optional(),
  anomalies: looseItems.optional(),
  counts: z.unknown().optional(),
};

const legacyNetWorthHistoryOutput = {
  items: looseItems,
};

const legacyMonthlyComparisonOutput = {
  currentMonth: str.optional(),
  previousMonth: str.optional(),
  currentMonthLabel: str.optional(),
  previousMonthLabel: str.optional(),
  currency: str.optional(),
  incomeExpenses: z.unknown().optional(),
  notes: z.unknown().optional(),
  expenses: z.unknown().optional(),
  topCategories: z.unknown().optional(),
  netWorth: z.unknown().optional(),
  investments: z.unknown().optional(),
};

const legacyCategorizeOutput = {
  id: str.optional(),
  categoryId: strNull.optional(),
  message: str.optional(),
  status: str.optional(),
};

@Injectable()
export class McpManorCompatTools {
  constructor(
    private readonly accountsService: AccountsService,
    private readonly reportsService: BuiltInReportsService,
    private readonly categoriesService: CategoriesService,
    private readonly payeesService: PayeesService,
    private readonly scheduledService: ScheduledTransactionsService,
    private readonly netWorthService: NetWorthService,
    private readonly transactionsService: TransactionsService,
    private readonly holdingsService: HoldingsService,
    private readonly relayService: AiRelayService,
    private readonly actionBuilder: AiActionBuilderService,
    private readonly writeLimiter: McpWriteLimiter,
  ) {}

  register(server: McpServer, resolve: UserContextResolver) {
    server.registerTool(
      "get_accounts",
      {
        title: "List accounts",
        annotations: READ_ONLY,
        description: "List all accounts with balances",
        inputSchema: {
          includeInactive: z
            .boolean()
            .optional()
            .describe("Include closed accounts"),
        },
        outputSchema: legacyAccountsOutput,
      },
      async (args, extra) => {
        const ctx = resolve(extra.sessionId);
        if (!ctx) return toolError("No user context");
        const check = requireScope(ctx.scopes, "read");
        if (check.error) return check.result;

        try {
          const data = await this.accountsService.getLlmAccounts(ctx.userId, {
            status: args.includeInactive ? "all" : "open",
          });
          const accounts = data.accounts.map((account) =>
            this.toLegacyAccount(account),
          );
          return this.legacyArrayResult(accounts, {
            accounts,
            data: accounts,
          });
        } catch (err: unknown) {
          return safeToolError(err);
        }
      },
    );

    server.registerTool(
      "get_account_balance",
      {
        title: "Get account balance",
        annotations: READ_ONLY,
        description: "Get detailed balance for a specific account",
        inputSchema: {
          accountId: z.string().uuid().describe("Account ID"),
        },
        outputSchema: legacyAccountBalanceOutput,
      },
      async (args, extra) => {
        const ctx = resolve(extra.sessionId);
        if (!ctx) return toolError("No user context");
        const check = requireScope(ctx.scopes, "read");
        if (check.error) return check.result;

        try {
          const data = await this.accountsService.getLlmAccounts(ctx.userId, {
            accountIds: [args.accountId],
            status: "all",
          });
          const account = data.accounts[0];
          if (!account) return toolError("Account not found");
          return toolResult(this.toLegacyAccountBalance(account));
        } catch (err: unknown) {
          return safeToolError(err);
        }
      },
    );

    server.registerTool(
      "get_account_summary",
      {
        title: "Account summary",
        annotations: READ_ONLY,
        description:
          "Get total assets, liabilities, and net worth across all accounts",
        inputSchema: {},
        outputSchema: legacyAccountSummaryOutput,
      },
      async (_args, extra) => {
        const ctx = resolve(extra.sessionId);
        if (!ctx) return toolError("No user context");
        const check = requireScope(ctx.scopes, "read");
        if (check.error) return check.result;

        try {
          const data = await this.accountsService.getLlmAccounts(ctx.userId);
          return toolResult(this.toLegacyAccountSummary(data));
        } catch (err: unknown) {
          return safeToolError(err);
        }
      },
    );

    server.registerTool(
      "get_anomalies",
      {
        title: "Spending anomalies",
        annotations: READ_ONLY,
        description: "Find unusual transactions or spending patterns",
        inputSchema: {
          months: z
            .number()
            .min(1)
            .max(24)
            .optional()
            .default(3)
            .describe("Number of months to analyze (default 3)"),
        },
        outputSchema: legacyAnomaliesOutput,
      },
      async (args, extra) => {
        const ctx = resolve(extra.sessionId);
        if (!ctx) return toolError("No user context");
        const check = requireScope(ctx.scopes, "read");
        if (check.error) return check.result;

        try {
          const anomalies = await this.reportsService.getSpendingAnomalies(
            ctx.userId,
            args.months ?? 3,
          );
          return toolResult(anomalies);
        } catch (err: unknown) {
          return safeToolError(err);
        }
      },
    );

    server.registerTool(
      "get_categories",
      {
        title: "List categories",
        annotations: READ_ONLY,
        description:
          "List the user's categories with their hierarchy (parent names) and transaction counts. Optionally filter by type or search by name. Returns the same shape as the AI Assistant's get_categories tool.",
        inputSchema: {
          type: z
            .enum(["expense", "income", "all"])
            .optional()
            .describe(
              "Filter by category type. Defaults to 'all' when omitted.",
            ),
          search: z
            .string()
            .max(100)
            .optional()
            .describe(
              "Optional case-insensitive substring match on category name. Matched subcategories' parents are included so hierarchy stays visible.",
            ),
        },
        outputSchema: legacyCategoriesOutput,
      },
      async (args, extra) => {
        const ctx = resolve(extra.sessionId);
        if (!ctx) return toolError("No user context");
        const check = requireScope(ctx.scopes, "read");
        if (check.error) return check.result;

        try {
          const data = await this.categoriesService.getLlmCategories(
            ctx.userId,
            { type: args.type, search: args.search },
          );
          return toolResult(data);
        } catch (err: unknown) {
          return safeToolError(err);
        }
      },
    );

    server.registerTool(
      "get_payees",
      {
        title: "List payees",
        annotations: READ_ONLY,
        description: "List payees, optionally filtered by search query",
        inputSchema: {
          search: z
            .string()
            .max(200)
            .optional()
            .describe("Search query to filter payees"),
        },
        outputSchema: legacyItemsOutput,
      },
      async (args, extra) => {
        const ctx = resolve(extra.sessionId);
        if (!ctx) return toolError("No user context");
        const check = requireScope(ctx.scopes, "read");
        if (check.error) return check.result;

        try {
          const payees = args.search
            ? await this.payeesService.search(ctx.userId, args.search, 50)
            : await this.payeesService.findAll(ctx.userId);
          return this.legacyArrayResult(payees, { items: payees });
        } catch (err: unknown) {
          return safeToolError(err);
        }
      },
    );

    server.registerTool(
      "get_upcoming_bills",
      {
        title: "Upcoming bills",
        annotations: READ_ONLY,
        description: "Get scheduled transactions due soon",
        inputSchema: {
          days: z
            .number()
            .min(1)
            .max(365)
            .optional()
            .default(30)
            .describe("Number of days to look ahead (default 30)"),
        },
        outputSchema: legacyUpcomingBillsOutput,
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
              { days: args.days ?? 30 },
            );
          const bills = upcoming.items.map((item) =>
            this.toLegacyScheduledItem(item),
          );
          return this.legacyArrayResult(bills, {
            bills,
            transactions: bills,
            items: bills,
          });
        } catch (err: unknown) {
          return safeToolError(err);
        }
      },
    );

    server.registerTool(
      "get_scheduled_transactions",
      {
        title: "Scheduled transactions",
        annotations: READ_ONLY,
        description: "List all scheduled/recurring transactions",
        inputSchema: {},
        outputSchema: {
          transactions: looseItems,
          items: looseItems.optional(),
        },
      },
      async (_args, extra) => {
        const ctx = resolve(extra.sessionId);
        if (!ctx) return toolError("No user context");
        const check = requireScope(ctx.scopes, "read");
        if (check.error) return check.result;

        try {
          const scheduled = await this.scheduledService.findAll(ctx.userId);
          return this.legacyArrayResult(scheduled, {
            transactions: scheduled,
            items: scheduled,
          });
        } catch (err: unknown) {
          return safeToolError(err);
        }
      },
    );

    server.registerTool(
      "get_net_worth",
      {
        title: "Net worth",
        annotations: READ_ONLY,
        description: "Get current net worth breakdown by account",
        inputSchema: {},
        outputSchema: legacyAccountSummaryOutput,
      },
      async (_args, extra) => {
        const ctx = resolve(extra.sessionId);
        if (!ctx) return toolError("No user context");
        const check = requireScope(ctx.scopes, "read");
        if (check.error) return check.result;

        try {
          const summary = await this.accountsService.getSummary(ctx.userId);
          return toolResult(summary);
        } catch (err: unknown) {
          return safeToolError(err);
        }
      },
    );

    server.registerTool(
      "get_net_worth_history",
      {
        title: "Net worth history",
        annotations: READ_ONLY,
        description:
          "Get net worth over time (monthly snapshots). Returns the same shape as the AI Assistant's get_net_worth_history tool. Default range is the last 12 months when both dates are omitted.",
        inputSchema: {
          startDate: z
            .string()
            .max(10)
            .optional()
            .describe("Start date (YYYY-MM-DD). Defaults to 12 months ago."),
          endDate: z
            .string()
            .max(10)
            .optional()
            .describe("End date (YYYY-MM-DD). Defaults to today."),
          months: z
            .number()
            .min(1)
            .max(120)
            .optional()
            .describe(
              "Number of months of history. Only applied when startDate/endDate are omitted.",
            ),
        },
        outputSchema: legacyNetWorthHistoryOutput,
      },
      async (args, extra) => {
        const ctx = resolve(extra.sessionId);
        if (!ctx) return toolError("No user context");
        const check = requireScope(ctx.scopes, "read");
        if (check.error) return check.result;

        try {
          let startDate = args.startDate;
          let endDate = args.endDate;
          if (!startDate && !endDate && args.months) {
            const end = new Date();
            const start = new Date();
            start.setMonth(start.getMonth() - args.months);
            startDate = formatDateYMD(start);
            endDate = formatDateYMD(end);
          }

          const history = await this.netWorthService.getLlmHistory(
            ctx.userId,
            startDate,
            endDate,
          );
          return this.legacyArrayResult(history, { items: history });
        } catch (err: unknown) {
          return safeToolError(err);
        }
      },
    );

    server.registerTool(
      "monthly_comparison",
      {
        title: "Monthly comparison",
        annotations: READ_ONLY,
        description:
          "Generate a monthly comparison report comparing one month to the previous month. Includes income vs expenses, category spending breakdown, net worth, and investment performance.",
        inputSchema: {
          month: z
            .string()
            .max(7)
            .optional()
            .describe(
              "Month to compare in YYYY-MM format (e.g., 2026-01). Defaults to the previous complete month.",
            ),
        },
        outputSchema: legacyMonthlyComparisonOutput,
      },
      async (args, extra) => {
        const ctx = resolve(extra.sessionId);
        if (!ctx) return toolError("No user context");
        const check = requireScope(ctx.scopes, "read");
        if (check.error) return check.result;

        try {
          const data = await this.reportsService.getMonthlyComparison(
            ctx.userId,
            args.month ?? getDefaultPreviousMonth(),
          );
          return toolResult(data);
        } catch (err: unknown) {
          return safeToolError(err);
        }
      },
    );

    server.registerTool(
      "search_transactions",
      {
        title: "Search transactions",
        annotations: READ_ONLY,
        description: "Search and filter transactions",
        inputSchema: {
          query: z.string().max(200).optional().describe("Search text"),
          accountId: z
            .string()
            .uuid()
            .optional()
            .describe("Filter by account ID"),
          categoryId: z
            .string()
            .uuid()
            .optional()
            .describe("Filter by category ID"),
          payeeId: z.string().uuid().optional().describe("Filter by payee ID"),
          startDate: z
            .string()
            .max(10)
            .optional()
            .describe("Start date (YYYY-MM-DD)"),
          endDate: z
            .string()
            .max(10)
            .optional()
            .describe("End date (YYYY-MM-DD)"),
          minAmount: z
            .number()
            .min(-999999999999)
            .max(999999999999)
            .optional()
            .describe("Minimum amount"),
          maxAmount: z
            .number()
            .min(-999999999999)
            .max(999999999999)
            .optional()
            .describe("Maximum amount"),
          limit: z
            .number()
            .min(1)
            .max(100)
            .optional()
            .default(50)
            .describe("Max results (default 50, max 100)"),
        },
        outputSchema: legacyTransactionsOutput,
      },
      async (args, extra) => {
        const ctx = resolve(extra.sessionId);
        if (!ctx) return toolError("No user context");
        const check = requireScope(ctx.scopes, "read");
        if (check.error) return check.result;

        try {
          const rows = await this.transactionsService.getLlmTransactionRows(
            ctx.userId,
            {
              accountId: args.accountId,
              categoryId: args.categoryId,
              payeeId: args.payeeId,
              startDate: args.startDate,
              endDate: args.endDate,
              query: args.query,
              minAmount: args.minAmount,
              maxAmount: args.maxAmount,
              limit: args.limit,
            },
          );
          return toolResult(rows);
        } catch (err: unknown) {
          return safeToolError(err);
        }
      },
    );

    server.registerTool(
      "get_holding_details",
      {
        title: "Holding details",
        annotations: READ_ONLY,
        description: "Get details for holdings in a specific account",
        inputSchema: {
          accountId: z
            .string()
            .uuid()
            .optional()
            .describe("Account ID to filter holdings"),
        },
        outputSchema: legacyItemsOutput,
      },
      async (args, extra) => {
        const ctx = resolve(extra.sessionId);
        if (!ctx) return toolError("No user context");
        const check = requireScope(ctx.scopes, "read");
        if (check.error) return check.result;

        try {
          const holdings = await this.holdingsService.findAll(
            ctx.userId,
            args.accountId,
          );
          return this.legacyArrayResult(holdings, { items: holdings });
        } catch (err: unknown) {
          return safeToolError(err);
        }
      },
    );

    server.registerTool(
      "categorize_transaction",
      {
        title: "Categorize transaction",
        annotations: WRITE,
        description: "Assign a category to a transaction",
        inputSchema: {
          transactionId: z.string().uuid().describe("Transaction ID"),
          categoryId: z.string().uuid().describe("Category ID"),
        },
        outputSchema: legacyCategorizeOutput,
      },
      async (args, extra) => {
        const ctx = resolve(extra.sessionId);
        if (!ctx) return toolError("No user context");
        const check = requireScope(ctx.scopes, "write");
        if (check.error) return check.result;

        try {
          const preview = await this.transactionsService.previewCategorize(
            ctx.userId,
            args.transactionId,
            args.categoryId,
          );
          const budget = this.writeLimiter.reserve(ctx.userId, 1);
          if (budget) return budget;

          const action = this.actionBuilder.buildCategorizeTransaction(
            ctx.userId,
            preview,
          );
          if (this.relayService.emitPendingAction(ctx.userId, action)) {
            return toolResult(RELAY_PREVIEW_SHOWN);
          }

          const confirmation = await confirmWrite(
            server,
            `Categorize this transaction as "${preview.newCategoryName}"?\nTransaction: ${preview.payeeName ?? "Unknown"}\nAmount: ${preview.amount}\nDate: ${preview.transactionDate}`,
            extra.requestId as never,
          );
          if (confirmation === "declined") {
            return toolError(
              "Cancelled: the confirmation was declined, so the transaction was not changed.",
            );
          }

          const transaction = await this.transactionsService.update(
            ctx.userId,
            args.transactionId,
            { categoryId: args.categoryId },
          );
          this.writeLimiter.record(ctx.userId, "categorize_transaction");

          return toolResult({
            id: transaction.id,
            categoryId: transaction.categoryId,
            message: "Transaction categorized successfully",
          });
        } catch (err: unknown) {
          return safeToolError(err);
        }
      },
    );
  }

  private legacyArrayResult(
    data: unknown[],
    structuredContent: Record<string, unknown>,
  ) {
    return { ...toolResult(data), structuredContent };
  }

  private toLegacyAccount(account: LlmAccount) {
    const balance = account.balance;
    const currentBalance = account.currentBalance ?? balance;
    return {
      ...account,
      accountType: account.type,
      accountSubType: account.subType,
      currentBalance,
      balance,
      currencyCode: account.currency,
    };
  }

  private toLegacyAccountBalance(account: LlmAccount) {
    const legacy = this.toLegacyAccount(account);
    return {
      id: legacy.id,
      name: legacy.name,
      type: legacy.accountType,
      accountType: legacy.accountType,
      currentBalance: legacy.currentBalance,
      balance: legacy.balance,
      creditLimit: legacy.creditLimit,
      currencyCode: legacy.currencyCode,
      currency: legacy.currency,
    };
  }

  private toLegacyAccountSummary(
    data: Awaited<ReturnType<AccountsService["getLlmAccounts"]>>,
  ) {
    return {
      totalAccounts: data.totalAccounts,
      totalBalance: sumMoney(
        data.accounts.map((account) =>
          Number(account.currentBalance ?? account.balance ?? 0),
        ),
      ),
      totalAssets: data.totalAssets,
      totalLiabilities: data.totalLiabilities,
      netWorth: data.netWorth,
    };
  }

  private toLegacyScheduledItem(item: LlmUpcomingItem) {
    const status = item.daysUntilDue < 0 ? "overdue" : "unpaid";
    return {
      ...item,
      dueDate: item.nextDueDate,
      date: item.nextDueDate,
      nextDate: item.nextDueDate,
      status,
      currencyCode: item.currency,
    };
  }
}
