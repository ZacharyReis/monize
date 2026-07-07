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
  let rowSeq = 0;

  const hist = (
    categoryId: string | null,
    amount: number,
    date = "2026-03-20",
    payeeName: string | null = "Payee",
    excludeFromProjection: boolean | null = null,
    opts: { payeeId?: string | null; isScheduledMatch?: boolean } = {},
  ) => {
    const seq = rowSeq++;
    // Default payee_id is derived from the name so same-name rows share an id
    // (they group together); pass `{ payeeId: null }` to model a description-only
    // / unlinked row that B2 must ignore.
    const payeeId =
      "payeeId" in opts
        ? opts.payeeId
        : payeeName
          ? `pid-${payeeName.trim().toLocaleLowerCase()}`
          : null;
    return {
      row_id: `row-${seq}`,
      transaction_id: `txn-${seq}`,
      transaction_date: date,
      category_id: categoryId,
      amount: amount.toFixed(2),
      payee_name: payeeName,
      payee_id: payeeId,
      exclude_from_projection: excludeFromProjection,
      is_scheduled_match: opts.isScheduledMatch ?? false,
    };
  };

  const monthlyRows = (categoryId: string | null, monthlyAmount: number) => [
    hist(categoryId, monthlyAmount, "2026-01-20"),
    hist(categoryId, monthlyAmount, "2026-02-20"),
    hist(categoryId, monthlyAmount, "2026-03-20"),
  ];

  beforeEach(async () => {
    rowSeq = 0;
    jest.useFakeTimers().setSystemTime(new Date("2026-04-15T12:00:00Z"));
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
            findOne: jest.fn().mockResolvedValue({ defaultCurrency: "USD" }),
          },
        },
        { provide: ReportCurrencyService, useValue: {} },
      ],
    }).compile();

    service = module.get(SpendingTrendsService);
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  // Query call order:
  // 1. Historical spending (with NOT EXISTS payee+amount exclusion baked in)
  // 2. Unsplit scheduled fallback (category subtraction for categorized schedules)

  it("returns empty trends when no historical spending", async () => {
    transactionsRepo.query
      .mockResolvedValueOnce([]) // historical (with exclusion)
      .mockResolvedValueOnce([]); // fallback scheduled

    const result = await service.getSpendingTrends(mockUserId, 3, "all");
    expect(result.trends).toEqual([]);
    expect(result.projectionEvents).toEqual([]);
    expect(result.excludedOutliers).toEqual([]);
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
      .mockResolvedValueOnce(monthlyRows("cat-food", 1500))
      .mockResolvedValueOnce([]); // fallback: none

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
    expect(result.projectionEvents[0]).toEqual(
      expect.objectContaining({
        categoryName: "Food",
        amount: -1500,
        confidence: "medium",
        source: "historical_pattern",
      }),
    );
  });

  it("excludes categories fully covered by payee+amount match", async () => {
    // NOT EXISTS in historical query already excluded Loan transactions
    // (matched by payee_id + amount against scheduled_transactions).
    // Only Food remains in historical result.
    transactionsRepo.query
      .mockResolvedValueOnce(monthlyRows("cat-food", 300))
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
    // Historical has $9000 in Loan over 3 months (not excluded because
    // the historical payee doesn't match any scheduled payee+amount)
    // Fallback: unsplit scheduled monthly $2443.65 in Loan category
    // trendFill = 3000 - 2443.65 = 556.35
    transactionsRepo.query
      .mockResolvedValueOnce(monthlyRows("cat-loan", 3000))
      .mockResolvedValueOnce([
        { category_id: "cat-loan", frequency: "MONTHLY", amount: "-2443.65" },
      ]);

    categoriesRepo.find.mockResolvedValue([
      { id: "cat-loan", userId: mockUserId, name: "Loan" },
    ]);

    const result = await service.getSpendingTrends(mockUserId, 3, "all");
    expect(result.trends).toHaveLength(1);
    expect(result.trends[0].categoryName).toBe("Loan");
    expect(result.trends[0].monthlyAverage).toBe(3000);
    expect(result.trends[0].scheduledMonthly).toBe(2443.65);
    expect(result.trends[0].trendFill).toBe(556.35);
  });

  it("returns zero trend fill when fallback scheduled covers historical", async () => {
    transactionsRepo.query
      .mockResolvedValueOnce(monthlyRows("cat-loan", 2400))
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

  it("suppresses small residual trend fill when scheduled covers at least 90 percent", async () => {
    transactionsRepo.query
      .mockResolvedValueOnce(monthlyRows("cat-utility", 100))
      .mockResolvedValueOnce([
        { category_id: "cat-utility", frequency: "MONTHLY", amount: "-95.00" },
      ]);

    categoriesRepo.find.mockResolvedValue([
      { id: "cat-utility", userId: mockUserId, name: "Utility" },
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
      .mockResolvedValueOnce(monthlyRows("cat-misc", 2333.33))
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
      .mockResolvedValueOnce(monthlyRows(null, 300))
      .mockResolvedValueOnce([]);

    categoriesRepo.find.mockResolvedValue([]);

    const result = await service.getSpendingTrends(mockUserId, 3, "all");
    expect(result.trends).toHaveLength(1);
    expect(result.trends[0].categoryName).toBe("Uncategorized");
    expect(result.trends[0].categoryId).toBeNull();
    expect(result.trends[0].monthlyAverage).toBe(300);
  });

  it("excludes single large historical expenses as one-time outliers", async () => {
    transactionsRepo.query
      .mockResolvedValueOnce([hist("cat-travel", 1200, "2026-03-10", "Hotel")])
      .mockResolvedValueOnce([]);

    categoriesRepo.find.mockResolvedValue([
      { id: "cat-travel", userId: mockUserId, name: "Travel" },
    ]);

    const result = await service.getSpendingTrends(mockUserId, 3, "all");
    expect(result.trends).toHaveLength(0);
    expect(result.totalMonthlyFill).toBe(0);
    expect(result.projectionEvents).toHaveLength(0);
    expect(result.excludedOutliers).toEqual([
      expect.objectContaining({
        categoryName: "Travel",
        amount: 1200,
        payeeName: "Hotel",
        reason: "single_historical_occurrence",
      }),
    ]);
  });

  it("combines duplicate projection events for the same category and date", async () => {
    transactionsRepo.query
      .mockResolvedValueOnce([
        hist("cat-dining", 50, "2026-03-25", "Restaurant"),
        hist("cat-dining", 50, "2026-03-25", "Restaurant"),
        hist("cat-dining", 50, "2026-03-25", "Restaurant"),
        hist("cat-dining", 50, "2026-03-25", "Restaurant"),
        hist("cat-dining", 50, "2026-03-25", "Restaurant"),
        hist("cat-dining", 50, "2026-03-25", "Restaurant"),
      ])
      .mockResolvedValueOnce([]);

    categoriesRepo.find.mockResolvedValue([
      { id: "cat-dining", userId: mockUserId, name: "Dining Out" },
    ]);

    const result = await service.getSpendingTrends(mockUserId, 3, "all", 90);
    const may27Events = result.projectionEvents.filter(
      (event) =>
        event.date === "2026-05-27" && event.categoryName === "Dining Out",
    );

    expect(may27Events).toEqual([
      expect.objectContaining({
        amount: -100,
        categoryName: "Dining Out",
      }),
    ]);
  });

  it("combines projection events with the same displayed category name", async () => {
    transactionsRepo.query
      .mockResolvedValueOnce([
        hist("cat-dining-a", 50, "2026-03-25", "Restaurant"),
        hist("cat-dining-a", 50, "2026-03-25", "Restaurant"),
        hist("cat-dining-a", 50, "2026-03-25", "Restaurant"),
        hist("cat-dining-a", 50, "2026-03-25", "Restaurant"),
        hist("cat-dining-a", 50, "2026-03-25", "Restaurant"),
        hist("cat-dining-a", 50, "2026-03-25", "Restaurant"),
        hist("cat-dining-b", 50, "2026-03-25", "Restaurant"),
        hist("cat-dining-b", 50, "2026-03-25", "Restaurant"),
        hist("cat-dining-b", 50, "2026-03-25", "Restaurant"),
        hist("cat-dining-b", 50, "2026-03-25", "Restaurant"),
        hist("cat-dining-b", 50, "2026-03-25", "Restaurant"),
        hist("cat-dining-b", 50, "2026-03-25", "Restaurant"),
      ])
      .mockResolvedValueOnce([]);

    categoriesRepo.find.mockResolvedValue([
      { id: "cat-dining-a", userId: mockUserId, name: "Dining Out" },
      { id: "cat-dining-b", userId: mockUserId, name: "Dining Out" },
    ]);

    const result = await service.getSpendingTrends(mockUserId, 3, "all", 90);
    const may27Events = result.projectionEvents.filter(
      (event) =>
        event.date === "2026-05-27" && event.categoryName === "Dining Out",
    );

    expect(may27Events).toEqual([
      expect.objectContaining({
        amount: -200,
        categoryName: "Dining Out",
      }),
    ]);
  });

  it("sorts trends by trendFill descending", async () => {
    transactionsRepo.query
      .mockResolvedValueOnce([
        ...monthlyRows("cat-a", 100),
        ...monthlyRows("cat-b", 300),
        ...monthlyRows("cat-c", 200),
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
      .mockResolvedValueOnce([]) // historical
      .mockResolvedValueOnce([]); // fallback

    await service.getSpendingTrends(mockUserId, 3, "all");

    // First query is the historical query — verify it has the NOT EXISTS clause
    const historicalSql = transactionsRepo.query.mock.calls[0][0] as string;
    expect(historicalSql).toContain("NOT EXISTS");
    expect(historicalSql).toContain("st.payee_id = t.payee_id");
    expect(historicalSql).toContain(
      "ROUND(ABS(st.amount)::numeric, 2) = ROUND(ABS(t.amount)::numeric, 2)",
    );
    expect(historicalSql).toContain("st.currency_code = t.currency_code");
    expect(historicalSql).toContain(
      "(st.is_split = true OR st.category_id IS NULL)",
    );
    expect(historicalSql).toContain("st.amount < 0");
    expect(historicalSql).toContain("st.is_active = true");
    expect(historicalSql).toContain("st.frequency != 'ONCE'");

    // Fallback query should narrow to unsplit, categorized, expenses (any payee)
    const fallbackSql = transactionsRepo.query.mock.calls[1][0] as string;
    expect(fallbackSql).not.toContain("st.payee_id IS NULL");
    expect(fallbackSql).toContain("st.is_split = false");
    expect(fallbackSql).toContain("st.category_id IS NOT NULL");
    expect(fallbackSql).toContain("st.amount < 0");

    // Should only be 2 queries total (no split scheduled query)
    expect(transactionsRepo.query).toHaveBeenCalledTimes(2);
  });

  it("historical SQL uses parameterized accountId when scoped", async () => {
    transactionsRepo.query.mockResolvedValueOnce([]).mockResolvedValueOnce([]);

    await service.getSpendingTrends(mockUserId, 3, "acct-123");

    const historicalSql = transactionsRepo.query.mock.calls[0][0] as string;
    const historicalParams = transactionsRepo.query.mock
      .calls[0][1] as string[];

    // accountId should be parameterized, not interpolated
    expect(historicalSql).toContain("t.account_id = $4");
    expect(historicalSql).toContain("st.account_id = $4");
    expect(historicalSql).not.toContain("'acct-123'");
    expect(historicalParams).toContain("acct-123");
  });

  it("historical SQL selects the flag, parent id, and recurrence signals", async () => {
    transactionsRepo.query.mockResolvedValueOnce([]).mockResolvedValueOnce([]);
    await service.getSpendingTrends(mockUserId, 3, "all");
    const sql = transactionsRepo.query.mock.calls[0][0] as string;
    expect(sql).toContain("t.exclude_from_projection");
    expect(sql).toContain("as transaction_id");
    expect(sql).toContain("as payee_id");
    expect(sql).toContain("as is_scheduled_match");
  });

  it("account-scoped historical SQL scopes is_scheduled_match to the account (Wren #1)", async () => {
    transactionsRepo.query.mockResolvedValueOnce([]).mockResolvedValueOnce([]);
    await service.getSpendingTrends(mockUserId, 3, "acct-123");
    const sql = transactionsRepo.query.mock.calls[0][0] as string;
    // the scheduled-match EXISTS must also bind the account param
    expect(sql).toContain("st2.account_id = $4");
  });

  it("all-account historical SQL leaves is_scheduled_match unscoped (no orphan $4)", async () => {
    transactionsRepo.query.mockResolvedValueOnce([]).mockResolvedValueOnce([]);
    await service.getSpendingTrends(mockUserId, 3, "all");
    const sql = transactionsRepo.query.mock.calls[0][0] as string;
    expect(sql).not.toContain("st2.account_id = $4");
  });

  it("outliers carry the parent transactionId", async () => {
    transactionsRepo.query
      .mockResolvedValueOnce([hist("cat-travel", 1200, "2026-03-10", "Hotel")])
      .mockResolvedValueOnce([]);
    categoriesRepo.find.mockResolvedValue([
      { id: "cat-travel", userId: mockUserId, name: "Travel" },
    ]);
    const result = await service.getSpendingTrends(mockUserId, 3, "all");
    expect(result.excludedOutliers[0].transactionId).toMatch(/^txn-/);
  });

  it("excludes a transaction flagged one-time (exclude_from_projection = true)", async () => {
    transactionsRepo.query
      .mockResolvedValueOnce([
        hist("cat-food", 1500, "2026-01-20", "Store", null),
        hist("cat-food", 1500, "2026-02-20", "Store", null),
        hist("cat-food", 5000, "2026-03-20", "Settlement", true),
      ])
      .mockResolvedValueOnce([]);
    categoriesRepo.find.mockResolvedValue([
      { id: "cat-food", userId: mockUserId, name: "Food" },
    ]);
    const result = await service.getSpendingTrends(mockUserId, 3, "all");
    const flagged = result.excludedOutliers.find(
      (o) => o.reason === "marked_one_time",
    );
    expect(flagged?.amount).toBe(5000);
    expect(result.trends[0].monthlyAverage).toBe(1000); // (1500+1500)/3
  });

  it("force-includes a recurring-flagged charge the heuristic would drop (false)", async () => {
    transactionsRepo.query
      .mockResolvedValueOnce([
        hist("cat-x", 200, "2026-01-20", "A", null),
        hist("cat-x", 200, "2026-02-20", "A", null),
        hist("cat-x", 200, "2026-03-05", "A", null),
        hist("cat-x", 5000, "2026-03-20", "BigButRecurring", false),
      ])
      .mockResolvedValueOnce([]);
    categoriesRepo.find.mockResolvedValue([
      { id: "cat-x", userId: mockUserId, name: "X" },
    ]);
    const result = await service.getSpendingTrends(mockUserId, 3, "all");
    expect(result.excludedOutliers).toHaveLength(0);
    expect(result.trends[0].monthlyAverage).toBeCloseTo((600 + 5000) / 3, 2);
  });

  it("defers to the heuristic when the flag is null", async () => {
    transactionsRepo.query
      .mockResolvedValueOnce([
        hist("cat-travel", 1200, "2026-03-10", "Hotel", null),
      ])
      .mockResolvedValueOnce([]);
    categoriesRepo.find.mockResolvedValue([
      { id: "cat-travel", userId: mockUserId, name: "Travel" },
    ]);
    const result = await service.getSpendingTrends(mockUserId, 3, "all");
    expect(result.excludedOutliers[0].reason).toBe(
      "single_historical_occurrence",
    );
  });
});
