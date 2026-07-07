import { TestingModule } from "@nestjs/testing";
import { DataSource } from "typeorm";
import { TransactionsService } from "@/transactions/transactions.service";
import { TransactionsModule } from "@/transactions/transactions.module";
import { TransactionStatus } from "@/transactions/entities/transaction.entity";
import { Account } from "@/accounts/entities/account.entity";
import {
  createIntegrationModule,
  cleanTables,
  createTestUserDirect,
} from "../helpers/integration-setup";
import {
  createTestAccount,
  createTestCategory,
} from "../helpers/test-factories";

describe("TransactionsService (integration)", () => {
  let module: TestingModule;
  let service: TransactionsService;
  let dataSource: DataSource;
  let userId: string;
  let accountId: string;

  beforeAll(async () => {
    module = await createIntegrationModule([TransactionsModule]);
    service = module.get(TransactionsService);
    dataSource = module.get(DataSource);
  });

  afterAll(async () => {
    await module.close();
  });

  beforeEach(async () => {
    await cleanTables(dataSource, [
      "action_history",
      "transaction_splits",
      "transactions",
      "accounts",
      "categories",
      "payees",
      "scheduled_transaction_splits",
      "scheduled_transaction_overrides",
      "scheduled_transactions",
      "investment_transactions",
      "monthly_account_balances",
      "users",
    ]);
    const user = await createTestUserDirect(dataSource);
    userId = user.id;

    const account = await createTestAccount(dataSource, userId, {
      openingBalance: 1000,
      currentBalance: 1000,
    });
    accountId = account.id;
  });

  describe("create()", () => {
    it("should create a transaction and update account balance atomically", async () => {
      const result = await service.create(userId, {
        accountId,
        transactionDate: "2026-01-15",
        amount: -50,
        currencyCode: "USD",
      });

      expect(result.id).toBeDefined();
      expect(Number(result.amount)).toBe(-50);
      expect(result.accountId).toBe(accountId);
      expect(result.status).toBe(TransactionStatus.UNRECONCILED);

      // Verify balance was updated atomically
      const account = await dataSource.manager.findOne(Account, {
        where: { id: accountId },
      });
      expect(account!.currentBalance).toBe(950);
    });

    it("should create a transaction with splits and store split records", async () => {
      const category1 = await createTestCategory(dataSource, userId, {
        name: "Groceries",
      });
      const category2 = await createTestCategory(dataSource, userId, {
        name: "Dining",
      });

      const result = await service.create(userId, {
        accountId,
        transactionDate: "2026-01-15",
        amount: -100,
        currencyCode: "USD",
        isSplit: true,
        splits: [
          { categoryId: category1.id, amount: -60 },
          { categoryId: category2.id, amount: -40 },
        ],
      });

      expect(result.isSplit).toBe(true);
      expect(result.categoryId).toBeNull();
      expect(result.splits).toHaveLength(2);

      const splitAmounts = result.splits
        .map((s) => Number(s.amount))
        .sort((a, b) => a - b);
      expect(splitAmounts).toEqual([-60, -40]);

      // Verify balance updated
      const account = await dataSource.manager.findOne(Account, {
        where: { id: accountId },
      });
      expect(account!.currentBalance).toBe(900);
    });

    it("should NOT update balance when status is VOID", async () => {
      const result = await service.create(userId, {
        accountId,
        transactionDate: "2026-01-15",
        amount: -200,
        currencyCode: "USD",
        status: TransactionStatus.VOID,
      });

      expect(result.status).toBe(TransactionStatus.VOID);

      // Balance should remain unchanged
      const account = await dataSource.manager.findOne(Account, {
        where: { id: accountId },
      });
      expect(account!.currentBalance).toBe(1000);
    });
  });

  describe("update()", () => {
    it("should apply the correct balance delta when amount changes", async () => {
      const tx = await service.create(userId, {
        accountId,
        transactionDate: "2026-01-15",
        amount: -50,
        currencyCode: "USD",
      });

      // Balance is now 950
      const updated = await service.update(userId, tx.id, {
        amount: -80,
      });

      expect(Number(updated.amount)).toBe(-80);

      // Balance should be 1000 - 80 = 920
      const account = await dataSource.manager.findOne(Account, {
        where: { id: accountId },
      });
      expect(account!.currentBalance).toBe(920);
    });

    it("persists excludeFromProjection tri-state and preserves it when the key is absent", async () => {
      const created = await service.create(userId, {
        accountId,
        transactionDate: "2026-03-15",
        amount: -100,
        currencyCode: "USD",
        payeeName: "DebtSettlementCo",
      });

      await service.update(userId, created.id, { excludeFromProjection: true });
      expect(
        (await service.findOne(userId, created.id)).excludeFromProjection,
      ).toBe(true);

      await service.update(userId, created.id, { excludeFromProjection: false });
      expect(
        (await service.findOne(userId, created.id)).excludeFromProjection,
      ).toBe(false);

      // An unrelated update that omits the key must NOT reset the column.
      await service.update(userId, created.id, { description: "unrelated edit" });
      expect(
        (await service.findOne(userId, created.id)).excludeFromProjection,
      ).toBe(false);

      await service.update(userId, created.id, { excludeFromProjection: null });
      expect(
        (await service.findOne(userId, created.id)).excludeFromProjection,
      ).toBeNull();
    });
  });

  describe("remove()", () => {
    it("should reverse the balance and delete the transaction", async () => {
      const tx = await service.create(userId, {
        accountId,
        transactionDate: "2026-01-15",
        amount: -75,
        currencyCode: "USD",
      });

      // Balance is now 925
      await service.remove(userId, tx.id);

      // Balance should be restored to 1000
      const account = await dataSource.manager.findOne(Account, {
        where: { id: accountId },
      });
      expect(account!.currentBalance).toBe(1000);

      // Transaction should no longer exist
      await expect(service.findOne(userId, tx.id)).rejects.toThrow("not found");
    });
  });

  describe("findOne()", () => {
    it("should load relations correctly", async () => {
      const category = await createTestCategory(dataSource, userId, {
        name: "Utilities",
      });

      const tx = await service.create(userId, {
        accountId,
        transactionDate: "2026-01-15",
        amount: -30,
        currencyCode: "USD",
        categoryId: category.id,
        description: "Electric bill",
      });

      const found = await service.findOne(userId, tx.id);

      expect(found.account).toBeDefined();
      expect(found.account.id).toBe(accountId);
      expect(found.category).toBeDefined();
      expect(found.category!.id).toBe(category.id);
      expect(found.category!.name).toBe("Utilities");
      expect(found.description).toBe("Electric bill");
    });
  });
});
