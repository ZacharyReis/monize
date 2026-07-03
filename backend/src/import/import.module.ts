import { Module, forwardRef } from "@nestjs/common";
import { TypeOrmModule } from "@nestjs/typeorm";
import { ImportController } from "./import.controller";
import { ImportService } from "./import.service";
import { ImportEntityCreatorService } from "./import-entity-creator.service";
import { ImportInvestmentProcessorService } from "./import-investment-processor.service";
import { ImportRegularProcessorService } from "./import-regular-processor.service";
import { Transaction } from "../transactions/entities/transaction.entity";
import { TransactionSplit } from "../transactions/entities/transaction-split.entity";
import { Account } from "../accounts/entities/account.entity";
import { Category } from "../categories/entities/category.entity";
import { Payee } from "../payees/entities/payee.entity";
import { Security } from "../securities/entities/security.entity";
import { InvestmentTransaction } from "../securities/entities/investment-transaction.entity";
import { Holding } from "../securities/entities/holding.entity";
import { ImportColumnMapping } from "./entities/import-column-mapping.entity";
import { ImportMatchCandidate } from "./entities/import-match-candidate.entity";
import { ImportMatchService } from "./import-match.service";
import { ImportMatchController } from "./import-match.controller";
import { NetWorthModule } from "../net-worth/net-worth.module";
import { SecuritiesModule } from "../securities/securities.module";
import { CurrenciesModule } from "../currencies/currencies.module";
import { TransactionsModule } from "../transactions/transactions.module";
import { AccountsModule } from "../accounts/accounts.module";

@Module({
  imports: [
    TypeOrmModule.forFeature([
      Transaction,
      TransactionSplit,
      Account,
      Category,
      Payee,
      Security,
      InvestmentTransaction,
      Holding,
      ImportColumnMapping,
      ImportMatchCandidate,
    ]),
    forwardRef(() => NetWorthModule),
    forwardRef(() => SecuritiesModule),
    forwardRef(() => CurrenciesModule),
    forwardRef(() => TransactionsModule),
    forwardRef(() => AccountsModule),
  ],
  controllers: [ImportController, ImportMatchController],
  providers: [
    ImportService,
    ImportEntityCreatorService,
    ImportInvestmentProcessorService,
    ImportRegularProcessorService,
    ImportMatchService,
  ],
  exports: [ImportService],
})
export class ImportModule {}
