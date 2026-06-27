import { toCountMap } from "./count-map.util";

describe("toCountMap", () => {
  it("returns an empty map for empty rows", () => {
    expect(toCountMap([]).size).toBe(0);
  });

  it("defaults keyField=id and countField=count", () => {
    const result = toCountMap([
      { id: "a", count: "5" },
      { id: "b", count: "12" },
    ]);
    expect(result.get("a")).toBe(5);
    expect(result.get("b")).toBe(12);
  });

  it("honors custom field names", () => {
    const result = toCountMap(
      [
        { payee_id: "p1", n: "3" },
        { payee_id: "p2", n: "7" },
      ],
      { keyField: "payee_id", countField: "n" },
    );
    expect(result.get("p1")).toBe(3);
    expect(result.get("p2")).toBe(7);
  });

  it("accumulates when same key appears in multiple rows via `into`", () => {
    const direct = toCountMap([
      { id: "a", count: "5" },
      { id: "b", count: "12" },
    ]);
    const result = toCountMap(
      [
        { id: "a", count: "3" },
        { id: "c", count: "1" },
      ],
      { into: direct },
    );
    expect(result.get("a")).toBe(8);
    expect(result.get("b")).toBe(12);
    expect(result.get("c")).toBe(1);
  });

  it("treats null/missing counts as 0", () => {
    const result = toCountMap([
      { id: "a", count: null },
      { id: "b", count: undefined },
      { id: "c", count: "0" },
      { id: "d" },
    ]);
    expect(result.get("a")).toBe(0);
    expect(result.get("b")).toBe(0);
    expect(result.get("c")).toBe(0);
    expect(result.get("d")).toBe(0);
  });

  it("accepts numeric counts unchanged", () => {
    const result = toCountMap([{ id: "a", count: 42 }]);
    expect(result.get("a")).toBe(42);
  });

  it("skips rows with null/undefined keys", () => {
    const result = toCountMap([
      { id: null, count: "10" },
      { id: undefined, count: "5" },
      { id: "x", count: "3" },
    ]);
    expect(result.size).toBe(1);
    expect(result.get("x")).toBe(3);
  });
});
