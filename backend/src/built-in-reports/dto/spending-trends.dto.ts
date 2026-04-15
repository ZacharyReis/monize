import { ApiProperty } from "@nestjs/swagger";

export class SpendingTrendItem {
  @ApiProperty() categoryId: string | null;
  @ApiProperty() categoryName: string;
  @ApiProperty() monthlyAverage: number;
  @ApiProperty() scheduledMonthly: number;
  @ApiProperty() trendFill: number;
  @ApiProperty() dailyFill: number;
}

export class SpendingProjectionEvent {
  @ApiProperty() date: string;
  @ApiProperty() categoryId: string | null;
  @ApiProperty() categoryName: string;
  @ApiProperty() amount: number;
  @ApiProperty({ enum: ["low", "medium", "high"] })
  confidence: "low" | "medium" | "high";
  @ApiProperty() source: string;
}

export class SpendingTrendOutlier {
  @ApiProperty() date: string;
  @ApiProperty() categoryId: string | null;
  @ApiProperty() categoryName: string;
  @ApiProperty() amount: number;
  @ApiProperty({ required: false }) payeeName?: string | null;
  @ApiProperty() reason: string;
}

export class SpendingTrendsResponse {
  @ApiProperty({ type: [SpendingTrendItem] })
  trends: SpendingTrendItem[];

  @ApiProperty({ type: [SpendingProjectionEvent] })
  projectionEvents: SpendingProjectionEvent[];

  @ApiProperty({ type: [SpendingTrendOutlier] })
  excludedOutliers: SpendingTrendOutlier[];

  @ApiProperty() totalMonthlyFill: number;
  @ApiProperty() totalDailyFill: number;
  @ApiProperty() lookbackMonths: number;
  @ApiProperty() monthsUsed: number;
  @ApiProperty() currencyCode: string;
}
