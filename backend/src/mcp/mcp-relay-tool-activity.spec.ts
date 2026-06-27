import {
  RELAY_CONTROL_TOOLS,
  installRelayToolActivity,
  wrapToolHandlerForRelay,
} from "./mcp-relay-tool-activity";
import type { AiRelayService } from "../ai/relay/ai-relay.service";

describe("wrapToolHandlerForRelay", () => {
  const relay = () =>
    ({ reportToolActivity: jest.fn() }) as unknown as AiRelayService & {
      reportToolActivity: jest.Mock;
    };
  const resolveUser = (() => ({ userId: "u1", scopes: "read" })) as any;

  it("brackets a successful call with start then result (no error)", async () => {
    const relayService = relay();
    const handler = jest.fn().mockResolvedValue({ ok: true });
    const wrapped = wrapToolHandlerForRelay(
      "get_accounts",
      handler,
      resolveUser,
      relayService,
    );

    const result = await wrapped({}, { sessionId: "s1" });

    expect(result).toEqual({ ok: true });
    expect((relayService as any).reportToolActivity.mock.calls).toEqual([
      ["u1", "get_accounts", "start"],
      ["u1", "get_accounts", "result", false],
    ]);
  });

  it("reports isError:true when the tool result is an error", async () => {
    const relayService = relay();
    const wrapped = wrapToolHandlerForRelay(
      "create_transaction",
      jest.fn().mockResolvedValue({ isError: true }),
      resolveUser,
      relayService,
    );

    await wrapped({}, { sessionId: "s1" });

    expect((relayService as any).reportToolActivity).toHaveBeenLastCalledWith(
      "u1",
      "create_transaction",
      "result",
      true,
    );
  });

  it("still reports a result when the handler throws, then rethrows", async () => {
    const relayService = relay();
    const boom = new Error("boom");
    const wrapped = wrapToolHandlerForRelay(
      "get_accounts",
      jest.fn().mockRejectedValue(boom),
      resolveUser,
      relayService,
    );

    await expect(wrapped({}, { sessionId: "s1" })).rejects.toThrow("boom");
    expect((relayService as any).reportToolActivity).toHaveBeenLastCalledWith(
      "u1",
      "get_accounts",
      "result",
      true,
    );
  });

  it("does not report activity when there is no user context", async () => {
    const relayService = relay();
    const wrapped = wrapToolHandlerForRelay(
      "get_accounts",
      jest.fn().mockResolvedValue({}),
      (() => undefined) as any,
      relayService,
    );

    await wrapped({}, {});

    expect((relayService as any).reportToolActivity).not.toHaveBeenCalled();
  });
});

describe("installRelayToolActivity", () => {
  it("wraps data tools but leaves relay control tools untouched", async () => {
    const relayService = {
      reportToolActivity: jest.fn(),
    } as unknown as AiRelayService;
    const registered: Record<string, any> = {};
    const server = {
      registerTool: (name: string, _config: unknown, handler: any) => {
        registered[name] = handler;
      },
    } as any;

    installRelayToolActivity(
      server,
      (() => ({ userId: "u1", scopes: "read" })) as any,
      relayService,
    );

    // Register one data tool and one control tool through the patched method.
    server.registerTool("get_accounts", {}, jest.fn().mockResolvedValue({}));
    server.registerTool(
      "get_next_prompt",
      {},
      jest.fn().mockResolvedValue({ hasPrompt: false }),
    );

    await registered["get_accounts"]({}, { sessionId: "s1" });
    expect((relayService as any).reportToolActivity).toHaveBeenCalled();

    (relayService as any).reportToolActivity.mockClear();
    await registered["get_next_prompt"]({}, { sessionId: "s1" });
    expect((relayService as any).reportToolActivity).not.toHaveBeenCalled();
    expect(RELAY_CONTROL_TOOLS.has("get_next_prompt")).toBe(true);
  });
});
