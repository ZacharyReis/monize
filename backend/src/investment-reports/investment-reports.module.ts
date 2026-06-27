import { Module } from "@nestjs/common";
import { TypeOrmModule } from "@nestjs/typeorm";
import { InvestmentReportsService } from "./investment-reports.service";
import { InvestmentReportDataService } from "./investment-report-data.service";
import { InvestmentReportsController } from "./investment-reports.controller";
import { InvestmentReport } from "./entities/investment-report.entity";
import { InvestmentTransaction } from "../securities/entities/investment-transaction.entity";
import { Holding } from "../securities/entities/holding.entity";
import { Security } from "../securities/entities/security.entity";
import { Account } from "../accounts/entities/account.entity";
import { UserPreference } from "../users/entities/user-preference.entity";
import { CurrenciesModule } from "../currencies/currencies.module";
import { ActionHistoryModule } from "../action-history/action-history.module";

@Module({
  imports: [
    TypeOrmModule.forFeature([
      InvestmentReport,
      InvestmentTransaction,
      Holding,
      Security,
      Account,
      UserPreference,
    ]),
    CurrenciesModule,
    ActionHistoryModule,
  ],
  providers: [InvestmentReportsService, InvestmentReportDataService],
  controllers: [InvestmentReportsController],
  exports: [InvestmentReportsService],
})
export class InvestmentReportsModule {}
