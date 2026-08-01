import {
  DEFAULT_APP_USER,
  getRlsMode,
  parseRlsMode,
  resolveRlsDatabaseAuth,
} from "./rls-config";

describe("parseRlsMode", () => {
  it.each(["off", "shadow", "enforce"] as const)(
    "accepts the valid mode %s",
    (mode) => {
      expect(parseRlsMode(mode)).toBe(mode);
    },
  );

  it("defaults an unset value to off", () => {
    expect(parseRlsMode(undefined)).toBe("off");
    expect(parseRlsMode(null)).toBe("off");
    expect(parseRlsMode("")).toBe("off");
    expect(parseRlsMode("   ")).toBe("off");
  });

  it("is case-insensitive and trims surrounding whitespace", () => {
    expect(parseRlsMode("  ENFORCE ")).toBe("enforce");
    expect(parseRlsMode("Shadow")).toBe("shadow");
  });

  it("throws on an unrecognized value", () => {
    expect(() => parseRlsMode("on")).toThrow(/Invalid RLS_MODE/);
    expect(() => parseRlsMode("enforced")).toThrow(/Invalid RLS_MODE/);
  });
});

describe("getRlsMode", () => {
  const original = process.env.RLS_MODE;
  afterEach(() => {
    if (original === undefined) {
      delete process.env.RLS_MODE;
    } else {
      process.env.RLS_MODE = original;
    }
  });

  it("reads the mode from the environment", () => {
    process.env.RLS_MODE = "shadow";
    expect(getRlsMode()).toBe("shadow");
  });

  it("defaults to off when unset", () => {
    delete process.env.RLS_MODE;
    expect(getRlsMode()).toBe("off");
  });
});

describe("resolveRlsDatabaseAuth", () => {
  const owner = {
    databaseUser: "monize_user",
    databasePassword: "owner-pw",
    appUser: "monize_app",
    appPassword: "app-pw",
  };

  it.each(["off", "shadow"] as const)(
    "connects with the owner credentials in %s mode",
    (mode) => {
      expect(resolveRlsDatabaseAuth({ mode, ...owner })).toEqual({
        username: "monize_user",
        password: "owner-pw",
      });
    },
  );

  it("connects with the app credentials in enforce mode", () => {
    expect(resolveRlsDatabaseAuth({ mode: "enforce", ...owner })).toEqual({
      username: "monize_app",
      password: "app-pw",
    });
  });

  it("falls back to the default app user when DATABASE_APP_USER is unset", () => {
    expect(
      resolveRlsDatabaseAuth({ ...owner, mode: "enforce", appUser: undefined }),
    ).toEqual({ username: DEFAULT_APP_USER, password: "app-pw" });
  });

  it("throws in enforce mode when the app password is missing", () => {
    expect(() =>
      resolveRlsDatabaseAuth({
        ...owner,
        mode: "enforce",
        appPassword: undefined,
      }),
    ).toThrow(/DATABASE_APP_PASSWORD/);
  });

  it("does not require the app password in off/shadow mode", () => {
    expect(
      resolveRlsDatabaseAuth({
        mode: "off",
        databaseUser: "monize_user",
        databasePassword: "owner-pw",
        appUser: undefined,
        appPassword: undefined,
      }),
    ).toEqual({ username: "monize_user", password: "owner-pw" });
  });
});
