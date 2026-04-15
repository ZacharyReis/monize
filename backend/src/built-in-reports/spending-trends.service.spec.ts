import { Test, TestingModule } from "@nestjs/testing";
import { getRepositoryToken } from "@nestjs/typeorm";
import { SpendingTrendsService } from "./spending-trends.service";
import { ReportCurrencyService } from "./report-currency.service";
import { Transaction } from "../transactions/entities/transaction.entity";
import { Account } from "../accounts/entities/account.entity";
import { Category } from "../categories/entities/category.entity";
import { ScheduledTransaction } from "../scheduled-transactions/entities/scheduled-transaction.entity";
import { ScheduledTransactionSplit } from "../scheduled-transactions/entities/scheduled-transaction-split.entity";
import { UserPreference } from "../users/entities/user-preference.entity";

describe("SpendingTrendsService", () => {
  let service: SpendingTrendsService;
  let transactionsRepo: Record<string, jest.Mock>;
  let categoriesRepo: Record<string, jest.Mock>;

  const mockUserId = "user-1";

  beforeEach(async () => {
    transactionsRepo = { query: jest.fn().mockResolvedValue([]) };
    categoriesRepo = { find: jest.fn().mockResolvedValue([]) };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        SpendingTrendsService,
        {
          provide: getRepositoryToken(Transaction),
          useValue: transactionsRepo,
        },
        {
          provide: getRepositoryToken(Account),
          useValue: { find: jest.fn() },
        },
        {
          provide: getRepositoryToken(Category),
          useValue: categoriesRepo,
        },
        {
          provide: getRepositoryToken(ScheduledTransaction),
          useValue: { find: jest.fn() },
        },
        {
          provide: getRepositoryToken(ScheduledTransactionSplit),
          useValue: { find: jest.fn() },
        },
        {
          provide: getRepositoryToken(UserPreference),
          useValue: {
            findOne: jest
              .fn()
              .mockResolvedValue({ defaultCurrency: "USD" }),
          },
        },
        { provide: ReportCurrencyService, useValue: {} },
      ],
    }).compile();

    service = module.get(SpendingTrendsService);
  });

  it("returns empty trends when no historical spending", async () => {
    const result = await service.getSpendingTrends(mockUserId, 3, "all");
    expect(result.trends).toEqual([]);
    expect(result.totalMonthlyFill).toBe(0);
    expect(result.totalDailyFill).toBe(0);
    expect(result.monthsUsed).toBe(3);
    expect(result.currencyCode).toBe("USD");
  });

  it("returns full trend fill when no scheduled transactions match", async () => {
    // First query: historical spending (Food category, $4500 total over 3 months)
    // Second query: unsplit scheduled (none)
    // Third query: split scheduled (none)
    transactionsRepo.query
      .mockResolvedValueOnce([{ category_id: "cat-food", total: "4500.00" }])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([]);

    categoriesRepo.find.mockResolvedValue([
      { id: "cat-food", userId: mockUserId, name: "Food" },
    ]);

    const result = await service.getSpendingTrends(mockUserId, 3, "all");
    expect(result.trends).toHaveLength(1);
    expect(result.trends[0].categoryName).toBe("Food");
    expect(result.trends[0].monthlyAverage).toBe(1500);
    expect(result.trends[0].scheduledMonthly).toBe(0);
    expect(result.trends[0].trendFill).toBe(1500);
    expect(result.trends[0].dailyFill).toBe(50);
  });

  it("deducts scheduled equivalent from historical average", async () => {
    // Historical: Loan category, $7500 total over 3 months = $2500/mo avg
    // Scheduled: monthly $2443.65
    transactionsRepo.query
      .mockResolvedValueOnce([{ category_id: "cat-loan", total: "7500.00" }])
      .mockResolvedValueOnce([
        {
          category_id: "cat-loan",
          frequency: "MONTHLY",
          amount: "-2443.65",
        },
      ])
      .mockResolvedValueOnce([]);

    categoriesRepo.find.mockResolvedValue([
      { id: "cat-loan", userId: mockUserId, name: "Loan" },
    ]);

    const result = await service.getSpendingTrends(mockUserId, 3, "all");
    expect(result.trends).toHaveLength(1);
    expect(result.trends[0].categoryName).toBe("Loan");
    expect(result.trends[0].monthlyAverage).toBe(2500);
    expect(result.trends[0].scheduledMonthly).toBe(2443.65);
    expect(result.trends[0].trendFill).toBe(56.35);
  });

  it("returns zero trend fill when scheduled covers historical", async () => {
    // Historical: $2400/mo, Scheduled: $2443.65/mo — fully covered
    transactionsRepo.query
      .mockResolvedValueOnce([{ category_id: "cat-loan", total: "7200.00" }])
      .mockResolvedValueOnce([
        {
          category_id: "cat-loan",
          frequency: "MONTHLY",
          amount: "-2443.65",
        },
      ])
      .mockResolvedValueOnce([]);

    categoriesRepo.find.mockResolvedValue([
      { id: "cat-loan", userId: mockUserId, name: "Loan" },
    ]);

    const result = await service.getSpendingTrends(mockUserId, 3, "all");
    expect(result.trends).toHaveLength(0);
    expect(result.totalMonthlyFill).toBe(0);
  });

  it("handles weekly scheduled frequency conversion correctly", async () => {
    // Historical: $7000 over 3 months = $2333.33/mo
    // Scheduled: weekly $400 = $400 * 52/12 = $1733.33/mo
    // trendFill = 2333.33 - 1733.33 = 600
    transactionsRepo.query
      .mockResolvedValueOnce([
        { category_id: "cat-income", total: "7000.00" },
      ])
      .mockResolvedValueOnce([
        {
          category_id: "cat-income",
          frequency: "WEEKLY",
          amount: "-400.00",
        },
      ])
      .mockResolvedValueOnce([]);

    categoriesRepo.find.mockResolvedValue([
      { id: "cat-income", userId: mockUserId, name: "Income" },
    ]);

    const result = await service.getSpendingTrends(mockUserId, 3, "all");
    expect(result.trends).toHaveLength(1);
    expect(result.trends[0].trendFill).toBeCloseTo(600, 0);
  });

  it("handles uncategorized transactions", async () => {
    transactionsRepo.query
      .mockResolvedValueOnce([{ category_id: null, total: "900.00" }])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([]);

    categoriesRepo.find.mockResolvedValue([]);

    const result = await service.getSpendingTrends(mockUserId, 3, "all");
    expect(result.trends).toHaveLength(1);
    expect(result.trends[0].categoryName).toBe("Uncategorized");
    expect(result.trends[0].categoryId).toBeNull();
    expect(result.trends[0].monthlyAverage).toBe(300);
  });

  it("sorts trends by trendFill descending", async () => {
    transactionsRepo.query
      .mockResolvedValueOnce([
        { category_id: "cat-a", total: "300.00" },
        { category_id: "cat-b", total: "900.00" },
        { category_id: "cat-c", total: "600.00" },
      ])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([]);

    categoriesRepo.find.mockResolvedValue([
      { id: "cat-a", userId: mockUserId, name: "A" },
      { id: "cat-b", userId: mockUserId, name: "B" },
      { id: "cat-c", userId: mockUserId, name: "C" },
    ]);

    const result = await service.getSpendingTrends(mockUserId, 3, "all");
    expect(result.trends[0].categoryName).toBe("B");
    expect(result.trends[1].categoryName).toBe("C");
    expect(result.trends[2].categoryName).toBe("A");
  });
});
