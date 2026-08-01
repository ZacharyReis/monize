import { Logger } from "@nestjs/common";
import { getRequestContext } from "../request-context";
import {
  callSiteFromStack,
  withSystemContext,
  withUserContext,
} from "./with-context";

const VALID_UUID = "11111111-1111-4111-8111-111111111111";

describe("withUserContext", () => {
  it("seeds a user context and returns the callback value", () => {
    const seen = withUserContext(VALID_UUID, () => getRequestContext());
    expect(seen).toEqual({ userId: VALID_UUID });
  });

  it("does not seed realUserId (tenantTx defaults it to userId)", () => {
    const seen = withUserContext(VALID_UUID, () => getRequestContext());
    expect(seen?.realUserId).toBeUndefined();
    expect(seen?.system).toBeUndefined();
  });

  it("propagates async return values within the scope", async () => {
    await expect(
      withUserContext(VALID_UUID, async () => {
        return getRequestContext()?.userId;
      }),
    ).resolves.toBe(VALID_UUID);
  });

  it.each(["not-a-uuid", "", "12345", "11111111-1111-4111-8111"])(
    "throws on a non-UUID userId (%s)",
    (bad) => {
      expect(() => withUserContext(bad, () => 1)).toThrow(/valid UUID/);
    },
  );

  it("does not enter a scope when validation fails", () => {
    expect(getRequestContext()).toBeUndefined();
    try {
      withUserContext("bad", () => 1);
    } catch {
      // expected
    }
    expect(getRequestContext()).toBeUndefined();
  });
});

describe("withSystemContext", () => {
  let logSpy: jest.SpyInstance;

  beforeEach(() => {
    logSpy = jest.spyOn(Logger.prototype, "log").mockImplementation(() => {});
  });

  afterEach(() => {
    logSpy.mockRestore();
  });

  it("seeds a system context and returns the callback value", () => {
    const seen = withSystemContext(() => getRequestContext());
    expect(seen).toEqual({ system: true });
  });

  it("logs each distinct call site once (rate-limited)", () => {
    // Both calls share the same source line inside `invoke`, so the second is
    // throttled by call site.
    const invoke = () => withSystemContext(() => undefined);
    invoke();
    invoke();
    expect(logSpy).toHaveBeenCalledTimes(1);
    expect(logSpy.mock.calls[0][0]).toMatch(/RLS bypass \(withSystemContext\)/);
  });

  it("propagates async return values within the scope", async () => {
    await expect(
      withSystemContext(async () => getRequestContext()?.system),
    ).resolves.toBe(true);
  });
});

describe("callSiteFromStack", () => {
  it("returns 'unknown' when the stack is absent", () => {
    expect(callSiteFromStack(undefined)).toBe("unknown");
  });

  it("returns the first frame outside this module", () => {
    const stack = [
      "Error",
      "    at resolveCallSite (/app/src/common/db/with-context.ts:60:12)",
      "    at withSystemContext (/app/src/common/db/with-context.ts:45:3)",
      "    at MyCron.run (/app/src/scheduled/my.service.ts:88:20)",
    ].join("\n");
    expect(callSiteFromStack(stack)).toBe(
      "MyCron.run (/app/src/scheduled/my.service.ts:88:20)",
    );
  });

  it("does not treat a with-context.spec.ts caller as an own frame", () => {
    const stack = [
      "Error",
      "    at resolveCallSite (/app/src/common/db/with-context.ts:60:12)",
      "    at invoke (/app/src/common/db/with-context.spec.ts:64:5)",
    ].join("\n");
    expect(callSiteFromStack(stack)).toBe(
      "invoke (/app/src/common/db/with-context.spec.ts:64:5)",
    );
  });

  it("returns 'unknown' when every frame is an own frame", () => {
    const stack = [
      "Error",
      "    at resolveCallSite (/app/src/common/db/with-context.ts:60:12)",
      "    at withSystemContext (/app/src/common/db/with-context.js:45:3)",
    ].join("\n");
    expect(callSiteFromStack(stack)).toBe("unknown");
  });
});
