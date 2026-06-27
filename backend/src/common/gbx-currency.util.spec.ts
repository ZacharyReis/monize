import {
  isGbxCurrency,
  isGbxExchange,
  convertGbxToGbp,
} from "./gbx-currency.util";

describe("gbx-currency.util", () => {
  describe("isGbxCurrency", () => {
    it("returns true for Yahoo Finance pence notation 'GBp'", () => {
      expect(isGbxCurrency("GBp")).toBe(true);
    });

    it("returns true for 'GBX' (uppercase)", () => {
      expect(isGbxCurrency("GBX")).toBe(true);
    });

    it("returns true for 'gbx' (lowercase)", () => {
      expect(isGbxCurrency("gbx")).toBe(true);
    });

    it("returns true for 'GBx' (mixed case)", () => {
      expect(isGbxCurrency("GBx")).toBe(true);
    });

    it("returns false for 'GBP' (pounds sterling)", () => {
      expect(isGbxCurrency("GBP")).toBe(false);
    });

    it("returns false for 'USD'", () => {
      expect(isGbxCurrency("USD")).toBe(false);
    });

    it("returns false for null", () => {
      expect(isGbxCurrency(null)).toBe(false);
    });

    it("returns false for undefined", () => {
      expect(isGbxCurrency(undefined)).toBe(false);
    });

    it("returns false for empty string", () => {
      expect(isGbxCurrency("")).toBe(false);
    });

    it("handles leading/trailing whitespace", () => {
      expect(isGbxCurrency("  GBp  ")).toBe(true);
      expect(isGbxCurrency(" GBX ")).toBe(true);
    });
  });

  describe("isGbxExchange", () => {
    it("returns true for 'LSE'", () => {
      expect(isGbxExchange("LSE")).toBe(true);
    });

    it("returns true for 'LON'", () => {
      expect(isGbxExchange("LON")).toBe(true);
    });

    it("returns true for 'LONDON'", () => {
      expect(isGbxExchange("LONDON")).toBe(true);
    });

    it("is case-insensitive", () => {
      expect(isGbxExchange("lse")).toBe(true);
      expect(isGbxExchange("Lse")).toBe(true);
      expect(isGbxExchange("london")).toBe(true);
    });

    it("returns false for non-UK exchanges", () => {
      expect(isGbxExchange("NYSE")).toBe(false);
      expect(isGbxExchange("TSX")).toBe(false);
      expect(isGbxExchange("NASDAQ")).toBe(false);
      expect(isGbxExchange("XETRA")).toBe(false);
    });

    it("returns false for null", () => {
      expect(isGbxExchange(null)).toBe(false);
    });

    it("returns false for undefined", () => {
      expect(isGbxExchange(undefined)).toBe(false);
    });

    it("returns false for empty string", () => {
      expect(isGbxExchange("")).toBe(false);
    });
  });

  describe("convertGbxToGbp", () => {
    it("converts 100 pence to 1 pound", () => {
      expect(convertGbxToGbp(100)).toBe(1);
    });

    it("converts 520 pence to 5.20 pounds", () => {
      expect(convertGbxToGbp(520)).toBe(5.2);
    });

    it("converts 1190 pence to 11.90 pounds", () => {
      expect(convertGbxToGbp(1190)).toBe(11.9);
    });

    it("converts 105 pence to 1.05 pounds", () => {
      expect(convertGbxToGbp(105)).toBe(1.05);
    });

    it("converts 0 pence to 0 pounds", () => {
      expect(convertGbxToGbp(0)).toBe(0);
    });

    it("converts fractional pence (0.5p = 0.005 GBP)", () => {
      expect(convertGbxToGbp(0.5)).toBe(0.005);
    });

    it("rounds to 6 decimal places", () => {
      // 33.333333 pence / 100 = 0.33333333 GBP, rounded to 6 places
      expect(convertGbxToGbp(33.333333)).toBe(0.333333);
    });

    it("preserves sub-penny prices that 4-decimal rounding would zero out", () => {
      // 0.0318 GBX = 0.000318 GBP. At 4 decimals this rounded to 0.0003,
      // collapsing adjacent days to the same value and zeroing daily change.
      expect(convertGbxToGbp(0.0318)).toBe(0.000318);
      // A prior day ~11.4% lower must round to a distinct value, not the same.
      expect(convertGbxToGbp(0.02854)).toBe(0.000285);
      expect(convertGbxToGbp(0.0318)).not.toBe(convertGbxToGbp(0.02854));
    });

    it("handles large values", () => {
      // 100000 pence = 1000 GBP
      expect(convertGbxToGbp(100000)).toBe(1000);
    });

    it("handles negative values (for sell transactions)", () => {
      expect(convertGbxToGbp(-520)).toBe(-5.2);
    });
  });
});
