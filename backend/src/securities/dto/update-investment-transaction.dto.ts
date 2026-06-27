import { PartialType, ApiProperty } from "@nestjs/swagger";
import { IsOptional, IsUUID } from "class-validator";
import { CreateInvestmentTransactionDto } from "./create-investment-transaction.dto";

export class UpdateInvestmentTransactionDto extends PartialType(
  CreateInvestmentTransactionDto,
) {
  @ApiProperty({
    required: false,
    description:
      "Destination account for a security transfer. Only meaningful when editing a transfer leg; reroutes the paired (TRANSFER_IN) leg to this account.",
  })
  @IsOptional()
  @IsUUID()
  destinationAccountId?: string;
}
