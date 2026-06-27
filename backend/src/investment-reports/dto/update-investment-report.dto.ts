import { PartialType } from "@nestjs/swagger";
import { CreateInvestmentReportDto } from "./create-investment-report.dto";

export class UpdateInvestmentReportDto extends PartialType(
  CreateInvestmentReportDto,
) {}
