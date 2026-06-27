import { DataSource } from "typeorm";
import { getUsersByEffectiveTimezone } from "./users-by-timezone.util";

function makeDataSource(
  rows: Array<{
    user_id: string;
    timezone: string | null;
    last_client_timezone: string | null;
  }>,
): DataSource {
  return { query: jest.fn().mockResolvedValue(rows) } as unknown as DataSource;
}

describe("getUsersByEffectiveTimezone", () => {
  it("returns an empty map when no users exist", async () => {
    const ds = makeDataSource([]);
    const result = await getUsersByEffectiveTimezone(ds);
    expect(result.size).toBe(0);
  });

  it("uses explicit timezone when set to a real IANA name", async () => {
    const ds = makeDataSource([
      {
        user_id: "u1",
        timezone: "America/New_York",
        last_client_timezone: "Europe/London",
      },
    ]);
    const result = await getUsersByEffectiveTimezone(ds);
    expect(result.get("America/New_York")).toEqual(["u1"]);
  });

  it("falls back to last_client_timezone when explicit is browser", async () => {
    const ds = makeDataSource([
      {
        user_id: "u1",
        timezone: "browser",
        last_client_timezone: "Europe/London",
      },
    ]);
    const result = await getUsersByEffectiveTimezone(ds);
    expect(result.get("Europe/London")).toEqual(["u1"]);
  });

  it("falls back to UTC when both are missing or browser", async () => {
    const ds = makeDataSource([
      { user_id: "u1", timezone: null, last_client_timezone: null },
      { user_id: "u2", timezone: "browser", last_client_timezone: "browser" },
      { user_id: "u3", timezone: "  ", last_client_timezone: "" },
    ]);
    const result = await getUsersByEffectiveTimezone(ds);
    expect(result.get("UTC")?.sort()).toEqual(["u1", "u2", "u3"]);
  });

  it("buckets multiple users sharing a timezone", async () => {
    const ds = makeDataSource([
      {
        user_id: "u1",
        timezone: "America/New_York",
        last_client_timezone: null,
      },
      {
        user_id: "u2",
        timezone: "America/New_York",
        last_client_timezone: null,
      },
      {
        user_id: "u3",
        timezone: "Europe/London",
        last_client_timezone: null,
      },
    ]);
    const result = await getUsersByEffectiveTimezone(ds);
    expect(result.get("America/New_York")?.sort()).toEqual(["u1", "u2"]);
    expect(result.get("Europe/London")).toEqual(["u3"]);
  });

  it("trims whitespace from timezone strings", async () => {
    const ds = makeDataSource([
      {
        user_id: "u1",
        timezone: "  America/New_York  ",
        last_client_timezone: null,
      },
    ]);
    const result = await getUsersByEffectiveTimezone(ds);
    expect(result.get("America/New_York")).toEqual(["u1"]);
  });
});
