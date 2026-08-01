import { Module } from "@nestjs/common";
import { TypeOrmModule } from "@nestjs/typeorm";
import { LoanScenario } from "./entities/loan-scenario.entity";
import { Account } from "../accounts/entities/account.entity";
import { LoanScenariosService } from "./loan-scenarios.service";
import { LoanScenariosController } from "./loan-scenarios.controller";

@Module({
  imports: [TypeOrmModule.forFeature([LoanScenario, Account])],
  providers: [LoanScenariosService],
  controllers: [LoanScenariosController],
  exports: [LoanScenariosService],
})
export class LoanScenariosModule {}
