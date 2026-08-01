import { PartialType } from "@nestjs/swagger";
import { CreateLoanScenarioDto } from "./create-loan-scenario.dto";

export class UpdateLoanScenarioDto extends PartialType(CreateLoanScenarioDto) {}
