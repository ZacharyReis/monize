import { applyDecorators } from "@nestjs/common";
import { IsString, Matches } from "class-validator";

/**
 * Validates that the value is a 3-letter ISO 4217 currency code.
 *
 * Enforces uppercase alphabetic characters (e.g., "USD", "CAD", "EUR"). Use
 * this instead of ad-hoc `@MaxLength(3)`, `@Length(3, 3)`, or hand-rolled
 * `@Matches(/^[A-Z]{3}$/)` decorators so currency-code validation stays
 * consistent across every DTO.
 */
export function IsCurrencyCode(): PropertyDecorator {
  return applyDecorators(
    IsString(),
    Matches(/^[A-Z]{3}$/, {
      message: "Currency code must be exactly 3 uppercase letters (ISO 4217)",
    }),
  );
}
