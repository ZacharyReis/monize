import { Module, forwardRef } from "@nestjs/common";
import { TypeOrmModule } from "@nestjs/typeorm";
import { LoanRateChange } from "./entities/loan-rate-change.entity";
import { Account } from "../accounts/entities/account.entity";
import { Transaction } from "../transactions/entities/transaction.entity";
import { LoanRateChangesService } from "./loan-rate-changes.service";
import { RateChangeInferenceService } from "./rate-change-inference.service";
import { LoanRateChangesController } from "./loan-rate-changes.controller";
import { LoanPaymentDetectorService } from "../accounts/loan-payment-detector.service";
import { ScheduledTransactionsModule } from "../scheduled-transactions/scheduled-transactions.module";

@Module({
  imports: [
    TypeOrmModule.forFeature([LoanRateChange, Account, Transaction]),
    forwardRef(() => ScheduledTransactionsModule),
  ],
  providers: [
    LoanRateChangesService,
    RateChangeInferenceService,
    // Provided here (not imported from AccountsModule) to avoid a module
    // cycle; the detector only depends on the Account/Transaction repos.
    LoanPaymentDetectorService,
  ],
  controllers: [LoanRateChangesController],
  exports: [LoanRateChangesService],
})
export class LoanRateChangesModule {}
