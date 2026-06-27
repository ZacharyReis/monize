import { TestingModule } from "@nestjs/testing";
import { DataSource } from "typeorm";
import { InvestmentTransactionsService } from "@/securities/investment-transactions.service";
import { SecuritiesModule } from "@/securities/securities.module";
import { SecuritiesService } from "@/securities/securities.service";
import { HoldingsService } from "@/securities/holdings.service";
import {
  Account,
  AccountSubType,
  AccountType,
} from "@/accounts/entities/account.entity";
import { Transaction } from "@/transactions/entities/transaction.entity";
import {
  InvestmentTransaction,
  InvestmentAction,
} from "@/securities/entities/investment-transaction.entity";
import {
  createIntegrationModule,
  cleanTables,
  createTestUserDirect,
} from "../helpers/integration-setup";
import { createTestAccount } from "../helpers/test-factories";

/**
 * End-to-end coverage for transferring a security between two brokerage
 * accounts. The original cost basis (1.67/share) must follow the shares to
 * the destination so gain/profit reporting stays correct, and the two legs
 * are linked so editing or deleting one cascades to the other.
 */
describe("Security transfer between accounts (integration)", () => {
  let module: TestingModule;
  let service: InvestmentTransactionsService;
  let holdingsService: HoldingsService;
  let dataSource: DataSource;
  let userId: string;
  let brokerageA: string;
  let brokerageB: string;
  let securityId: string;

  const qty = (h: { quantity: number } | null) => Number(h?.quantity ?? 0);

  beforeAll(async () => {
    module = await createIntegrationModule([SecuritiesModule]);
    service = module.get(InvestmentTransactionsService);
    holdingsService = module.get(HoldingsService);
    dataSource = module.get(DataSource);
  });

  afterAll(async () => {
    await module.close();
  });

  beforeEach(async () => {
    await cleanTables(dataSource, [
      "action_history",
      "holdings",
      "securities",
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
    await dataSource.query(
      `INSERT INTO currencies (code, name, symbol, decimal_places) VALUES ('USD', 'US Dollar', '$', 2) ON CONFLICT DO NOTHING`,
    );

    const user = await createTestUserDirect(dataSource);
    userId = user.id;

    const a = await createTestAccount(dataSource, userId, {
      name: "Brokerage A",
      openingBalance: 0,
      currentBalance: 0,
    });
    await dataSource.manager.update(Account, a.id, {
      accountType: AccountType.INVESTMENT,
      accountSubType: AccountSubType.INVESTMENT_BROKERAGE,
    });
    brokerageA = a.id;

    const b = await createTestAccount(dataSource, userId, {
      name: "Brokerage B",
      openingBalance: 0,
      currentBalance: 0,
    });
    await dataSource.manager.update(Account, b.id, {
      accountType: AccountType.INVESTMENT,
      accountSubType: AccountSubType.INVESTMENT_BROKERAGE,
    });
    brokerageB = b.id;

    const securitiesService = module.get(SecuritiesService);
    const security = await securitiesService.create(userId, {
      symbol: "ACME",
      name: "Acme Corp",
      securityType: "STOCK" as any,
      currencyCode: "USD",
    } as any);
    securityId = security.id;
  });

  // Buy 100 shares in Brokerage A at a discounted 1.67/share.
  async function buy100At167() {
    await service.create(userId, {
      accountId: brokerageA,
      action: InvestmentAction.BUY,
      transactionDate: "2026-01-10",
      securityId,
      quantity: 100,
      price: 1.67,
      commission: 0,
    } as any);
  }

  it("carries cost basis to the destination and links the two legs", async () => {
    await buy100At167();
    const cashBefore = await dataSource.manager.count(Transaction, {
      where: { userId },
    });

    const { transferOut, transferIn } = await service.transferSecurity(userId, {
      fromAccountId: brokerageA,
      toAccountId: brokerageB,
      securityId,
      transactionDate: "2026-02-01",
      quantity: 100,
      costPerShare: 1.67,
    });

    // Source emptied, destination holds the shares at the original cost.
    const aHolding = await holdingsService.findByAccountAndSecurity(
      brokerageA,
      securityId,
    );
    const bHolding = await holdingsService.findByAccountAndSecurity(
      brokerageB,
      securityId,
    );
    expect(qty(aHolding)).toBe(0);
    expect(qty(bHolding)).toBe(100);
    expect(Number(bHolding?.averageCost)).toBeCloseTo(1.67, 6);

    // Legs reference each other and create no cash transactions.
    expect(transferOut.linkedTransactionId).toBe(transferIn.id);
    expect(transferIn.linkedTransactionId).toBe(transferOut.id);
    expect(transferOut.transactionId).toBeNull();
    expect(transferIn.transactionId).toBeNull();
    // The transfer itself moves shares only -- no new cash transaction.
    const cashAfter = await dataSource.manager.count(Transaction, {
      where: { userId },
    });
    expect(cashAfter).toBe(cashBefore);
  });

  it("deleting one leg removes both and restores the source holding", async () => {
    await buy100At167();
    const { transferOut, transferIn } = await service.transferSecurity(userId, {
      fromAccountId: brokerageA,
      toAccountId: brokerageB,
      securityId,
      transactionDate: "2026-02-01",
      quantity: 100,
      costPerShare: 1.67,
    });

    // Delete the destination leg; the source leg must go too.
    await service.remove(userId, transferIn.id);

    const remaining = await dataSource.manager.find(InvestmentTransaction, {
      where: { userId, action: InvestmentAction.TRANSFER_OUT },
    });
    expect(remaining).toHaveLength(0);
    const remainingIn = await dataSource.manager.findOne(
      InvestmentTransaction,
      {
        where: { id: transferOut.id },
      },
    );
    expect(remainingIn).toBeNull();

    // Shares are back in A, gone from B.
    const aHolding = await holdingsService.findByAccountAndSecurity(
      brokerageA,
      securityId,
    );
    const bHolding = await holdingsService.findByAccountAndSecurity(
      brokerageB,
      securityId,
    );
    expect(qty(aHolding)).toBe(100);
    expect(qty(bHolding)).toBe(0);
  });

  it("editing the quantity on one leg updates both legs and holdings", async () => {
    await buy100At167();
    const { transferOut, transferIn } = await service.transferSecurity(userId, {
      fromAccountId: brokerageA,
      toAccountId: brokerageB,
      securityId,
      transactionDate: "2026-02-01",
      quantity: 100,
      costPerShare: 1.67,
    });

    // Reduce the transferred quantity by editing the OUT leg.
    await service.update(userId, transferOut.id, { quantity: 60 });

    const outAfter = await dataSource.manager.findOneOrFail(
      InvestmentTransaction,
      { where: { id: transferOut.id } },
    );
    const inAfter = await dataSource.manager.findOneOrFail(
      InvestmentTransaction,
      { where: { id: transferIn.id } },
    );
    expect(Number(outAfter.quantity)).toBe(60);
    expect(Number(inAfter.quantity)).toBe(60);

    // 40 stay in A, 60 land in B, cost basis preserved on both sides.
    const aHolding = await holdingsService.findByAccountAndSecurity(
      brokerageA,
      securityId,
    );
    const bHolding = await holdingsService.findByAccountAndSecurity(
      brokerageB,
      securityId,
    );
    expect(qty(aHolding)).toBe(40);
    expect(qty(bHolding)).toBe(60);
    expect(Number(bHolding?.averageCost)).toBeCloseTo(1.67, 6);
  });

  it("reroutes the destination account when editing a transfer", async () => {
    await buy100At167();
    const { transferOut } = await service.transferSecurity(userId, {
      fromAccountId: brokerageA,
      toAccountId: brokerageB,
      securityId,
      transactionDate: "2026-02-01",
      quantity: 100,
      costPerShare: 1.67,
    });

    // Add a third brokerage and reroute the destination to it.
    const c = await createTestAccount(dataSource, userId, {
      name: "Brokerage C",
      openingBalance: 0,
      currentBalance: 0,
    });
    await dataSource.manager.update(Account, c.id, {
      accountType: AccountType.INVESTMENT,
      accountSubType: AccountSubType.INVESTMENT_BROKERAGE,
    });

    await service.update(userId, transferOut.id, {
      destinationAccountId: c.id,
    });

    // Shares now sit in C, not B; cost basis preserved.
    const bHolding = await holdingsService.findByAccountAndSecurity(
      brokerageB,
      securityId,
    );
    const cHolding = await holdingsService.findByAccountAndSecurity(
      c.id,
      securityId,
    );
    expect(qty(bHolding)).toBe(0);
    expect(qty(cHolding)).toBe(100);
    expect(Number(cHolding?.averageCost)).toBeCloseTo(1.67, 6);
  });

  it("rejects transferring more shares than the source holds", async () => {
    await buy100At167();
    await expect(
      service.transferSecurity(userId, {
        fromAccountId: brokerageA,
        toAccountId: brokerageB,
        securityId,
        transactionDate: "2026-02-01",
        quantity: 150,
        costPerShare: 1.67,
      }),
    ).rejects.toBeDefined();

    // Nothing moved.
    const aHolding = await holdingsService.findByAccountAndSecurity(
      brokerageA,
      securityId,
    );
    expect(qty(aHolding)).toBe(100);
  });
});
