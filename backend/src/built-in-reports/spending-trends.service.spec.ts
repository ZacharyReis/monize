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

  // Query call order:
  // 1. Historical spending (with NOT EXISTS payee+amount exclusion baked in)
  // 2. Unsplit scheduled fallback (category subtraction for payee-less)

  it("returns empty trends when no historical spending", async () => {
    transactionsRepo.query
      .mockResolvedValueOnce([])   // historical (with exclusion)
      .mockResolvedValueOnce([]);  // fallback scheduled

    const result = await service.getSpendingTrends(mockUserId, 3, "all");
    expect(result.trends).toEqual([]);
    expect(result.totalMonthlyFill).toBe(0);
    expect(result.totalDailyFill).toBe(0);
    expect(result.monthsUsed).toBe(3);
    expect(result.currencyCode).toBe("USD");
  });

  it("returns full trend fill for discretionary categories (no scheduled match)", async () => {
    // Historical: Food category, $4500 total over 3 months
    // NOT EXISTS finds no matching scheduled, so Food stays in result
    // No fallback scheduled either
    transactionsRepo.query
      .mockResolvedValueOnce([{ category_id: "cat-food", total: "4500.00" }])
      .mockResolvedValueOnce([]);  // fallback: none

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

  it("excludes categories fully covered by payee+amount match", async () => {
    // NOT EXISTS in historical query already excluded Loan transactions
    // (matched by payee_id + amount against scheduled_transactions).
    // Only Food remains in historical result.
    transactionsRepo.query
      .mockResolvedValueOnce([{ category_id: "cat-food", total: "900.00" }])
      .mockResolvedValueOnce([]);

    categoriesRepo.find.mockResolvedValue([
      { id: "cat-food", userId: mockUserId, name: "Food" },
    ]);

    const result = await service.getSpendingTrends(mockUserId, 3, "all");
    expect(result.trends).toHaveLength(1);
    expect(result.trends[0].categoryName).toBe("Food");
    expect(result.trends[0].monthlyAverage).toBe(300);
  });

  it("applies category fallback for payee-less unsplit scheduled transactions", async () => {
    // Historical has $7500 in Loan over 3 months (not excluded because
    // the historical payee doesn't match any scheduled payee+amount)
    // Fallback: unsplit scheduled monthly $2443.65 in Loan category
    // trendFill = 2500 - 2443.65 = 56.35
    transactionsRepo.query
      .mockResolvedValueOnce([{ category_id: "cat-loan", total: "7500.00" }])
      .mockResolvedValueOnce([
        { category_id: "cat-loan", frequency: "MONTHLY", amount: "-2443.65" },
      ]);

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

  it("returns zero trend fill when fallback scheduled covers historical", async () => {
    transactionsRepo.query
      .mockResolvedValueOnce([{ category_id: "cat-loan", total: "7200.00" }])
      .mockResolvedValueOnce([
        { category_id: "cat-loan", frequency: "MONTHLY", amount: "-2443.65" },
      ]);

    categoriesRepo.find.mockResolvedValue([
      { id: "cat-loan", userId: mockUserId, name: "Loan" },
    ]);

    const result = await service.getSpendingTrends(mockUserId, 3, "all");
    expect(result.trends).toHaveLength(0);
    expect(result.totalMonthlyFill).toBe(0);
  });

  it("handles weekly scheduled frequency conversion correctly", async () => {
    // Historical: $7000 over 3 months = $2333.33/mo
    // Fallback scheduled: weekly $400 = $400 * 52/12 = $1733.33/mo
    // trendFill = 2333.33 - 1733.33 = 600
    transactionsRepo.query
      .mockResolvedValueOnce([{ category_id: "cat-misc", total: "7000.00" }])
      .mockResolvedValueOnce([
        { category_id: "cat-misc", frequency: "WEEKLY", amount: "-400.00" },
      ]);

    categoriesRepo.find.mockResolvedValue([
      { id: "cat-misc", userId: mockUserId, name: "Misc" },
    ]);

    const result = await service.getSpendingTrends(mockUserId, 3, "all");
    expect(result.trends).toHaveLength(1);
    expect(result.trends[0].trendFill).toBeCloseTo(600, 0);
  });

  it("handles uncategorized transactions", async () => {
    transactionsRepo.query
      .mockResolvedValueOnce([{ category_id: null, total: "900.00" }])
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

  it("historical SQL includes NOT EXISTS with required predicates", async () => {
    transactionsRepo.query
      .mockResolvedValueOnce([])   // historical
      .mockResolvedValueOnce([]);  // fallback

    await service.getSpendingTrends(mockUserId, 3, "all");

    // First query is the historical query — verify it has the NOT EXISTS clause
    const historicalSql = transactionsRepo.query.mock.calls[0][0] as string;
    expect(historicalSql).toContain("NOT EXISTS");
    expect(historicalSql).toContain("st.payee_id = t.payee_id");
    expect(historicalSql).toContain("ROUND(ABS(st.amount)::numeric, 2) = ROUND(ABS(t.amount)::numeric, 2)");
    expect(historicalSql).toContain("st.currency_code = t.currency_code");
    expect(historicalSql).toContain("st.amount < 0");
    expect(historicalSql).toContain("st.is_active = true");
    expect(historicalSql).toContain("st.frequency != 'ONCE'");

    // Fallback query should narrow to payee-less, unsplit, categorized, expenses
    const fallbackSql = transactionsRepo.query.mock.calls[1][0] as string;
    expect(fallbackSql).toContain("st.payee_id IS NULL");
    expect(fallbackSql).toContain("st.is_split = false");
    expect(fallbackSql).toContain("st.category_id IS NOT NULL");
    expect(fallbackSql).toContain("st.amount < 0");

    // Should only be 2 queries total (no split scheduled query)
    expect(transactionsRepo.query).toHaveBeenCalledTimes(2);
  });

  it("historical SQL uses parameterized accountId when scoped", async () => {
    transactionsRepo.query
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([]);

    await service.getSpendingTrends(mockUserId, 3, "acct-123");

    const historicalSql = transactionsRepo.query.mock.calls[0][0] as string;
    const historicalParams = transactionsRepo.query.mock.calls[0][1] as string[];

    // accountId should be parameterized, not interpolated
    expect(historicalSql).toContain("t.account_id = $4");
    expect(historicalSql).not.toContain("'acct-123'");
    expect(historicalParams).toContain("acct-123");
  });
});
