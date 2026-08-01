import { BadRequestException } from "@nestjs/common";
import { Response } from "express";
import { AiRelayController } from "./ai-relay.controller";
import { AiRelayService, RelayTimeoutError } from "./ai-relay.service";

function makeRes() {
  const events: Array<Record<string, unknown>> = [];
  const res = {
    setHeader: jest.fn(),
    flushHeaders: jest.fn(),
    on: jest.fn(),
    writableEnded: false,
    end: jest.fn(),
    write: jest.fn((chunk: string) => {
      const line = chunk.toString();
      if (line.startsWith("data: ")) {
        events.push(JSON.parse(line.slice(6)));
      }
      return true;
    }),
  };
  return { res: res as unknown as Response, events };
}

describe("AiRelayController", () => {
  const req = { user: { id: "user-1" } };

  function build(relay: Partial<AiRelayService>) {
    return new AiRelayController(relay as AiRelayService);
  }

  it("streams a prompt_id, then the answer as content (not assistant_text), then done", async () => {
    const controller = build({
      enqueuePrompt: jest
        .fn()
        .mockImplementation(
          (
            _userId: string,
            _query: string,
            _history: unknown,
            _emit: unknown,
            onEnqueued?: (id: string) => void,
          ) => {
            onEnqueued?.("prompt-123");
            return Promise.resolve({ text: "buy index funds" });
          },
        ),
    });
    const { res, events } = makeRes();

    await controller.streamQuery(req, { query: "what should I buy?" }, res);

    // The client needs its promptId up front to pick up a late answer.
    expect(events).toEqual([
      { type: "prompt_id", promptId: "prompt-123" },
      { type: "content", text: "buy index funds" },
      { type: "done" },
    ]);
    expect(events.some((e) => e.type === "assistant_text")).toBe(false);
  });

  it("sets nosniff and escapes markup in the agent's answer", async () => {
    const answer = "<img src=x onerror=alert(1)> Tom & Jerry's";
    const controller = build({
      enqueuePrompt: jest.fn().mockResolvedValue({ text: answer }),
    });
    const { res, events } = makeRes();
    const written: string[] = [];
    (res.write as unknown as jest.Mock).mockImplementation((chunk: string) => {
      written.push(chunk);
      if (chunk.startsWith("data: ")) {
        events.push(JSON.parse(chunk.slice(6)));
      }
      return true;
    });

    await controller.streamQuery(req, { query: "what should I buy?" }, res);

    expect(res.setHeader).toHaveBeenCalledWith(
      "X-Content-Type-Options",
      "nosniff",
    );
    // Character-level checks: no raw markup character reaches the socket.
    const body = written.join("");
    expect(body.includes("<")).toBe(false);
    expect(body.includes(">")).toBe(false);
    expect(body.includes("&")).toBe(false);
    // The client still parses the original text back out unchanged.
    expect(events).toContainEqual({ type: "content", text: answer });
  });

  it("forwards uploaded attachments to enqueuePrompt", async () => {
    const enqueuePrompt = jest.fn().mockResolvedValue({ text: "ok" });
    const controller = build({ enqueuePrompt });
    const { res } = makeRes();
    const attachments = [
      {
        kind: "image" as const,
        mediaType: "image/png",
        filename: "i.png",
        data: "abc",
      },
    ];

    await controller.streamQuery(
      req,
      { query: "what is this?", attachments },
      res,
    );

    // attachments are the 6th positional argument of enqueuePrompt.
    expect(enqueuePrompt.mock.calls[0][5]).toEqual(attachments);
  });

  it("emits the attachment-rejected error when an upload fails validation", async () => {
    const controller = build({
      enqueuePrompt: jest.fn().mockImplementation(() => {
        throw new BadRequestException("bad attachment");
      }),
    });
    const { res, events } = makeRes();

    await controller.streamQuery(
      req,
      {
        query: "what is this?",
        attachments: [
          {
            kind: "image",
            mediaType: "image/png",
            filename: "i.png",
            data: "abc",
          },
        ],
      },
      res,
    );

    expect(events).toHaveLength(1);
    expect(events[0].type).toBe("error");
    // The attachment-specific copy, not the generic timeout one.
    expect(events[0].message).toContain("could not be sent");
  });

  it("emits a plain error when no agent ever claimed the prompt", async () => {
    const controller = build({
      enqueuePrompt: jest
        .fn()
        .mockRejectedValue(new RelayTimeoutError("no_agent", "p1")),
    });
    const { res, events } = makeRes();

    await controller.streamQuery(req, { query: "hi" }, res);

    expect(events).toHaveLength(1);
    expect(events[0].type).toBe("error");
    expect(typeof events[0].message).toBe("string");
    // The "make sure your agent is connected" copy, not the "went quiet" one.
    expect(events[0].message).toContain("did not respond");
  });

  it("emits distinct copy when a claimed agent went quiet", async () => {
    const controller = build({
      enqueuePrompt: jest
        .fn()
        .mockRejectedValue(new RelayTimeoutError("disconnected", "p1")),
    });
    const { res, events } = makeRes();

    await controller.streamQuery(req, { query: "hi" }, res);

    expect(events).toHaveLength(1);
    expect(events[0].type).toBe("error");
    expect(events[0].message).toContain("went quiet");
  });

  it("picks up a buffered late answer by promptId", () => {
    const takeBufferedResponse = jest
      .fn()
      .mockReturnValue({ text: "the late answer" });
    const takeBufferedActions = jest.fn().mockReturnValue([]);
    const controller = build({ takeBufferedResponse, takeBufferedActions });

    expect(controller.pickupResponse(req, "prompt-123")).toEqual({
      text: "the late answer",
      pendingActions: [],
    });
    expect(takeBufferedResponse).toHaveBeenCalledWith("user-1", "prompt-123");
  });

  it("returns null text when nothing is buffered for the prompt", () => {
    const takeBufferedResponse = jest.fn().mockReturnValue(null);
    const takeBufferedActions = jest.fn().mockReturnValue([]);
    const controller = build({ takeBufferedResponse, takeBufferedActions });

    expect(controller.pickupResponse(req, "prompt-123")).toEqual({
      text: null,
      pendingActions: [],
    });
  });

  it("drains buffered confirmation cards on pickup, even without an answer", () => {
    const cards = [{ actionId: "act-1" }, { actionId: "act-2" }];
    const takeBufferedResponse = jest.fn().mockReturnValue(null);
    const takeBufferedActions = jest.fn().mockReturnValue(cards);
    const controller = build({ takeBufferedResponse, takeBufferedActions });

    expect(controller.pickupResponse(req, "prompt-123")).toEqual({
      text: null,
      pendingActions: cards,
    });
    expect(takeBufferedActions).toHaveBeenCalledWith("user-1");
  });

  it("returns the relay tunnel status", () => {
    const getStatus = jest
      .fn()
      .mockReturnValue({ state: "listening", queued: 0 });
    const controller = build({ getStatus });
    expect(controller.status(req)).toEqual({ state: "listening", queued: 0 });
    expect(getStatus).toHaveBeenCalledWith("user-1");
  });
});
