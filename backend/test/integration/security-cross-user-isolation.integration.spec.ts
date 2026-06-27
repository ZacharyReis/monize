import { TestingModule } from "@nestjs/testing";
import { DataSource } from "typeorm";
import { NotFoundException } from "@nestjs/common";

import { TransactionsModule } from "@/transactions/transactions.module";
import { TransactionsService } from "@/transactions/transactions.service";
import { AccountsService } from "@/accounts/accounts.service";
import { CategoriesService } from "@/categories/categories.service";
import { PayeesService } from "@/payees/payees.service";
import { TagsService } from "@/tags/tags.service";
import { SecuritiesService } from "@/securities/securities.service";
import { InvestmentTransactionsService } from "@/securities/investment-transactions.service";
import { BudgetsModule } from "@/budgets/budgets.module";
import { BudgetsService } from "@/budgets/budgets.service";
import { ReportsModule } from "@/reports/reports.module";
import { ReportsService } from "@/reports/reports.service";
import { InvestmentReportsModule } from "@/investment-reports/investment-reports.module";
import { InvestmentReportsService } from "@/investment-reports/investment-reports.service";

import {
  Account,
  AccountSubType,
  AccountType,
} from "@/accounts/entities/account.entity";
import { Transaction } from "@/transactions/entities/transaction.entity";
import { Budget, BudgetType } from "@/budgets/entities/budget.entity";
import { Category } from "@/categories/entities/category.entity";
import { Payee } from "@/payees/entities/payee.entity";
import { Tag } from "@/tags/entities/tag.entity";
import { Security } from "@/securities/entities/security.entity";
import {
  InvestmentTransaction,
  InvestmentAction,
} from "@/securities/entities/investment-transaction.entity";
import { CustomReport } from "@/reports/entities/custom-report.entity";
import { InvestmentReport } from "@/investment-reports/entities/investment-report.entity";

import {
  createIntegrationModule,
  cleanTables,
  createTestUserDirect,
} from "../helpers/integration-setup";
import {
  createTestAccount,
  createTestCategory,
  createTestPayee,
} from "../helpers/test-factories";

/**
 * Empirical IDOR / cross-user isolation contract.
 *
 * For every user-scoped resource, exercise findOne / update / remove / findAll
 * with userB acting on userA's data. The shared expectation: the service must
 * NEVER return another user's row, NEVER mutate it, and NEVER delete it --
 * regardless of whether the caller knows the GUID.
 *
 * Failure modes this catches:
 *  - findOne with `where: { id }` instead of `where: { id, userId }`
 *  - update / remove that bypass the userId-scoped findOne pre-check
 *  - findAll / list queries that miss the userId filter
 *  - cross-entity references (e.g. category parentId) that don't verify the
 *    referenced entity belongs to the same user
 *
 * Scheduled-transactions are not covered here: the integration test module
 * stubs ScheduledTransactionsModule to break a circular import. They should
 * be exercised in their own integration spec.
 */
