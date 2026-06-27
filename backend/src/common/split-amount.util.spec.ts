import { BadRequestException } from "@nestjs/common";
import { validateSplitAmountSum } from "./split-amount.util";

describe("validateSplitAmountSum", () => {
  it("accepts splits whose 4dp sum equals the transaction amount", () => {
    expect(() =>
      validateSplitAmountSum(
        [{ amount: 50.0 }, { amount: 30.0 }, { amount: 20.0 }],
        100,
      ),
    ).not.toThrow();
  });

  it("rejects when the sum does not match", () => {
    expect(() =>
      validateSplitAmountSum([{ amount: 50 }, { amount: 30 }], 100),
    ).toThrow(BadRequestException);
  });

  it("rejects fewer than 2 splits by default", () => {
    expect(() => validateSplitAmountSum([{ amount: 100 }], 100)).toThrow(
      BadRequestException,
    );
  });

  it("rejects fewer than 2 splits when passthrough is disallowed by predicate", () => {
    expect(() =>
      validateSplitAmountSum([{ amount: 100 }], 100, {
        allowSinglePassthrough: true,
        isPassthrough: () => false,
      }),
    ).toThrow(BadRequestException);
  });

  it("allows a single split when allowSinglePassthrough + predicate match", () => {
    expect(() =>
      validateSplitAmountSum([{ amount: 100 }], 100, {
        allowSinglePassthrough: true,
        isPassthrough: () => true,
      }),
    ).not.toThrow();
  });

  it("tolerates rounding within 4dp precision", () => {
    expect(() =>
      validateSplitAmountSum(
        [{ amount: 33.3333 }, { amount: 33.3333 }, { amount: 33.3334 }],
        100,
      ),
    ).not.toThrow();
  });

  it("rejects float-precision mismatches beyond 4dp", () => {
    expect(() =>
      validateSplitAmountSum(
        [{ amount: 33.33333 }, { amount: 33.33333 }, { amount: 33.33333 }],
        100,
      ),
    ).toThrow(BadRequestException);
  });
});
