import {
  DEFAULT_LOOKBACK_DAYS,
  DEFAULT_TOP_N,
  getDefaultComparePeriods,
  getDefaultDateRange,
  getDefaultPreviousMonth,
  resolveComparePeriods,
} from "./tool-schemas";

describe("tool-schemas defaults", () => {
  const ymdRegex = /^\d{4}-\d{2}-\d{2}$/;
  const ymRegex = /^\d{4}-\d{2}$/;

  describe("getDefaultDateRange()", () => {
    it("returns today's date for endDate", () => {
      const today = new Date();
      const y = today.getFullYear();
      const m = String(today.getMonth() + 1).padStart(2, "0");
      const d = String(today.getDate()).padStart(2, "0");
      const expected = `${y}-${m}-${d}`;

      const { endDate } = getDefaultDateRange();

      expect(endDate).toBe(expected);
    });

    it("returns a startDate roughly DEFAULT_LOOKBACK_DAYS ago by default", () => {
      const { startDate, endDate } = getDefaultDateRange();

      const startMs = new Date(startDate + "T00:00:00").getTime();
      const endMs = new Date(endDate + "T00:00:00").getTime();
      const daysDiff = Math.round((endMs - startMs) / (1000 * 60 * 60 * 24));

      expect(daysDiff).toBe(DEFAULT_LOOKBACK_DAYS);
    });

    it("honors a custom lookback window", () => {
      const { startDate, endDate } = getDefaultDateRange(7);
      const startMs = new Date(startDate + "T00:00:00").getTime();
      const endMs = new Date(endDate + "T00:00:00").getTime();
      const daysDiff = Math.round((endMs - startMs) / (1000 * 60 * 60 * 24));

      expect(daysDiff).toBe(7);
    });

    it("returns YYYY-MM-DD strings for both ends", () => {
      const { startDate, endDate } = getDefaultDateRange();
      expect(startDate).toMatch(ymdRegex);
      expect(endDate).toMatch(ymdRegex);
    });
  });

  describe("getDefaultComparePeriods()", () => {
    it("returns period1 as the previous full calendar month", () => {
      const { period1Start, period1End } = getDefaultComparePeriods();

      const now = new Date();
      const expectedStart = new Date(now.getFullYear(), now.getMonth() - 1, 1);
      const expectedEnd = new Date(now.getFullYear(), now.getMonth(), 0);

      const fmt = (d: Date) =>
        `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

      expect(period1Start).toBe(fmt(expectedStart));
      expect(period1End).toBe(fmt(expectedEnd));
    });

    it("returns period2 as the current month-to-date", () => {
      const { period2Start, period2End } = getDefaultComparePeriods();
      const now = new Date();
      const expectedStart = new Date(now.getFullYear(), now.getMonth(), 1);

      const fmt = (d: Date) =>
        `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

      expect(period2Start).toBe(fmt(expectedStart));
      expect(period2End).toBe(fmt(now));
    });

    it("returns YYYY-MM-DD strings for all four fields", () => {
      const periods = getDefaultComparePeriods();
      expect(periods.period1Start).toMatch(ymdRegex);
      expect(periods.period1End).toMatch(ymdRegex);
      expect(periods.period2Start).toMatch(ymdRegex);
      expect(periods.period2End).toMatch(ymdRegex);
    });
  });

  describe("getDefaultPreviousMonth()", () => {
    it("returns the previous calendar month in YYYY-MM", () => {
      const now = new Date();
      const prev = new Date(now.getFullYear(), now.getMonth() - 1, 1);
      const expected = `${prev.getFullYear()}-${String(prev.getMonth() + 1).padStart(2, "0")}`;

      expect(getDefaultPreviousMonth()).toBe(expected);
    });

    it("returns a YYYY-MM formatted string", () => {
      expect(getDefaultPreviousMonth()).toMatch(ymRegex);
    });
  });

  describe("constants", () => {
    it("exposes sensible default values", () => {
      expect(DEFAULT_LOOKBACK_DAYS).toBe(30);
      expect(DEFAULT_TOP_N).toBe(10);
    });
  });

  describe("resolveComparePeriods()", () => {
    it("returns caller-supplied periods when all four dates are present", () => {
      const periods = resolveComparePeriods({
        period1Start: "2025-01-01",
        period1End: "2025-01-31",
        period2Start: "2025-02-01",
        period2End: "2025-02-28",
      });
      expect(periods).toEqual({
        period1Start: "2025-01-01",
        period1End: "2025-01-31",
        period2Start: "2025-02-01",
        period2End: "2025-02-28",
      });
    });

    it("falls back to defaults when any date is missing", () => {
      const defaults = getDefaultComparePeriods();
      const periods = resolveComparePeriods({
        period1Start: "2025-01-01",
        period1End: "2025-01-31",
        period2Start: "2025-02-01",
        // period2End missing -- all-or-nothing
      });
      expect(periods).toEqual(defaults);
    });

    it("falls back to defaults on entirely empty input", () => {
      const defaults = getDefaultComparePeriods();
      expect(resolveComparePeriods({})).toEqual(defaults);
    });
  });
});
