import { SSE_HEADERS, sseData } from "./sse.util";

const LINE_SEP = String.fromCharCode(0x2028);
const PARA_SEP = String.fromCharCode(0x2029);

const payloadOf = (frame: string): string =>
  frame.slice("data: ".length, -"\n\n".length);

describe("sseData", () => {
  it("formats a value as an SSE data frame", () => {
    expect(sseData({ type: "done" })).toBe(`data: {"type":"done"}\n\n`);
  });

  it("escapes markup characters as JSON unicode escapes", () => {
    const frame = sseData({ text: "<img src=x onerror=alert(1)>" });

    // No raw markup character survives into the response body. Character-level
    // checks keep the assertion from reading as an HTML-filtering regex.
    expect(frame.includes("<")).toBe(false);
    expect(frame.includes(">")).toBe(false);
    expect(frame).toContain("\\u003c");
    expect(frame).toContain("\\u003e");
  });

  it("escapes ampersands and single quotes", () => {
    const frame = sseData({ text: "Tom & Jerry's" });

    expect(frame.includes("&")).toBe(false);
    expect(frame.includes("'")).toBe(false);
    expect(frame).toContain("\\u0026");
    expect(frame).toContain("\\u0027");
  });

  it("escapes JavaScript line terminators valid inside JSON strings", () => {
    const frame = sseData({ text: `a${LINE_SEP}b${PARA_SEP}c` });

    expect(frame.includes(LINE_SEP)).toBe(false);
    expect(frame.includes(PARA_SEP)).toBe(false);
    expect(frame).toContain("\\u2028");
    expect(frame).toContain("\\u2029");
  });

  it("keeps the frame parseable and round-trips the original value", () => {
    const event = {
      type: "content",
      text: `<b>5 & 6</b> "quoted" 'single' ${LINE_SEP} done`,
      nested: { items: ["<script>", "a&b"] },
    };

    expect(JSON.parse(payloadOf(sseData(event)))).toEqual(event);
  });

  it("leaves structural double quotes intact so JSON stays valid", () => {
    const frame = sseData({ 'key"with"quotes': 'say "hi"' });

    expect(JSON.parse(payloadOf(frame))).toEqual({
      'key"with"quotes': 'say "hi"',
    });
  });

  it("emits a null payload for values JSON cannot serialize", () => {
    expect(sseData(undefined)).toBe("data: null\n\n");
    expect(sseData(null)).toBe("data: null\n\n");
  });
});

describe("SSE_HEADERS", () => {
  it("declares the event-stream content type and blocks sniffing", () => {
    expect(SSE_HEADERS["Content-Type"]).toBe("text/event-stream");
    expect(SSE_HEADERS["X-Content-Type-Options"]).toBe("nosniff");
    expect(SSE_HEADERS["Cache-Control"]).toBe("no-cache");
    expect(SSE_HEADERS["Connection"]).toBe("keep-alive");
    expect(SSE_HEADERS["X-Accel-Buffering"]).toBe("no");
  });
});
