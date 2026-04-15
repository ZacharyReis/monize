import { ApiPropertyOptional } from "@nestjs/swagger";
import { IsOptional, IsInt, IsIn, IsString } from "class-validator";
import { Transform } from "class-transformer";

export class SpendingTrendsQueryDto {
  @ApiPropertyOptional({
    description: "Number of months to look back for spending averages",
    example: 3,
    default: 3,
  })
  @IsOptional()
  @Transform(({ value }) => parseInt(value, 10))
  @IsInt()
  @IsIn([1, 2, 3, 6, 9, 12])
  lookbackMonths?: number = 3;

  @ApiPropertyOptional({
    description: "Account ID to scope trends to, or 'all' for all accounts",
    example: "all",
    default: "all",
  })
  @IsOptional()
  @IsString()
  accountId?: string = "all";

  @ApiPropertyOptional({
    description:
      "Number of future days to generate dated projection events for",
    example: 365,
    default: 365,
  })
  @IsOptional()
  @Transform(({ value }) => parseInt(value, 10))
  @IsInt()
  @IsIn([7, 30, 90, 180, 365])
  forecastDays?: number = 365;
}
