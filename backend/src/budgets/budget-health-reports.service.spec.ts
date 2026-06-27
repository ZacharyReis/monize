import { Test, TestingModule } from "@nestjs/testing";
import { getRepositoryToken } from "@nestjs/typeorm";
import { BudgetHealthReportsService } from "./budget-health-reports.service";
import { BudgetsService } from "./budgets.service";
import { Budget, BudgetType, BudgetStrategy } from "./entities/budget.entity";
import {
  BudgetCategory,
  CategoryGroup,
  RolloverType,
} from "./entities/budget-category.entity";
import { BudgetPeriod, PeriodStatus } from "./entities/budget-period.entity";
import { Transaction } from "../transactions/entities/transaction.entity";
import { TransactionSplit } from "../transactions/entities/transaction-split.entity";

describe("BudgetHealthReportsService", () => {
  let service: BudgetHealthReportsService;
  let periodsRepository: Record<string, jest.Mock>;
  let transactionsRepository: Record<string, jest.Mock>;
  let splitsRepository: Record<string, jest.Mock>;
  let budgetsService: Record<string, jest.Mock>;

  const makeBudgetCategory = (
    overrides: Partial<BudgetCategory> = {},
  ): BudgetCategory =>
    ({
      id: overrides.id ?? "bc-essential",
      budgetId: "budget-1",
      categoryId: overrides.categoryId ?? "cat-1",
      categoryGroup: CategoryGroup.NEED,
      transferAccountId: null,
      isTransfer: false,
      amount: 500,
      isIncome: false,
      rolloverType: RolloverType.NONE,
      rolloverCap: null,
      flexGroup: null,
      alertWarnPercent: 80,
      alertCriticalPercent: 95,
      notes: null,
      sortOrder: 0,
      createdAt: new Date("2026-01-01"),
      updatedAt: new Date("2026-01-01"),
      ...overrides,
    }) as BudgetCategory;

  const mockBudget: Budget = {
    id: "budget-1",
    userId: "user-1",
    name: "Test Budget",
    description: null,
    budgetType: BudgetType.MONTHLY,
    periodStart: "2026-05-01",
    periodEnd: null,
    baseIncome: 5000,
    incomeLinked: false,
    strategy: BudgetStrategy.FIXED,
    isActive: true,
    currencyCode: "USD",
    config: {},
    categories: [
      makeBudgetCategory({
        id: "bc-essential",
        categoryId: "cat-essential",
        categoryGroup: CategoryGroup.NEED,
      }),
      makeBudgetCategory({
        id: "bc-discretionary",
        categoryId: "cat-discretionary",
        categoryGroup: CategoryGroup.WANT,
      }),
    ],
    periods: [],
    createdAt: new Date("2026-01-01"),
    updatedAt: new Date("2026-01-01"),
  } as Budget;

  const createMockQueryBuilder = (overrides = {}) => ({
    select: jest.fn().mockReturnThis(),
    addSelect: jest.fn().mockReturnThis(),
    where: jest.fn().mockReturnThis(),
    andWhere: jest.fn().mockReturnThis(),
    innerJoin: jest.fn().mockReturnThis(),
    groupBy: jest.fn().mockReturnThis(),
    getRawMany: jest.fn().mockResolvedValue([]),
    getRawOne: jest.fn().mockResolvedValue({ total: "0" }),
    ...overrides,
  });

  beforeEach(async () => {
    periodsRepository = {
      find: jest.fn().mockResolvedValue([]),
    };
    transactionsRepository = {
      createQueryBuilder: jest.fn(() => createMockQueryBuilder()),
    };
    splitsRepository = {
      createQueryBuilder: jest.fn(() => createMockQueryBuilder()),
    };
    budgetsService = {
      findOne: jest.fn().mockResolvedValue(mockBudget),
      getSummary: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        BudgetHealthReportsService,
        {
          provide: getRepositoryToken(BudgetPeriod),
          useValue: periodsRepository,
        },
        {
          provide: getRepositoryToken(Transaction),
          useValue: transactionsRepository,
        },
        {
          provide: getRepositoryToken(TransactionSplit),
          useValue: splitsRepository,
        },
        { provide: BudgetsService, useValue: budgetsService },
      ],
    }).compile();

    service = module.get(BudgetHealthReportsService);
  });

  describe("getHealthScore", () => {
    it("returns Excellent (>=90) when all categories are well within budget", async () => {
      budgetsService.getSummary.mockResolvedValue({
        budget: mockBudget,
        categoryBreakdown: [
          {
            budgetCategoryId: "bc-essential",
            categoryId: "cat-essential",
            categoryName: "Rent",
            budgeted: 1000,
            spent: 700,
            percentUsed: 70,
            isIncome: false,
          },
          {
            budgetCategoryId: "bc-discretionary",
            categoryId: "cat-discretionary",
            categoryName: "Dining",
            budgeted: 500,
            spent: 250,
            percentUsed: 50,
            isIncome: false,
          },
        ],
      });

      const result = await service.getHealthScore("user-1", "budget-1");

      expect(result.score).toBeGreaterThanOrEqual(90);
      expect(result.label).toBe("Excellent");
      expect(result.breakdown.baseScore).toBe(100);
      expect(result.breakdown.overBudgetDeductions).toBe(0);
      expect(result.breakdown.underBudgetBonus).toBeGreaterThan(0);
      expect(result.categoryScores).toHaveLength(2);
    });

    it("deducts more from the score for overspending essential categories", async () => {
      budgetsService.getSummary.mockResolvedValue({
        budget: mockBudget,
        categoryBreakdown: [
          {
            budgetCategoryId: "bc-essential",
            categoryId: "cat-essential",
            categoryName: "Rent",
            budgeted: 1000,
            spent: 1500,
            percentUsed: 150,
            isIncome: false,
          },
          {
            budgetCategoryId: "bc-discretionary",
            categoryId: "cat-discretionary",
            categoryName: "Dining",
            budgeted: 500,
            spent: 750,
            percentUsed: 150,
            isIncome: false,
          },
        ],
      });

      const result = await service.getHealthScore("user-1", "budget-1");

      expect(result.breakdown.overBudgetDeductions).toBeGreaterThan(0);
      expect(result.breakdown.essentialWeightPenalty).toBeGreaterThan(0);
      expect(result.score).toBeLessThan(100);
    });

    it("clamps score to a 0-100 range", async () => {
      const massiveOverspend = Array.from({ length: 5 }).map((_, i) => ({
        budgetCategoryId: `bc-${i}`,
        categoryId: `cat-${i}`,
        categoryName: `Cat ${i}`,
        budgeted: 100,
        spent: 1000,
        percentUsed: 1000,
        isIncome: false,
      }));
      budgetsService.getSummary.mockResolvedValue({
        budget: mockBudget,
        categoryBreakdown: massiveOverspend,
      });

      const result = await service.getHealthScore("user-1", "budget-1");

      expect(result.score).toBeGreaterThanOrEqual(0);
      expect(result.score).toBeLessThanOrEqual(100);
    });

    it("ignores income categories and zero-budget categories", async () => {
      budgetsService.getSummary.mockResolvedValue({
        budget: mockBudget,
        categoryBreakdown: [
          {
            budgetCategoryId: "bc-income",
            categoryId: "cat-income",
            categoryName: "Salary",
            budgeted: 5000,
            spent: 5000,
            percentUsed: 100,
            isIncome: true,
          },
          {
            budgetCategoryId: "bc-empty",
            categoryId: "cat-empty",
            categoryName: "Empty",
            budgeted: 0,
            spent: 0,
            percentUsed: 0,
            isIncome: false,
          },
        ],
      });

      const result = await service.getHealthScore("user-1", "budget-1");

      expect(result.categoryScores).toHaveLength(0);
      expect(result.breakdown.overBudgetDeductions).toBe(0);
    });

    it("applies a trend bonus when the latest period spent less of its budget", async () => {
      periodsRepository.find.mockResolvedValue([
        {
          id: "p-latest",
          budgetId: "budget-1",
          status: PeriodStatus.CLOSED,
          totalBudgeted: 1000,
          actualExpenses: 600,
          periodStart: "2026-04-01",
        },
        {
          id: "p-previous",
          budgetId: "budget-1",
          status: PeriodStatus.CLOSED,
          totalBudgeted: 1000,
          actualExpenses: 950,
          periodStart: "2026-03-01",
        },
      ]);
      budgetsService.getSummary.mockResolvedValue({
        budget: mockBudget,
        categoryBreakdown: [],
      });

      const result = await service.getHealthScore("user-1", "budget-1");

      expect(result.breakdown.trendBonus).toBeGreaterThan(0);
    });
  });

  describe("getHealthScoreHistory", () => {
    it("returns an empty array when no periods exist", async () => {
      periodsRepository.find.mockResolvedValue([]);
      const result = await service.getHealthScoreHistory(
        "user-1",
        "budget-1",
        6,
      );
      expect(result).toEqual([]);
    });

    it("returns a score per closed period in chronological order", async () => {
      periodsRepository.find.mockResolvedValue([
        {
          id: "p1",
          budgetId: "budget-1",
          status: PeriodStatus.CLOSED,
          periodStart: "2026-01-01",
          periodEnd: "2026-01-31",
          periodCategories: [
            {
              categoryId: "cat-essential",
              budgetedAmount: 1000,
              actualAmount: 600,
              budgetCategory: {
                id: "bc-essential",
                isIncome: false,
                categoryGroup: CategoryGroup.NEED,
              },
            },
          ],
        },
        {
          id: "p2",
          budgetId: "budget-1",
          status: PeriodStatus.CLOSED,
          periodStart: "2026-02-01",
          periodEnd: "2026-02-28",
          periodCategories: [
            {
              categoryId: "cat-essential",
              budgetedAmount: 1000,
              actualAmount: 1500,
              budgetCategory: {
                id: "bc-essential",
                isIncome: false,
                categoryGroup: CategoryGroup.NEED,
              },
            },
          ],
        },
      ]);

      const result = await service.getHealthScoreHistory(
        "user-1",
        "budget-1",
        12,
      );

      expect(result).toHaveLength(2);
      expect(result[0].month).toContain("Jan");
      expect(result[1].month).toContain("Feb");
      // First period was under, second was over -> first should be higher
      expect(result[0].score).toBeGreaterThan(result[1].score);
      expect(["Excellent", "Good", "Needs Attention", "Off Track"]).toContain(
        result[0].label,
      );
    });

    it("queries transactions for OPEN periods rather than using stored actuals", async () => {
      const qb = createMockQueryBuilder({
        getRawOne: jest.fn().mockResolvedValue({ total: "-1200" }),
      });
      transactionsRepository.createQueryBuilder.mockReturnValue(qb);
      splitsRepository.createQueryBuilder.mockReturnValue(
        createMockQueryBuilder({
          getRawOne: jest.fn().mockResolvedValue({ total: "0" }),
        }),
      );

      periodsRepository.find.mockResolvedValue([
        {
          id: "p-open",
          budgetId: "budget-1",
          status: PeriodStatus.OPEN,
          periodStart: "2026-05-01",
          periodEnd: "2026-05-31",
          periodCategories: [
            {
              categoryId: "cat-essential",
              budgetedAmount: 1000,
              actualAmount: 0,
              budgetCategory: {
                id: "bc-essential",
                isIncome: false,
                categoryGroup: CategoryGroup.NEED,
              },
            },
          ],
        },
      ]);

      const result = await service.getHealthScoreHistory(
        "user-1",
        "budget-1",
        1,
      );

      expect(transactionsRepository.createQueryBuilder).toHaveBeenCalled();
      expect(result).toHaveLength(1);
      expect(result[0].score).toBeLessThan(100);
    });
  });

  describe("getSavingsRate", () => {
    it("returns one entry per month requested", async () => {
      const result = await service.getSavingsRate("user-1", "budget-1", 3);
      expect(result).toHaveLength(3);
    });

    it("computes savings rate as (income - expenses) / income * 100", async () => {
      transactionsRepository.createQueryBuilder.mockReturnValue(
        createMockQueryBuilder({
          getRawMany: jest.fn().mockResolvedValue([]),
        }),
      );

      const result = await service.getSavingsRate("user-1", "budget-1", 1);
      // With no transactions, savings rate falls back to 0
      expect(result[0].savingsRate).toBe(0);
      expect(result[0].income).toBe(0);
      expect(result[0].expenses).toBe(0);
    });

    it("rounds money fields to 4dp precision", async () => {
      const result = await service.getSavingsRate("user-1", "budget-1", 1);
      // With no transactions, all monetary fields should be 0
      expect(result[0]).toMatchObject({
        income: 0,
        expenses: 0,
        savings: 0,
        savingsRate: 0,
      });
    });
  });
});
