import { McpScheduledTools } from "./scheduled.tool";
import { UserContextResolver } from "../mcp-context";

describe("McpScheduledTools", () => {
  let tool: McpScheduledTools;
  let scheduledService: Record<string, jest.Mock>;
  let server: { registerTool: jest.Mock };
  let resolve: jest.MockedFunction<UserContextResolver>;
  const handlers: Record<string, (...args: any[]) => any> = {};

  beforeEach(() => {
    scheduledService = {
      getLlmUpcomingBillsAndDeposits: jest.fn(),
    };

    tool = new McpScheduledTools(scheduledService as any);

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
  });

  describe("list_upcoming_bills", () => {
    it("returns error when no user context", async () => {
      resolve.mockReturnValue(undefined);
      const result = await handlers["list_upcoming_bills"](
        {},
        { sessionId: "s1" },
      );
      expect(result.isError).toBe(true);
    });

    it("calls the shared LLM helper with default days=30", async () => {
      resolve.mockReturnValue({ userId: "u1", scopes: "read" });
      scheduledService.getLlmUpcomingBillsAndDeposits.mockResolvedValue({
        daysWindow: 30,
        itemCount: 1,
        overdueCount: 0,
        totalUpcomingBills: 1200,
        totalUpcomingDeposits: 0,
        items: [
          {
            id: "s1",
            name: "Rent",
            accountId: "a1",
            accountName: "Checking",
            payeeName: "Landlord",
            categoryName: "Housing",
            amount: -1200,
            currency: "USD",
            frequency: "MONTHLY",
            nextDueDate: "2026-06-15",
            daysUntilDue: 13,
            isActive: true,
            autoPost: false,
            kind: "bill",
            description: null,
          },
        ],
      });

      const result = await handlers["list_upcoming_bills"](
        {},
        { sessionId: "s1" },
      );

      expect(
        scheduledService.getLlmUpcomingBillsAndDeposits,
      ).toHaveBeenCalledWith("u1", {
        days: 30,
        kind: undefined,
        accountIds: undefined,
      });
      const parsed = JSON.parse(result.content[0].text);
      expect(parsed.itemCount).toBe(1);
      expect(parsed.items[0].kind).toBe("bill");
    });

    it("passes through days, kind, and accountIds", async () => {
      resolve.mockReturnValue({ userId: "u1", scopes: "read" });
      scheduledService.getLlmUpcomingBillsAndDeposits.mockResolvedValue({
        daysWindow: 7,
        itemCount: 0,
        overdueCount: 0,
        totalUpcomingBills: 0,
        totalUpcomingDeposits: 0,
        items: [],
      });

      await handlers["list_upcoming_bills"](
        { days: 7, kind: "deposit", accountIds: ["acc-1"] },
        { sessionId: "s1" },
      );
      expect(
        scheduledService.getLlmUpcomingBillsAndDeposits,
      ).toHaveBeenCalledWith("u1", {
        days: 7,
        kind: "deposit",
        accountIds: ["acc-1"],
      });
    });

    it("returns error when service throws", async () => {
      resolve.mockReturnValue({ userId: "u1", scopes: "read" });
      scheduledService.getLlmUpcomingBillsAndDeposits.mockRejectedValue(
        new Error("DB error"),
      );
      const result = await handlers["list_upcoming_bills"](
        {},
        { sessionId: "s1" },
      );
      expect(result.isError).toBe(true);
    });
  });
});
