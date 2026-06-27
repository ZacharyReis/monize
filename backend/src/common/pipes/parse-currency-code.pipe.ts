import { PipeTransform, Injectable, BadRequestException } from "@nestjs/common";
import { tr } from "../../i18n/translate";

/**
 * Validates a currency code parameter: exactly 3 uppercase letters (ISO 4217).
 */
@Injectable()
export class ParseCurrencyCodePipe implements PipeTransform<string, string> {
  transform(value: string): string {
    if (typeof value !== "string") {
      throw new BadRequestException(
        tr(
          "errors.common.currencyCodeMustBeString",
          "Currency code must be a string",
        ),
      );
    }
    const upper = value.toUpperCase();
    if (!/^[A-Z]{3}$/.test(upper)) {
      throw new BadRequestException(
        tr(
          "errors.common.currencyCodeInvalid",
          "Currency code must be exactly 3 letters (e.g., USD, CAD)",
        ),
      );
    }
    return upper;
  }
}
