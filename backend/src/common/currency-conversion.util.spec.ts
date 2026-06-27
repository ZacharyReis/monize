import { convertWithRateLookup } from "./currency-conversion.util";

describe("convertWithRateLookup", () => {
  const rates = new Map<string, number>([
    ["USD->CAD", 1.35],
    ["EUR->USD", 1.1],
  ]);
  const getRate = (from: string, to: string) => rates.get(`${from}->${to}`);

  it("returns the amount unchanged when currencies match", () => {
    expect(convertWithRateLookup(100, "USD", "USD", getRate)).toBe(100);
  });

  it("returns the amount unchanged when the from currency is empty", () => {
    expect(convertWithRateLookup(100, "", "USD", getRate)).toBe(100);
  });

  it("applies the direct rate when available", () => {
    expect(convertWithRateLookup(100, "USD", "CAD", getRate)).toBeCloseTo(135);
  });

  it("falls back to the inverse (reciprocal) rate", () => {
    // No CAD->USD rate, but USD->CAD = 1.35, so CAD->USD = 1/1.35
    expect(convertWithRateLookup(135, "CAD", "USD", getRate)).toBeCloseTo(100);
  });

  it("prefers the direct rate over the inverse when both exist", () => {
    const both = new Map<string, number>([
      ["USD->CAD", 1.35],
      ["CAD->USD", 0.8], // intentionally inconsistent
    ]);
    expect(
      convertWithRateLookup(100, "USD", "CAD", (f, t) =>
        both.get(`${f}->${t}`),
      ),
    ).toBeCloseTo(135);
  });

  it("returns null when no rate is available in either direction", () => {
    expect(convertWithRateLookup(100, "GBP", "JPY", getRate)).toBeNull();
  });

  it("returns null rather than dividing by a zero inverse rate", () => {
    const zero = new Map<string, number>([["USD->CAD", 0]]);
    expect(
      convertWithRateLookup(100, "CAD", "USD", (f, t) =>
        zero.get(`${f}->${t}`),
      ),
    ).toBeNull();
  });
});
