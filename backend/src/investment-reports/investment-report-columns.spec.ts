import {
  INVESTMENT_REPORT_COLUMNS,
  INVESTMENT_REPORT_COLUMN_KEYS,
  ALWAYS_INCLUDED_COLUMN,
  isValidInvestmentColumn,
} from "./investment-report-columns";

describe("investment report columns catalogue", () => {
  it("includes symbol as the always-included column", () => {
    expect(ALWAYS_INCLUDED_COLUMN).toBe("symbol");
    expect(INVESTMENT_REPORT_COLUMN_KEYS).toContain("symbol");
  });

  it("exposes the full populatable column set", () => {
    expect(INVESTMENT_REPORT_COLUMNS).toHaveLength(41);
    expect(new Set(INVESTMENT_REPORT_COLUMN_KEYS).size).toBe(41);
  });

  it("gives every column a label, type and description", () => {
    for (const col of INVESTMENT_REPORT_COLUMNS) {
      expect(col.key).toBeTruthy();
      expect(col.label).toBeTruthy();
      expect(col.type).toBeTruthy();
      expect(col.description).toBeTruthy();
    }
  });

  it("validates known and unknown column keys", () => {
    expect(isValidInvestmentColumn("symbol")).toBe(true);
    expect(isValidInvestmentColumn("totalReturnYtd")).toBe(true);
    expect(isValidInvestmentColumn("peRatio")).toBe(false);
    expect(isValidInvestmentColumn("")).toBe(false);
  });

  it("excludes market-data columns we cannot populate", () => {
    const excluded = [
      "peRatio",
      "eps",
      "beta",
      "dividendYield",
      "marketCap",
      "bid",
      "ask",
    ];
    for (const key of excluded) {
      expect(INVESTMENT_REPORT_COLUMN_KEYS).not.toContain(key);
    }
  });
});
