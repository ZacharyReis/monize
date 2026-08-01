import { McpAccountsTools } from "./accounts.tool";
import { UserContextResolver } from "../mcp-context";

describe("McpAccountsTools", () => {
  let tool: McpAccountsTools;
  let accountsService: Record<string, jest.Mock>;
  let server: { registerTool: jest.Mock };
  let resolve: jest.MockedFunction<UserContextResolver>;
  const handlers: Record<string, (...args: any[]) => any> = {};

  beforeEach(() => {
    accountsService = {
      getLlmAccounts: jest.fn(),
    };

    tool = new McpAccountsTools(accountsService as any);

    server = {
      registerTool: jest.fn((name, _opts, handler) => {
        handlers[name] = handler;
      }),
    };

    resolve = jest.fn();
    tool.register(server as any, resolve);
  });

  it("should register 1 tool", () => {
    expect(server.registerTool).toHaveBeenCalledTimes(1);
    expect(server.registerTool).toHaveBeenCalledWith(
      "list_accounts",
      expect.objectContaining({ title: "List accounts" }),
      expect.any(Function),
    );
  });

  describe("list_accounts", () => {
    it("passes all filter args through to the service", async () => {
      resolve.mockReturnValue({ userId: "u1", scopes: "read" });
      accountsService.getLlmAccounts.mockResolvedValue({
        accounts: [
          {
            id: "a1",
            name: "Checking",
            type: "CHEQUING",
            subType: null,
            balance: 100,
            currentBalance: 100,
            creditLimit: null,
            interestRate: null,
            currency: "USD",
            isClosed: false,
            excludeFromNetWorth: false,
            institutionName: null,
            accountNumber: null,
            paymentAmount: null,
            paymentFrequency: null,
            paymentStartDate: null,
            amortizationMonths: null,
            originalPrincipal: null,
          },
          {
            id: "loan1",
            name: "Car Loan",
            type: "LOAN",
            subType: null,
            balance: -8000,
            currentBalance: -8000,
            creditLimit: null,
            interestRate: 6,
            currency: "USD",
            isClosed: false,
            excludeFromNetWorth: false,
            institutionName: null,
            accountNumber: null,
            paymentAmount: 500,
            paymentFrequency: "MONTHLY",
            paymentStartDate: "2024-02-01",
            amortizationMonths: 60,
            originalPrincipal: 20000,
          },
        ],
        totalAssets: 1000,
        totalLiabilities: 0,
        netWorth: 1000,
        totalAccounts: 1,
      });

      const result = await handlers["list_accounts"](
        {
          accountNames: ["Checking"],
          accountIds: ["11111111-1111-1111-1111-111111111111"],
          nameQuery: "chec",
          status: "all",
          accountTypes: ["CHEQUING", "SAVINGS"],
        },
        { sessionId: "s1" },
      );

      expect(accountsService.getLlmAccounts).toHaveBeenCalledWith("u1", {
        accountNames: ["Checking"],
        accountIds: ["11111111-1111-1111-1111-111111111111"],
        nameQuery: "chec",
        status: "all",
        accountTypes: ["CHEQUING", "SAVINGS"],
      });
      expect(result.isError).toBeUndefined();
      const parsed = JSON.parse(result.content[0].text);
      expect(parsed.netWorth).toBe(1000);
      expect(parsed.accounts[0].id).toBe("a1");
      // Loan schedule fields flow through for debt accounts
      const loan = parsed.accounts.find(
        (a: { id: string }) => a.id === "loan1",
      );
      expect(loan.paymentAmount).toBe(500);
      expect(loan.paymentFrequency).toBe("MONTHLY");
      expect(loan.paymentStartDate).toBe("2024-02-01");
      expect(loan.amortizationMonths).toBe(60);
      expect(loan.originalPrincipal).toBe(20000);
    });

    it("delegates with undefined filters when none provided (service applies 'open' default)", async () => {
      resolve.mockReturnValue({ userId: "u1", scopes: "read" });
      accountsService.getLlmAccounts.mockResolvedValue({
        accounts: [],
        totalAssets: 0,
        totalLiabilities: 0,
        netWorth: 0,
        totalAccounts: 0,
      });

      await handlers["list_accounts"]({}, { sessionId: "s1" });

      expect(accountsService.getLlmAccounts).toHaveBeenCalledWith("u1", {
        accountNames: undefined,
        accountIds: undefined,
        nameQuery: undefined,
        status: undefined,
        accountTypes: undefined,
      });
    });

    it("returns error when no user context", async () => {
      resolve.mockReturnValue(undefined);
      const result = await handlers["list_accounts"]({}, { sessionId: "s1" });
      expect(result.isError).toBe(true);
    });

    it("requires read scope", async () => {
      resolve.mockReturnValue({ userId: "u1", scopes: "write" });
      const result = await handlers["list_accounts"]({}, { sessionId: "s1" });
      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain("read");
    });

    it("returns a safe error when the service throws", async () => {
      resolve.mockReturnValue({ userId: "u1", scopes: "read" });
      accountsService.getLlmAccounts.mockRejectedValue(new Error("DB fail"));

      const result = await handlers["list_accounts"]({}, { sessionId: "s1" });
      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain("An error occurred");
    });
  });
});
