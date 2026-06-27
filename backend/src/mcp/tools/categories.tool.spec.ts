import { McpCategoriesTools } from "./categories.tool";
import { UserContextResolver } from "../mcp-context";

describe("McpCategoriesTools", () => {
  let tool: McpCategoriesTools;
  let categoriesService: Record<string, jest.Mock>;
  let server: { registerTool: jest.Mock };
  let resolve: jest.MockedFunction<UserContextResolver>;
  const handlers: Record<string, (...args: any[]) => any> = {};

  beforeEach(() => {
    categoriesService = {
      getLlmCategories: jest.fn(),
    };

    tool = new McpCategoriesTools(categoriesService as any);

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

  describe("list_categories", () => {
    it("returns error when no user context", async () => {
      resolve.mockReturnValue(undefined);
      const result = await handlers["list_categories"]({}, { sessionId: "s1" });
      expect(result.isError).toBe(true);
    });

    it("delegates to categoriesService.getLlmCategories with no filters", async () => {
      resolve.mockReturnValue({ userId: "u1", scopes: "read" });
      categoriesService.getLlmCategories.mockResolvedValue({
        categories: [
          {
            id: "c1",
            name: "Food",
            parentName: null,
            isIncome: false,
            transactionCount: 0,
          },
        ],
        totalCount: 1,
      });

      const result = await handlers["list_categories"]({}, { sessionId: "s1" });
      expect(categoriesService.getLlmCategories).toHaveBeenCalledWith("u1", {
        type: undefined,
        search: undefined,
      });
      const parsed = JSON.parse(result.content[0].text);
      expect(parsed.totalCount).toBe(1);
      expect(parsed.categories[0].name).toBe("Food");
    });

    it("passes type and search filters through", async () => {
      resolve.mockReturnValue({ userId: "u1", scopes: "read" });
      categoriesService.getLlmCategories.mockResolvedValue({
        categories: [],
        totalCount: 0,
      });

      await handlers["list_categories"](
        { type: "income", search: "salary" },
        { sessionId: "s1" },
      );

      expect(categoriesService.getLlmCategories).toHaveBeenCalledWith("u1", {
        type: "income",
        search: "salary",
      });
    });

    it("handles service errors", async () => {
      resolve.mockReturnValue({ userId: "u1", scopes: "read" });
      categoriesService.getLlmCategories.mockRejectedValue(
        new Error("DB fail"),
      );

      const result = await handlers["list_categories"]({}, { sessionId: "s1" });
      expect(result.isError).toBe(true);
    });

    it("returns error when scope is insufficient", async () => {
      resolve.mockReturnValue({ userId: "u1", scopes: "write_only" } as any);
      const result = await handlers["list_categories"]({}, { sessionId: "s1" });
      expect(result.isError).toBe(true);
    });
  });
});
