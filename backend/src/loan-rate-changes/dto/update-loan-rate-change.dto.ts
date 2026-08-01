import { OmitType, PartialType } from "@nestjs/swagger";
import { CreateLoanRateChangeDto } from "./create-loan-rate-change.dto";

export class UpdateLoanRateChangeDto extends PartialType(
  OmitType(CreateLoanRateChangeDto, ["recalculatePayment"] as const),
) {}
