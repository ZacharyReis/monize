jest.mock("../../built-in-reports/built-in-reports.service", () => ({
  BuiltInReportsService: class BuiltInReportsService {},
}));

import { McpManorCompatTools } from "./manor-compat.tool";
import { UserContextResolver } from "../mcp-context";

describe("McpManorCompatTools", () => {
  let tool: McpManorCompatTools;
  let accountsService: Record<string, jest.Mock>;
  let reportsService: Record<string, jest.Mock>;
  let categoriesService: Record<string, jest.Mock>;
  let payeesService: Record<string, jest.Mock>;
  let scheduledService: Record<string, jest.Mock>;
  let netWorthService: Record<string, jest.Mock>;
  let transactionsService: Record<string, jest.Mock>;
  let holdingsService: Record<string, jest.Mock>;
  let relayService: { emitPendingAction: jest.Mock };
  let actionBuilder: Record<string, jest.Mock>;
  let writeLimiter: Record<string, jest.Mock>;
  let server: {
    registerTool: jest.Mock;
    server: { getClientCapabilities: jest.Mock; elicitInput: jest.Mock };
  };
  let resolve: jest.MockedFunction<UserContextResolver>;
  const handlers: Record<string, (...args: any[]) => any> = {};

  const account = {
    id: "11111111-1111-1111-1111-111111111111",
    name: "TD Checking",
    type: "CHEQUING",
    subType: null,
    balance: 125.5,
    currentBalance: 120,
    creditLimit: null,
    interestRate: null,
    currency: "USD",
    isClosed: false,
    excludeFromNetWorth: false,
    institutionName: "TD Bank",
    accountNumber: null,
  };

  beforeEach(() => {
    Object.keys(handlers).forEach((name) => delete handlers[name]);

    accountsService = {
      getLlmAccounts: jest.fn().mockResolvedValue({
        accounts: [account],
        totalAssets: 500,
        totalLiabilities: 100,
        netWorth: 400,
        totalAccounts: 1,
      }),
      getSummary: jest.fn().mockResolvedValue({
        totalAccounts: 1,
        totalBalance: 120,
        totalAssets: 500,
        totalLiabilities: 100,
        netWorth: 400,
      }),
    };
    reportsService = {
      getSpendingAnomalies: jest.fn().mockResolvedValue({
        anomalies: [{ payeeName: "Store", description: "Large purchase" }],
      }),
      getMonthlyComparison: jest.fn().mockResolvedValue({
        currentMonth: "2026-05",
        previousMonth: "2026-04",
      }),
    };
    categoriesService = {
      getLlmCategories: jest.fn().mockResolvedValue({
        categories: [{ id: "cat-1", name: "Groceries" }],
        totalCount: 1,
      }),
    };
    payeesService = {
      search: jest.fn().mockResolvedValue([{ id: "p1", name: "Amazon" }]),
      findAll: jest.fn().mockResolvedValue([{ id: "p2", name: "Shellpoint" }]),
    };
    scheduledService = {
      getLlmUpcomingBillsAndDeposits: jest.fn().mockResolvedValue({
        daysWindow: 7,
        itemCount: 1,
        overdueCount: 0,
        totalUpcomingBills: 42,
        totalUpcomingDeposits: 0,
        items: [
          {
            id: "s1",
            name: "Power",
            accountId: account.id,
            accountName: "TD Checking",
            payeeName: "Utility",
            categoryName: "Bills",
            amount: -42,
            currency: "USD",
            frequency: "MONTHLY",
            nextDueDate: "2026-07-01",
            daysUntilDue: 4,
            isActive: true,
            autoPost: false,
            kind: "bill",
            description: null,
          },
        ],
      }),
      findAll: jest.fn().mockResolvedValue([{ id: "s1", name: "Power" }]),
    };
    netWorthService = {
      getLlmHistory: jest.fn().mockResolvedValue([
        {
          month: "2026-06",
          assets: 500,
          liabilities: 100,
          netWorth: 400,
        },
      ]),
    };
    transactionsService = {
      getLlmTransactionRows: jest.fn().mockResolvedValue({
        transactions: [{ id: "t1", amount: -12 }],
        total: 1,
        hasMore: false,
      }),
      previewCategorize: jest.fn().mockResolvedValue({
        transactionId: "22222222-2222-2222-2222-222222222222",
        payeeName: "Store",
        amount: -12,
        transactionDate: "2026-06-01",
        accountName: "TD Checking",
        currentCategoryName: null,
        categoryId: "33333333-3333-3333-3333-333333333333",
        newCategoryName: "Groceries",
      }),
      update: jest.fn().mockResolvedValue({
        id: "22222222-2222-2222-2222-222222222222",
        categoryId: "33333333-3333-3333-3333-333333333333",
      }),
    };
    holdingsService = {
      findAll: jest.fn().mockResolvedValue([{ id: "h1", quantity: 5 }]),
    };
    relayService = { emitPendingAction: jest.fn().mockReturnValue(false) };
    actionBuilder = {
      buildCategorizeTransaction: jest
        .fn()
        .mockReturnValue({ type: "categorize_transaction", preview: {} }),
    };
    writeLimiter = {
      reserve: jest.fn().mockReturnValue(undefined),
      record: jest.fn(),
    };

    tool = new McpManorCompatTools(
      accountsService as any,
      reportsService as any,
      categoriesService as any,
      payeesService as any,
      scheduledService as any,
      netWorthService as any,
      transactionsService as any,
      holdingsService as any,
      relayService as any,
      actionBuilder as any,
      writeLimiter as any,
    );

    server = {
      registerTool: jest.fn((name, _opts, handler) => {
        handlers[name] = handler;
      }),
      server: {
        getClientCapabilities: jest.fn().mockReturnValue({}),
        elicitInput: jest.fn(),
      },
    };
    resolve = jest.fn();
    tool.register(server as any, resolve);
  });

  it("registers the 14 Manor legacy tools", () => {
    expect(server.registerTool).toHaveBeenCalledTimes(14);
    expect(Object.keys(handlers).sort()).toEqual(
      [
        "categorize_transaction",
        "get_account_balance",
        "get_account_summary",
        "get_accounts",
        "get_anomalies",
        "get_categories",
        "get_holding_details",
        "get_net_worth",
        "get_net_worth_history",
        "get_payees",
        "get_scheduled_transactions",
        "get_upcoming_bills",
        "monthly_comparison",
        "search_transactions",
      ].sort(),
    );
    expect(server.registerTool).toHaveBeenCalledWith(
      "categorize_transaction",
      expect.objectContaining({
        annotations: expect.objectContaining({ readOnlyHint: false }),
      }),
      expect.any(Function),
    );
  });

  it("returns an error when no user context is available", async () => {
    resolve.mockReturnValue(undefined);

    const result = await handlers["get_accounts"]({}, { sessionId: "s1" });

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain("No user context");
  });

  it("requires read scope for read-only legacy tools", async () => {
    resolve.mockReturnValue({ userId: "u1", scopes: "write" });

    const result = await handlers["get_accounts"]({}, { sessionId: "s1" });

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain("read");
  });

  it("adapts get_accounts to legacy account fields and structured keys", async () => {
    resolve.mockReturnValue({ userId: "u1", scopes: "read" });

    const result = await handlers["get_accounts"](
      { includeInactive: true },
      { sessionId: "s1" },
    );

    expect(accountsService.getLlmAccounts).toHaveBeenCalledWith("u1", {
      status: "all",
    });
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed[0]).toEqual(
      expect.objectContaining({
        id: account.id,
        accountType: "CHEQUING",
        currentBalance: 120,
        balance: 125.5,
        currencyCode: "USD",
      }),
    );
    expect(result.structuredContent.accounts[0].accountType).toBe("CHEQUING");
    expect(result.structuredContent.data[0].id).toBe(account.id);
  });

  it("adapts get_account_balance to the old single-account balance shape", async () => {
    resolve.mockReturnValue({ userId: "u1", scopes: "read" });

    const result = await handlers["get_account_balance"](
      { accountId: account.id },
      { sessionId: "s1" },
    );

    expect(accountsService.getLlmAccounts).toHaveBeenCalledWith("u1", {
      accountIds: [account.id],
      status: "all",
    });
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed).toEqual(
      expect.objectContaining({
        id: account.id,
        type: "CHEQUING",
        accountType: "CHEQUING",
        currentBalance: 120,
        balance: 125.5,
        currencyCode: "USD",
      }),
    );
  });

  it("adapts get_account_summary from list_accounts totals", async () => {
    resolve.mockReturnValue({ userId: "u1", scopes: "read" });

    const result = await handlers["get_account_summary"](
      {},
      { sessionId: "s1" },
    );

    expect(accountsService.getLlmAccounts).toHaveBeenCalledWith("u1");
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed).toEqual({
      totalAccounts: 1,
      totalBalance: 120,
      totalAssets: 500,
      totalLiabilities: 100,
      netWorth: 400,
    });
  });

  it("adapts get_upcoming_bills to legacy bill fields and Manor structured keys", async () => {
    resolve.mockReturnValue({ userId: "u1", scopes: "read" });

    const result = await handlers["get_upcoming_bills"](
      { days: 7 },
      { sessionId: "s1" },
    );

    expect(
      scheduledService.getLlmUpcomingBillsAndDeposits,
    ).toHaveBeenCalledWith("u1", { days: 7 });
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed[0]).toEqual(
      expect.objectContaining({
        accountId: account.id,
        amount: -42,
        dueDate: "2026-07-01",
        date: "2026-07-01",
        payeeName: "Utility",
        status: "unpaid",
        currencyCode: "USD",
      }),
    );
    expect(result.structuredContent.bills[0].payeeName).toBe("Utility");
    expect(result.structuredContent.transactions[0].accountId).toBe(account.id);
  });

  it("delegates the remaining read-only legacy tools to their current services", async () => {
    resolve.mockReturnValue({ userId: "u1", scopes: "read" });

    await handlers["get_anomalies"]({ months: 2 }, { sessionId: "s1" });
    await handlers["get_categories"](
      { type: "expense", search: "gro" },
      { sessionId: "s1" },
    );
    await handlers["get_payees"]({ search: "ama" }, { sessionId: "s1" });
    await handlers["get_scheduled_transactions"]({}, { sessionId: "s1" });
    await handlers["get_net_worth"]({}, { sessionId: "s1" });
    await handlers["get_net_worth_history"](
      { startDate: "2026-01-01", endDate: "2026-06-30" },
      { sessionId: "s1" },
    );
    await handlers["monthly_comparison"](
      { month: "2026-05" },
      { sessionId: "s1" },
    );
    await handlers["search_transactions"](
      {
        query: "store",
        accountId: account.id,
        categoryId: "33333333-3333-3333-3333-333333333333",
        payeeId: "44444444-4444-4444-4444-444444444444",
        startDate: "2026-06-01",
        endDate: "2026-06-30",
        minAmount: -100,
        maxAmount: -1,
        limit: 25,
      },
      { sessionId: "s1" },
    );
    await handlers["get_holding_details"](
      { accountId: account.id },
      { sessionId: "s1" },
    );

    expect(reportsService.getSpendingAnomalies).toHaveBeenCalledWith("u1", 2);
    expect(categoriesService.getLlmCategories).toHaveBeenCalledWith("u1", {
      type: "expense",
      search: "gro",
    });
    expect(payeesService.search).toHaveBeenCalledWith("u1", "ama", 50);
    expect(scheduledService.findAll).toHaveBeenCalledWith("u1");
    expect(accountsService.getSummary).toHaveBeenCalledWith("u1");
    expect(netWorthService.getLlmHistory).toHaveBeenCalledWith(
      "u1",
      "2026-01-01",
      "2026-06-30",
    );
    expect(reportsService.getMonthlyComparison).toHaveBeenCalledWith(
      "u1",
      "2026-05",
    );
    expect(transactionsService.getLlmTransactionRows).toHaveBeenCalledWith(
      "u1",
      {
        accountId: account.id,
        categoryId: "33333333-3333-3333-3333-333333333333",
        payeeId: "44444444-4444-4444-4444-444444444444",
        startDate: "2026-06-01",
        endDate: "2026-06-30",
        query: "store",
        minAmount: -100,
        maxAmount: -1,
        limit: 25,
      },
    );
    expect(holdingsService.findAll).toHaveBeenCalledWith("u1", account.id);
  });

  it("requires write scope for categorize_transaction", async () => {
    resolve.mockReturnValue({ userId: "u1", scopes: "read" });

    const result = await handlers["categorize_transaction"](
      {
        transactionId: "22222222-2222-2222-2222-222222222222",
        categoryId: "33333333-3333-3333-3333-333333333333",
      },
      { sessionId: "s1" },
    );

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain("write");
    expect(transactionsService.update).not.toHaveBeenCalled();
  });

  it("categorizes through the approval path and returns the legacy success shape", async () => {
    resolve.mockReturnValue({ userId: "u1", scopes: "write" });

    const result = await handlers["categorize_transaction"](
      {
        transactionId: "22222222-2222-2222-2222-222222222222",
        categoryId: "33333333-3333-3333-3333-333333333333",
      },
      { sessionId: "s1", requestId: "r1" },
    );

    expect(transactionsService.previewCategorize).toHaveBeenCalledWith(
      "u1",
      "22222222-2222-2222-2222-222222222222",
      "33333333-3333-3333-3333-333333333333",
    );
    expect(actionBuilder.buildCategorizeTransaction).toHaveBeenCalled();
    expect(relayService.emitPendingAction).toHaveBeenCalled();
    expect(transactionsService.update).toHaveBeenCalledWith(
      "u1",
      "22222222-2222-2222-2222-222222222222",
      { categoryId: "33333333-3333-3333-3333-333333333333" },
    );
    expect(writeLimiter.record).toHaveBeenCalledWith(
      "u1",
      "categorize_transaction",
    );
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed).toEqual({
      id: "22222222-2222-2222-2222-222222222222",
      categoryId: "33333333-3333-3333-3333-333333333333",
      message: "Transaction categorized successfully",
    });
  });

  it("shows a relay preview for categorize_transaction without writing", async () => {
    resolve.mockReturnValue({ userId: "u1", scopes: "write" });
    relayService.emitPendingAction.mockReturnValue(true);

    const result = await handlers["categorize_transaction"](
      {
        transactionId: "22222222-2222-2222-2222-222222222222",
        categoryId: "33333333-3333-3333-3333-333333333333",
      },
      { sessionId: "s1" },
    );

    expect(transactionsService.update).not.toHaveBeenCalled();
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.status).toBe("preview_shown");
  });

  it("returns a safe error when a service throws", async () => {
    resolve.mockReturnValue({ userId: "u1", scopes: "read" });
    accountsService.getLlmAccounts.mockRejectedValue(new Error("db down"));

    const result = await handlers["get_accounts"]({}, { sessionId: "s1" });

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain("An error occurred");
  });
});
