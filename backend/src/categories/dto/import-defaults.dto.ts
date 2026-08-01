import { IsIn, IsOptional } from "class-validator";
import { ApiPropertyOptional } from "@nestjs/swagger";
import { DEFAULT_CATEGORY_COUNTRY_CODES } from "../country-category-additions";
import { SUPPORTED_LOCALE_CODES } from "../../i18n/config";

export class ImportDefaultsDto {
  @ApiPropertyOptional({
    description:
      "ISO 3166-1 alpha-2 country whose category additions to layer over the " +
      "generic catalog. Omit for the country-neutral defaults.",
    enum: DEFAULT_CATEGORY_COUNTRY_CODES,
  })
  @IsOptional()
  @IsIn([...DEFAULT_CATEGORY_COUNTRY_CODES])
  country?: string;

  @ApiPropertyOptional({
    description:
      "Locale the category names are created in. Defaults to the user's " +
      "stored language preference.",
  })
  @IsOptional()
  @IsIn([...SUPPORTED_LOCALE_CODES])
  language?: string;
}
