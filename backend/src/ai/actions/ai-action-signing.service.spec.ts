import { ConfigService } from "@nestjs/config";
import { AiActionSigningService } from "./ai-action-signing.service";
import {
  CreateInvestmentTransactionsDescriptor,
  CreateTransactionDescriptor,
} from "./ai-action.types";
import { InvestmentAction } from "../../securities/entities/investment-transaction.entity";

describe("AiActionSigningService", () => {
  let service: AiActionSigningService;

  const baseDescriptor: CreateTransactionDescriptor = {
    type: "create_transaction",
    userId: "user-1",
    actionId: "action-1",
    expiresAt: 1_900_000_000_000,
    accountId: "acc-1",
    amount: -12.5,
    transactionDate: "2026-01-15",
    payeeId: null,
    payeeName: "Starbucks",
    createPayee: true,
    categoryId: "cat-1",
    description: null,
    currencyCode: "USD",
  };

  beforeEach(() => {
    const config = {
      get: jest
        .fn()
        .mockReturnValue("test-secret-key-at-least-32-chars-long!!"),
    } as unknown as ConfigService;
    service = new AiActionSigningService(config);
  });

  it("produces a deterministic signature regardless of key order", () => {
    const sig1 = service.sign(baseDescriptor);
    const reordered = {
      currencyCode: "USD",
      description: null,
      categoryId: "cat-1",
      payeeName: "Starbucks",
      payeeId: null,
      createPayee: true,
      transactionDate: "2026-01-15",
      amount: -12.5,
      accountId: "acc-1",
      expiresAt: 1_900_000_000_000,
      actionId: "action-1",
      userId: "user-1",
      type: "create_transaction",
    } as CreateTransactionDescriptor;
    expect(service.sign(reordered)).toBe(sig1);
  });

  it("verifies a correctly signed descriptor", () => {
    const sig = service.sign(baseDescriptor);
    expect(service.verify(baseDescriptor, sig)).toBe(true);
  });

  it("rejects a tampered amount", () => {
    const sig = service.sign(baseDescriptor);
    expect(service.verify({ ...baseDescriptor, amount: -9999 }, sig)).toBe(
      false,
    );
  });

  it("rejects a descriptor minted for another user (userId binding)", () => {
    const sig = service.sign(baseDescriptor);
    expect(service.verify({ ...baseDescriptor, userId: "user-2" }, sig)).toBe(
      false,
    );
  });

  it("rejects malformed or empty signatures", () => {
    expect(service.verify(baseDescriptor, "")).toBe(false);
    expect(service.verify(baseDescriptor, "not-hex-zz")).toBe(false);
    expect(service.verify(baseDescriptor, "abcd")).toBe(false);
  });

  describe("bulk descriptors", () => {
    const row = (securityId: string) => ({
      accountId: "acc-1",
      action: InvestmentAction.BUY,
      transactionDate: "2026-01-15",
      securityId,
      fundingAccountId: null,
      quantity: 10,
      price: 100,
      commission: 0,
      exchangeRate: 1,
      description: null,
    });
    const bulk: CreateInvestmentTransactionsDescriptor = {
      type: "create_investment_transactions",
      userId: "user-1",
      actionId: "action-9",
      expiresAt: 1_900_000_000_000,
      rows: [row("s1"), row("s2")],
    };

    it("verifies a correctly signed multi-row descriptor", () => {
      const sig = service.sign(bulk);
      expect(service.verify(bulk, sig)).toBe(true);
    });

    it("rejects tampering with one row", () => {
      const sig = service.sign(bulk);
      const tampered: CreateInvestmentTransactionsDescriptor = {
        ...bulk,
        rows: [row("s1"), { ...row("s2"), quantity: 9999 }],
      };
      expect(service.verify(tampered, sig)).toBe(false);
    });

    it("rejects reordering rows (row order is load-bearing)", () => {
      const sig = service.sign(bulk);
      const reordered: CreateInvestmentTransactionsDescriptor = {
        ...bulk,
        rows: [row("s2"), row("s1")],
      };
      expect(service.verify(reordered, sig)).toBe(false);
    });
  });
});
