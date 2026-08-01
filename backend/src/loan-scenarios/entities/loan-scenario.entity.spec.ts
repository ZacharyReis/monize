import { getMetadataArgsStorage } from "typeorm";
import {
  LoanScenario,
  OVERPAYMENT_MODES,
  OVERPAYMENT_FREQUENCIES,
} from "./loan-scenario.entity";

/**
 * Every enum-backed varchar column must be wide enough for its longest allowed
 * value. Unit tests mock the repository and the integration suite never wrote
 * a LOWER_INSTALLMENT (17 chars) mode, so the VARCHAR(16) mode columns only
 * failed in a real database ("value too long for type character varying(16)").
 * This pins the entity metadata to the value lists so the mismatch cannot
 * come back with a new value or a new column.
 */
describe("LoanScenario column capacities", () => {
  const columns = getMetadataArgsStorage().columns.filter(
    (c) => c.target === LoanScenario,
  );

  const capacityOf = (columnName: string): number => {
    const column = columns.find((c) => c.options.name === columnName);
    expect(column).toBeDefined();
    return Number(column!.options.length);
  };

  const longest = (values: readonly string[]): string =>
    [...values].sort((a, b) => b.length - a.length)[0];

  it.each([
    ["recurring_extra_mode", OVERPAYMENT_MODES],
    ["target_monthly_payment_mode", OVERPAYMENT_MODES],
    ["recurring_extra_frequency", OVERPAYMENT_FREQUENCIES],
  ] as const)("%s fits every allowed value", (columnName, values) => {
    const capacity = capacityOf(columnName);
    const widest = longest(values);
    expect(capacity).toBeGreaterThanOrEqual(widest.length);
  });
});
