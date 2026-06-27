import { detectFrequency } from "./recurring-charges.util";

/**
 * Build an ascending list of ISO date strings starting at `start`, with each
 * consecutive date separated by `gapDays`. An optional `jitter` array offsets
 * individual gaps so we can exercise the variance / std-dev branch.
 */
function buildDates(
  start: string,
  gapDays: number,
  count: number,
  jitter: number[] = [],
): string[] {
  const dates: string[] = [];
  let current = new Date(start).getTime();
  dates.push(new Date(current).toISOString().slice(0, 10));
  for (let i = 1; i < count; i++) {
    const offset = jitter[i - 1] ?? 0;
    current += (gapDays + offset) * 24 * 60 * 60 * 1000;
    dates.push(new Date(current).toISOString().slice(0, 10));
  }
  return dates;
}

describe("detectFrequency", () => {
  it("returns irregular when there are fewer than three dates", () => {
    expect(detectFrequency([])).toBe("irregular");
    expect(detectFrequency(["2026-01-01"])).toBe("irregular");
    expect(detectFrequency(["2026-01-01", "2026-01-08"])).toBe("irregular");
  });

  it("classifies a weekly cadence (avg gap 5-10 days)", () => {
    expect(detectFrequency(buildDates("2026-01-01", 7, 5))).toBe("weekly");
  });

  it("classifies a biweekly cadence (avg gap 12-18 days)", () => {
    expect(detectFrequency(buildDates("2026-01-01", 14, 5))).toBe("biweekly");
  });

  it("classifies a monthly cadence (avg gap 25-35 days)", () => {
    expect(detectFrequency(buildDates("2026-01-01", 30, 6))).toBe("monthly");
  });

  it("classifies a quarterly cadence (avg gap 80-100 days)", () => {
    expect(detectFrequency(buildDates("2026-01-01", 91, 5))).toBe("quarterly");
  });

  it("classifies a yearly cadence (avg gap 350-380 days)", () => {
    expect(detectFrequency(buildDates("2020-01-01", 365, 4))).toBe("yearly");
  });

  it("returns irregular when gaps are too noisy relative to the average", () => {
    // Average gap ~30 days but with large swings, pushing std-dev above the
    // 40% threshold.
    const noisy = buildDates("2026-01-01", 30, 5, [20, -20, 25, -22]);
    expect(detectFrequency(noisy)).toBe("irregular");
  });

  it("returns irregular when the steady gap falls between recognised bands", () => {
    // ~21-day cadence is consistent (low variance) but matches none of the
    // named frequency windows, so it falls through to irregular.
    expect(detectFrequency(buildDates("2026-01-01", 21, 5))).toBe("irregular");
  });

  it("returns irregular for sub-weekly daily charges", () => {
    expect(detectFrequency(buildDates("2026-01-01", 2, 5))).toBe("irregular");
  });
});