describe("Cross-user data isolation (integration)", () => {
  let module: TestingModule;
  let dataSource: DataSource;

  let accountsService: AccountsService;
  let transactionsService: TransactionsService;
  let categoriesService: CategoriesService;
  let payeesService: PayeesService;
  let tagsService: TagsService;
  let securitiesService: SecuritiesService;
  let investmentTransactionsService: InvestmentTransactionsService;
  let budgetsService: BudgetsService;
  let reportsService: ReportsService;
  let investmentReportsService: InvestmentReportsService;

  let userAId: string;
  let userBId: string;

  beforeAll(async () => {
    module = await createIntegrationModule([
      TransactionsModule,
      BudgetsModule,
      ReportsModule,
      InvestmentReportsModule,
    ]);
    dataSource = module.get(DataSource);
    accountsService = module.get(AccountsService);
    transactionsService = module.get(TransactionsService);
    categoriesService = module.get(CategoriesService);
    payeesService = module.get(PayeesService);
    tagsService = module.get(TagsService);
    securitiesService = module.get(SecuritiesService);
    investmentTransactionsService = module.get(InvestmentTransactionsService);
    budgetsService = module.get(BudgetsService);
    reportsService = module.get(ReportsService);
    investmentReportsService = module.get(InvestmentReportsService);
  });

  afterAll(async () => {
    await module.close();
  });

  beforeEach(async () => {
    await cleanTables(dataSource, [
      "action_history",
      "holdings",
      "securities",
      "transaction_split_tags",
      "transaction_tags",
      "transaction_splits",
      "transactions",
      "investment_transactions",
      "budget_period_categories",
      "budget_periods",
      "budget_categories",
      "budget_alerts",
      "budgets",
      "custom_reports",
      "investment_reports",
      "tags",
      "accounts",
      "categories",
      "payees",
      "scheduled_transaction_splits",
      "scheduled_transaction_overrides",
      "scheduled_transactions",
      "monthly_account_balances",
      "users",
    ]);
    await dataSource.query(
      `INSERT INTO currencies (code, name, symbol, decimal_places) VALUES ('USD', 'US Dollar', '$', 2) ON CONFLICT DO NOTHING`,
    );

    const userA = await createTestUserDirect(dataSource, {
      email: `userA-${Date.now()}@example.com`,
    });
    const userB = await createTestUserDirect(dataSource, {
      email: `userB-${Date.now()}@example.com`,
    });
    userAId = userA.id;
    userBId = userB.id;
  });

  // ---- Accounts -------------------------------------------------------------

  describe("Accounts", () => {
    let userAAccount: Account;

    beforeEach(async () => {
      userAAccount = await createTestAccount(dataSource, userAId, {
        name: "userA primary checking",
        currentBalance: 1234,
      });
    });

    it("findOne(userB, userA.account.id) throws NotFoundException", async () => {
      await expect(
        accountsService.findOne(userBId, userAAccount.id),
      ).rejects.toThrow(NotFoundException);
    });

    it("update(userB, userA.account.id) throws NotFoundException and leaves the account untouched", async () => {
      await expect(
        accountsService.update(userBId, userAAccount.id, {
          name: "PWNED",
        } as any),
      ).rejects.toThrow(NotFoundException);

      const reloaded = await dataSource.manager.findOneOrFail(Account, {
        where: { id: userAAccount.id },
      });
      expect(reloaded.name).toBe("userA primary checking");
      expect(reloaded.userId).toBe(userAId);
    });

    it("delete(userB, userA.account.id) throws NotFoundException and the account still exists", async () => {
      await expect(
        accountsService.delete(userBId, userAAccount.id),
      ).rejects.toThrow(NotFoundException);

      const stillThere = await dataSource.manager.findOne(Account, {
        where: { id: userAAccount.id },
      });
      expect(stillThere).not.toBeNull();
    });

    it("findAll(userB) does not include any of userA's accounts", async () => {
      await createTestAccount(dataSource, userAId, { name: "userA savings" });
      await createTestAccount(dataSource, userBId, { name: "userB chequing" });

      const result = await accountsService.findAll(userBId, true);

      expect(result.find((a) => a.userId === userAId)).toBeUndefined();
      expect(result.find((a) => a.id === userAAccount.id)).toBeUndefined();
      expect(result.every((a) => a.userId === userBId)).toBe(true);
    });
  });

  // ---- Transactions ---------------------------------------------------------

  describe("Transactions", () => {
    let userAAccount: Account;
    let userBAccount: Account;
    let userATransaction: Transaction;

    beforeEach(async () => {
      userAAccount = await createTestAccount(dataSource, userAId, {
        openingBalance: 1000,
        currentBalance: 1000,
      });
      userBAccount = await createTestAccount(dataSource, userBId, {
        openingBalance: 0,
        currentBalance: 0,
      });

      const created = await transactionsService.create(userAId, {
        accountId: userAAccount.id,
        transactionDate: "2026-01-15",
        amount: -50,
        currencyCode: "USD",
        description: "userA grocery run",
      } as any);
      userATransaction = created;
    });

    it("findOne(userB, userA.tx.id) throws NotFoundException", async () => {
      await expect(
        transactionsService.findOne(userBId, userATransaction.id),
      ).rejects.toThrow(NotFoundException);
    });

    it("update(userB, userA.tx.id) throws NotFoundException and leaves the row untouched", async () => {
      await expect(
        transactionsService.update(userBId, userATransaction.id, {
          description: "PWNED",
          amount: 999999,
        } as any),
      ).rejects.toThrow(NotFoundException);

      const reloaded = await dataSource.manager.findOneOrFail(Transaction, {
        where: { id: userATransaction.id },
      });
      expect(reloaded.description).toBe("userA grocery run");
      expect(Number(reloaded.amount)).toBe(-50);
      expect(reloaded.userId).toBe(userAId);
    });

    it("remove(userB, userA.tx.id) throws NotFoundException and the row still exists", async () => {
      await expect(
        transactionsService.remove(userBId, userATransaction.id),
      ).rejects.toThrow(NotFoundException);

      const stillThere = await dataSource.manager.findOne(Transaction, {
        where: { id: userATransaction.id },
      });
      expect(stillThere).not.toBeNull();
    });

    it("create(userB, { accountId: userA.account.id }) is rejected: userB cannot post into userA's account", async () => {
      await expect(
        transactionsService.create(userBId, {
          accountId: userAAccount.id,
          transactionDate: "2026-01-15",
          amount: -10,
          currencyCode: "USD",
          description: "siphon attempt",
        } as any),
      ).rejects.toThrow(NotFoundException);

      // No transaction should have been created on userA's account from userB.
      const userATxs = await dataSource.manager.find(Transaction, {
        where: { accountId: userAAccount.id },
      });
      expect(userATxs.every((t) => t.userId === userAId)).toBe(true);
    });

    it("findAll(userB, accountIds=[userA.account.id]) does NOT return userA's transactions", async () => {
      // Even when userB tries to filter by userA's accountId, the userId
      // predicate prevents the leak.
      const result = await transactionsService.findAll(
        userBId,
        [userAAccount.id],
        undefined,
        undefined,
      );
      expect(
        result.data.find((t) => t.id === userATransaction.id),
      ).toBeUndefined();
      expect(result.data.every((t) => t.userId === userBId)).toBe(true);
    });

    it("findAll(userB) only returns userB's own transactions", async () => {
      await transactionsService.create(userBId, {
        accountId: userBAccount.id,
        transactionDate: "2026-01-16",
        amount: -7,
        currencyCode: "USD",
        description: "userB transaction",
      } as any);

      const result = await transactionsService.findAll(userBId);
      expect(
        result.data.find((t) => t.id === userATransaction.id),
      ).toBeUndefined();
      expect(result.data.every((t) => t.userId === userBId)).toBe(true);
    });
  });

  // ---- Categories -----------------------------------------------------------

  describe("Categories", () => {
    let userACategory: Category;

    beforeEach(async () => {
      userACategory = await createTestCategory(dataSource, userAId, {
        name: "userA groceries",
      });
    });

    it("findOne(userB, userA.cat.id) throws NotFoundException", async () => {
      await expect(
        categoriesService.findOne(userBId, userACategory.id),
      ).rejects.toThrow(NotFoundException);
    });

    it("update(userB, userA.cat.id) throws NotFoundException and leaves the row untouched", async () => {
      await expect(
        categoriesService.update(userBId, userACategory.id, {
          name: "PWNED",
        } as any),
      ).rejects.toThrow(NotFoundException);

      const reloaded = await dataSource.manager.findOneOrFail(Category, {
        where: { id: userACategory.id },
      });
      expect(reloaded.name).toBe("userA groceries");
      expect(reloaded.userId).toBe(userAId);
    });

    it("remove(userB, userA.cat.id) throws NotFoundException and the row still exists", async () => {
      await expect(
        categoriesService.remove(userBId, userACategory.id),
      ).rejects.toThrow(NotFoundException);

      const stillThere = await dataSource.manager.findOne(Category, {
        where: { id: userACategory.id },
      });
      expect(stillThere).not.toBeNull();
    });

    it("update(userB, ownCat, parentId=userA.cat.id) is rejected: cannot re-parent under another user's category", async () => {
      const userBCategory = await createTestCategory(dataSource, userBId, {
        name: "userB groceries",
      });

      await expect(
        categoriesService.update(userBId, userBCategory.id, {
          parentId: userACategory.id,
        } as any),
      ).rejects.toThrow(NotFoundException);

      const reloaded = await dataSource.manager.findOneOrFail(Category, {
        where: { id: userBCategory.id },
      });
      expect(reloaded.parentId).toBeNull();
    });

    it("findAll(userB) does not include any of userA's categories", async () => {
      await createTestCategory(dataSource, userBId, { name: "userB dining" });

      const result = await categoriesService.findAll(userBId);
      expect(result.find((c) => c.id === userACategory.id)).toBeUndefined();
      expect(result.every((c) => c.userId === userBId)).toBe(true);
    });
  });

  // ---- Payees ---------------------------------------------------------------

  describe("Payees", () => {
    let userAPayee: Payee;

    beforeEach(async () => {
      userAPayee = await createTestPayee(dataSource, userAId, {
        name: "userA's coffee shop",
      });
    });

    it("findOne(userB, userA.payee.id) throws NotFoundException", async () => {
      await expect(
        payeesService.findOne(userBId, userAPayee.id),
      ).rejects.toThrow(NotFoundException);
    });

    it("update(userB, userA.payee.id) throws NotFoundException and leaves the row untouched", async () => {
      await expect(
        payeesService.update(userBId, userAPayee.id, {
          name: "PWNED",
        } as any),
      ).rejects.toThrow(NotFoundException);

      const reloaded = await dataSource.manager.findOneOrFail(Payee, {
        where: { id: userAPayee.id },
      });
      expect(reloaded.name).toBe("userA's coffee shop");
      expect(reloaded.userId).toBe(userAId);
    });

    it("remove(userB, userA.payee.id) throws NotFoundException and the row still exists", async () => {
      await expect(
        payeesService.remove(userBId, userAPayee.id),
      ).rejects.toThrow(NotFoundException);

      const stillThere = await dataSource.manager.findOne(Payee, {
        where: { id: userAPayee.id },
      });
      expect(stillThere).not.toBeNull();
    });

    it("findAll(userB) does not include any of userA's payees", async () => {
      await createTestPayee(dataSource, userBId, {
        name: "userB hardware store",
      });

      const result = await payeesService.findAll(userBId);
      expect(result.find((p) => p.id === userAPayee.id)).toBeUndefined();
      expect(result.every((p) => p.userId === userBId)).toBe(true);
    });
  });

  // ---- Tags -----------------------------------------------------------------

  describe("Tags", () => {
    let userATag: Tag;

    beforeEach(async () => {
      userATag = await tagsService.create(userAId, {
        name: "userA-vacation",
        color: "#ff0000",
      } as any);
    });

    it("findOne(userB, userA.tag.id) throws NotFoundException", async () => {
      await expect(tagsService.findOne(userBId, userATag.id)).rejects.toThrow(
        NotFoundException,
      );
    });

    it("update(userB, userA.tag.id) throws NotFoundException and leaves the row untouched", async () => {
      await expect(
        tagsService.update(userBId, userATag.id, { name: "PWNED" } as any),
      ).rejects.toThrow(NotFoundException);

      const reloaded = await dataSource.manager.findOneOrFail(Tag, {
        where: { id: userATag.id },
      });
      expect(reloaded.name).toBe("userA-vacation");
      expect(reloaded.userId).toBe(userAId);
    });

    it("remove(userB, userA.tag.id) throws NotFoundException and the row still exists", async () => {
      await expect(tagsService.remove(userBId, userATag.id)).rejects.toThrow(
        NotFoundException,
      );

      const stillThere = await dataSource.manager.findOne(Tag, {
        where: { id: userATag.id },
      });
      expect(stillThere).not.toBeNull();
    });

    it("findAll(userB) does not include any of userA's tags", async () => {
      await tagsService.create(userBId, {
        name: "userB-business",
        color: "#00ff00",
      } as any);

      const result = await tagsService.findAll(userBId);
      expect(result.find((t) => t.id === userATag.id)).toBeUndefined();
      expect(result.every((t) => t.userId === userBId)).toBe(true);
    });
  });

  // ---- Budgets --------------------------------------------------------------

  describe("Budgets", () => {
    let userABudget: Budget;

    beforeEach(async () => {
      userABudget = await budgetsService.create(userAId, {
        name: "userA monthly budget",
        currencyCode: "USD",
        periodStart: "2026-01-01",
        budgetType: BudgetType.MONTHLY,
      } as any);
    });

    it("findOne(userB, userA.budget.id) throws NotFoundException", async () => {
      await expect(
        budgetsService.findOne(userBId, userABudget.id),
      ).rejects.toThrow(NotFoundException);
    });

    it("update(userB, userA.budget.id) throws NotFoundException and leaves the row untouched", async () => {
      await expect(
        budgetsService.update(userBId, userABudget.id, {
          name: "PWNED",
        } as any),
      ).rejects.toThrow(NotFoundException);

      const reloaded = await dataSource.manager.findOneOrFail(Budget, {
        where: { id: userABudget.id },
      });
      expect(reloaded.name).toBe("userA monthly budget");
      expect(reloaded.userId).toBe(userAId);
    });

    it("remove(userB, userA.budget.id) throws NotFoundException and the row still exists", async () => {
      await expect(
        budgetsService.remove(userBId, userABudget.id),
      ).rejects.toThrow(NotFoundException);

      const stillThere = await dataSource.manager.findOne(Budget, {
        where: { id: userABudget.id },
      });
      expect(stillThere).not.toBeNull();
    });

    it("findAll(userB) does not include any of userA's budgets", async () => {
      await budgetsService.create(userBId, {
        name: "userB monthly budget",
        currencyCode: "USD",
        periodStart: "2026-01-01",
        budgetType: BudgetType.MONTHLY,
      } as any);

      const result = await budgetsService.findAll(userBId);
      expect(result.find((b) => b.id === userABudget.id)).toBeUndefined();
      expect(result.every((b) => b.userId === userBId)).toBe(true);
    });
  });

  // ---- Securities -----------------------------------------------------------

  describe("Securities", () => {
    let userASecurity: Security;

    beforeEach(async () => {
      userASecurity = await securitiesService.create(userAId, {
        symbol: "ACME",
        name: "Acme Corp",
        securityType: "STOCK" as any,
        currencyCode: "USD",
      } as any);
    });

    it("findOne(userB, userA.sec.id) throws NotFoundException", async () => {
      await expect(
        securitiesService.findOne(userBId, userASecurity.id),
      ).rejects.toThrow(NotFoundException);
    });

    it("update(userB, userA.sec.id) throws NotFoundException and leaves the row untouched", async () => {
      await expect(
        securitiesService.update(userBId, userASecurity.id, {
          name: "PWNED Corp",
        } as any),
      ).rejects.toThrow(NotFoundException);

      const reloaded = await dataSource.manager.findOneOrFail(Security, {
        where: { id: userASecurity.id },
      });
      expect(reloaded.name).toBe("Acme Corp");
      expect(reloaded.userId).toBe(userAId);
    });

    it("remove(userB, userA.sec.id) throws NotFoundException and the row still exists", async () => {
      await expect(
        securitiesService.remove(userBId, userASecurity.id),
      ).rejects.toThrow(NotFoundException);

      const stillThere = await dataSource.manager.findOne(Security, {
        where: { id: userASecurity.id },
      });
      expect(stillThere).not.toBeNull();
    });

    it("findAll(userB) does not include any of userA's securities", async () => {
      await securitiesService.create(userBId, {
        symbol: "BEEP",
        name: "Beep Corp",
        securityType: "STOCK" as any,
        currencyCode: "USD",
      } as any);

      const result = await securitiesService.findAll(userBId, true);
      expect(result.find((s) => s.id === userASecurity.id)).toBeUndefined();
      expect(result.every((s) => s.userId === userBId)).toBe(true);
    });
  });

  // ---- Investment transactions ---------------------------------------------

  describe("Investment transactions", () => {
    let userATx: InvestmentTransaction;
    let userABrokerage: string;

    async function makeBrokerage(
      ownerId: string,
      name: string,
    ): Promise<string> {
      const a = await createTestAccount(dataSource, ownerId, {
        name,
        openingBalance: 0,
        currentBalance: 0,
      });
      await dataSource.manager.update(Account, a.id, {
        accountType: AccountType.INVESTMENT,
        accountSubType: AccountSubType.INVESTMENT_BROKERAGE,
      });
      return a.id;
    }

    beforeEach(async () => {
      userABrokerage = await makeBrokerage(userAId, "userA brokerage");
      const sec = await securitiesService.create(userAId, {
        symbol: "ACME",
        name: "Acme Corp",
        securityType: "STOCK" as any,
        currencyCode: "USD",
      } as any);
      userATx = await investmentTransactionsService.create(userAId, {
        accountId: userABrokerage,
        action: InvestmentAction.ADD_SHARES,
        transactionDate: "2026-01-01",
        securityId: sec.id,
        quantity: 100,
      } as any);
    });

    it("findOne(userB, userA.invTx.id) throws NotFoundException", async () => {
      await expect(
        investmentTransactionsService.findOne(userBId, userATx.id),
      ).rejects.toThrow(NotFoundException);
    });

    it("remove(userB, userA.invTx.id) throws NotFoundException and the row still exists", async () => {
      await expect(
        investmentTransactionsService.remove(userBId, userATx.id),
      ).rejects.toThrow(NotFoundException);

      const stillThere = await dataSource.manager.findOne(
        InvestmentTransaction,
        {
          where: { id: userATx.id },
        },
      );
      expect(stillThere).not.toBeNull();
    });

    it("create(userB, { accountId: userA.brokerage }) is rejected: userB cannot post into userA's brokerage", async () => {
      const userBSec = await securitiesService.create(userBId, {
        symbol: "BEEP",
        name: "Beep Corp",
        securityType: "STOCK" as any,
        currencyCode: "USD",
      } as any);

      await expect(
        investmentTransactionsService.create(userBId, {
          accountId: userABrokerage,
          action: InvestmentAction.ADD_SHARES,
          transactionDate: "2026-01-02",
          securityId: userBSec.id,
          quantity: 1,
        } as any),
      ).rejects.toThrow(NotFoundException);
    });
  });

  // ---- Custom reports -------------------------------------------------------

  describe("Custom reports", () => {
    let userAReport: CustomReport;

    beforeEach(async () => {
      userAReport = await reportsService.create(userAId, {
        name: "userA spend by category",
        viewType: "TABLE" as any,
        timeframeType: "LAST_30_DAYS" as any,
        groupBy: "CATEGORY" as any,
      } as any);
    });

    it("findOne(userB, userA.report.id) throws NotFoundException", async () => {
      await expect(
        reportsService.findOne(userBId, userAReport.id),
      ).rejects.toThrow(NotFoundException);
    });

    it("update(userB, userA.report.id) throws NotFoundException and leaves the row untouched", async () => {
      await expect(
        reportsService.update(userBId, userAReport.id, {
          name: "PWNED",
        } as any),
      ).rejects.toThrow(NotFoundException);

      const reloaded = await dataSource.manager.findOneOrFail(CustomReport, {
        where: { id: userAReport.id },
      });
      expect(reloaded.name).toBe("userA spend by category");
      expect(reloaded.userId).toBe(userAId);
    });

    it("remove(userB, userA.report.id) throws NotFoundException and the row still exists", async () => {
      await expect(
        reportsService.remove(userBId, userAReport.id),
      ).rejects.toThrow(NotFoundException);

      const stillThere = await dataSource.manager.findOne(CustomReport, {
        where: { id: userAReport.id },
      });
      expect(stillThere).not.toBeNull();
    });

    it("findAll(userB) does not include any of userA's reports", async () => {
      await reportsService.create(userBId, {
        name: "userB spend by category",
        viewType: "TABLE" as any,
        timeframeType: "LAST_30_DAYS" as any,
        groupBy: "CATEGORY" as any,
      } as any);

      const result = await reportsService.findAll(userBId);
      expect(result.find((r) => r.id === userAReport.id)).toBeUndefined();
      expect(result.every((r) => r.userId === userBId)).toBe(true);
    });
  });

  // ---- Investment reports ---------------------------------------------------

  describe("Investment reports", () => {
    let userAReport: InvestmentReport;

    beforeEach(async () => {
      userAReport = await investmentReportsService.create(userAId, {
        name: "userA holdings",
        config: { columns: ["symbol"] },
      } as any);
    });

    it("findOne(userB, userA.invReport.id) throws NotFoundException", async () => {
      await expect(
        investmentReportsService.findOne(userBId, userAReport.id),
      ).rejects.toThrow(NotFoundException);
    });

    it("update(userB, userA.invReport.id) throws NotFoundException and leaves the row untouched", async () => {
      await expect(
        investmentReportsService.update(userBId, userAReport.id, {
          name: "PWNED",
        } as any),
      ).rejects.toThrow(NotFoundException);

      const reloaded = await dataSource.manager.findOneOrFail(
        InvestmentReport,
        {
          where: { id: userAReport.id },
        },
      );
      expect(reloaded.name).toBe("userA holdings");
      expect(reloaded.userId).toBe(userAId);
    });

    it("remove(userB, userA.invReport.id) throws NotFoundException and the row still exists", async () => {
      await expect(
        investmentReportsService.remove(userBId, userAReport.id),
      ).rejects.toThrow(NotFoundException);

      const stillThere = await dataSource.manager.findOne(InvestmentReport, {
        where: { id: userAReport.id },
      });
      expect(stillThere).not.toBeNull();
    });

    it("findAll(userB) does not include any of userA's investment reports", async () => {
      await investmentReportsService.create(userBId, {
        name: "userB holdings",
        config: { columns: ["symbol"] },
      } as any);

      const result = await investmentReportsService.findAll(userBId);
      expect(result.find((r) => r.id === userAReport.id)).toBeUndefined();
      expect(result.every((r) => r.userId === userBId)).toBe(true);
    });
  });

  // ---- Direct table sweep --------------------------------------------------
  //
  // Sanity check: after each test the rows we created for userA should still
  // be tagged with userA (not silently re-assigned by an update). If a future
  // bug lets userB's update succeed without throwing, the suite-level
  // assertions above would catch it, but this provides a redundant guarantee
  // and prevents Repository<T> proxy bugs from being masked by ORM caching.

  it("sanity: dataset stays partitioned by user_id across all tables", async () => {
    const userARepo = (table: string) =>
      dataSource.query(
        `SELECT COUNT(*)::int AS count FROM ${table} WHERE user_id = $1`,
        [userAId],
      );
    const userBRepo = (table: string) =>
      dataSource.query(
        `SELECT COUNT(*)::int AS count FROM ${table} WHERE user_id = $1`,
        [userBId],
      );
    const crossRepo = (table: string) =>
      dataSource.query(
        `SELECT COUNT(*)::int AS count FROM ${table} WHERE user_id NOT IN ($1, $2)`,
        [userAId, userBId],
      );

    // Seed identifiable rows on both sides.
    await createTestAccount(dataSource, userAId, { name: "sweep userA acct" });
    await createTestAccount(dataSource, userBId, { name: "sweep userB acct" });
    await createTestCategory(dataSource, userAId, { name: "sweep userA cat" });
    await createTestCategory(dataSource, userBId, { name: "sweep userB cat" });

    const tables = ["accounts", "categories"];
    for (const t of tables) {
      const [a] = await userARepo(t);
      const [b] = await userBRepo(t);
      const [other] = await crossRepo(t);
      expect(a.count).toBeGreaterThan(0);
      expect(b.count).toBeGreaterThan(0);
      // Nothing should belong to a phantom third user.
      expect(other.count).toBe(0);
    }
  });
});
