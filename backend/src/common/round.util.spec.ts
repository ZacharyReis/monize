import {
  roundToDecimals,
  roundMoney,
  sumMoney,
  toMoneyNumber,
} from "./round.util";

describe("toMoneyNumber", () => {
  it("parses a decimal SQL string to a number", () => {
    expect(toMoneyNumber("12.3400")).toBe(12.34);
  });

  it("maps null/undefined/empty to 0", () => {
    expect(toMoneyNumber(null)).toBe(0);
    expect(toMoneyNumber(undefined)).toBe(0);
    expect(toMoneyNumber("")).toBe(0);
  });

  it("maps non-numeric garbage to 0 (unlike parseFloat)", () => {
    expect(toMoneyNumber("abc")).toBe(0);
    // parseFloat("12.34abc") would be 12.34; Number() rejects it -> 0
    expect(toMoneyNumber("12.34abc")).toBe(0);
  });

  it("rounds to 4dp money precision", () => {
    expect(toMoneyNumber(1.234567)).toBe(1.2346);
  });

  it("passes through plain numbers", () => {
    expect(toMoneyNumber(42)).toBe(42);
  });
});

describe("roundToDecimals", () => {
  describe("basic rounding", () => {
    it("rounds to 2 decimal places", () => {
      expect(roundToDecimals(1.234, 2)).toBe(1.23);
      expect(roundToDecimals(1.235, 2)).toBe(1.24);
      expect(roundToDecimals(1.236, 2)).toBe(1.24);
    });

    it("rounds to 0 decimal places", () => {
      expect(roundToDecimals(1.4, 0)).toBe(1);
      expect(roundToDecimals(1.5, 0)).toBe(2);
      expect(roundToDecimals(1.6, 0)).toBe(2);
    });

    it("rounds to 4 decimal places", () => {
      expect(roundToDecimals(1.23456, 4)).toBe(1.2346);
      expect(roundToDecimals(1.23454, 4)).toBe(1.2345);
    });
  });

  describe("IEEE 754 midpoint cases (the actual bug)", () => {
    it("correctly rounds 159.735 to 2dp (10 shares at 15.9735)", () => {
      // 10 * 15.9735 = 159.735 mathematically, but IEEE 754 stores
      // it as 159.73499999999998... which naive rounding gets wrong
      const total = 10 * 15.9735;
      expect(roundToDecimals(total, 2)).toBe(159.74);
    });

    it("correctly rounds 1.005 to 2dp", () => {
      expect(roundToDecimals(1.005, 2)).toBe(1.01);
    });

    it("correctly rounds 2.675 to 2dp", () => {
      expect(roundToDecimals(2.675, 2)).toBe(2.68);
    });

    it("correctly rounds 1.255 to 2dp", () => {
      expect(roundToDecimals(1.255, 2)).toBe(1.26);
    });
  });

  describe("negative values (round half away from zero)", () => {
    it("rounds negative midpoints away from zero", () => {
      expect(roundToDecimals(-1.235, 2)).toBe(-1.24);
      expect(roundToDecimals(-159.735, 2)).toBe(-159.74);
      expect(roundToDecimals(-1.005, 2)).toBe(-1.01);
    });

    it("rounds negative non-midpoints correctly", () => {
      expect(roundToDecimals(-1.234, 2)).toBe(-1.23);
      expect(roundToDecimals(-1.236, 2)).toBe(-1.24);
    });
  });

  describe("edge cases", () => {
    it("handles zero", () => {
      expect(roundToDecimals(0, 2)).toBe(0);
    });

    it("handles integers", () => {
      expect(roundToDecimals(5, 2)).toBe(5);
    });

    it("handles Infinity", () => {
      expect(roundToDecimals(Infinity, 2)).toBe(Infinity);
      expect(roundToDecimals(-Infinity, 2)).toBe(-Infinity);
    });

    it("handles NaN", () => {
      expect(roundToDecimals(NaN, 2)).toBeNaN();
    });

    it("handles very small numbers", () => {
      expect(roundToDecimals(0.001, 2)).toBe(0);
      expect(roundToDecimals(0.005, 2)).toBe(0.01);
    });

    it("handles 3 decimal places (e.g. BHD)", () => {
      expect(roundToDecimals(1.2345, 3)).toBe(1.235);
      expect(roundToDecimals(1.2344, 3)).toBe(1.234);
    });

    it("handles tiny magnitudes that stringify in exponential notation", () => {
      // toString() would give "1e-7", and "1e-7e8" parses to NaN; the
      // exponential decomposition handles it.
      expect(roundToDecimals(1e-7, 8)).toBe(1e-7);
      expect(roundToDecimals(1.2345e-5, 8)).toBe(0.00001235);
      expect(roundToDecimals(8e-7, 6)).toBe(0.000001);
      expect(roundToDecimals(-1e-7, 8)).toBe(-1e-7);
    });

    it("rounds tiny magnitudes to zero at coarser precision", () => {
      expect(roundToDecimals(1e-7, 4)).toBe(0);
      expect(roundToDecimals(8e-7, 4)).toBe(0);
    });

    it("handles zero without producing -0 or NaN", () => {
      expect(roundToDecimals(0, 4)).toBe(0);
      expect(Object.is(roundToDecimals(0, 4), 0)).toBe(true);
    });
  });
});

describe("roundMoney", () => {
  it("rounds to 4 decimal places (storage precision)", () => {
    expect(roundMoney(1.23456)).toBe(1.2346);
    expect(roundMoney(1.23454)).toBe(1.2345);
    expect(roundMoney(1000)).toBe(1000);
    expect(roundMoney(17.99)).toBe(17.99);
  });

  it("preserves sub-cent precision that 2dp rounding would lose", () => {
    expect(roundMoney(1234.5678)).toBe(1234.5678);
    expect(roundMoney(0.0001)).toBe(0.0001);
  });

  it("rounds half away from zero, fixing IEEE 754 midpoints", () => {
    // 10 * 1.59735 = 15.9735 mathematically; naive *10000 would drop the digit
    expect(roundMoney(1.23455)).toBe(1.2346);
    expect(roundMoney(-1.23455)).toBe(-1.2346);
  });

  it("passes through non-finite values", () => {
    expect(roundMoney(Infinity)).toBe(Infinity);
    expect(roundMoney(NaN)).toBeNaN();
  });
});

describe("sumMoney", () => {
  it("sums without floating-point drift", () => {
    expect(sumMoney([0.1, 0.2])).toBe(0.3);
    expect(sumMoney([10.0001, 20.0002])).toBe(30.0003);
  });

  it("returns 0 for an empty array", () => {
    expect(sumMoney([])).toBe(0);
  });

  it("matches a careful reduce over many sub-cent values", () => {
    const values = Array.from({ length: 1000 }, () => 0.0001);
    expect(sumMoney(values)).toBe(0.1);
  });

  it("handles negative values", () => {
    expect(sumMoney([100, -33.33, -33.33, -33.34])).toBe(0);
  });

  it("ignores non-finite entries", () => {
    expect(sumMoney([1.5, NaN, 2.5, Infinity])).toBe(4);
  });
});
