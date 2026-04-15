import { ApiProperty } from "@nestjs/swagger";

export class SpendingTrendItem {
  @ApiProperty() categoryId: string | null;
  @ApiProperty() categoryName: string;
  @ApiProperty() monthlyAverage: number;
  @ApiProperty() scheduledMonthly: number;
  @ApiProperty() trendFill: number;
  @ApiProperty() dailyFill: number;
}

export class SpendingTrendsResponse {
  @ApiProperty({ type: [SpendingTrendItem] })
  trends: SpendingTrendItem[];

  @ApiProperty() totalMonthlyFill: number;
  @ApiProperty() totalDailyFill: number;
  @ApiProperty() lookbackMonths: number;
  @ApiProperty() monthsUsed: number;
  @ApiProperty() currencyCode: string;
}
