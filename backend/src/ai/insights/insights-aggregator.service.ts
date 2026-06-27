import { Injectable, Logger } from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { Repository } from "typeorm";
import { Transaction } from "../../transactions/entities/transaction.entity";
import { ScheduledTransaction } from "../../scheduled-transactions/entities/scheduled-transaction.entity";
import { TransactionAnalyticsService } from "../../transactions/transaction-analytics.service";
import { RecurringCharge } from "../../transactions/recurring-charges.util";

export interface CategorySpending {
  categoryName: string;
  categoryId: string | null;
  currentMonthTotal: number;
  previousMonthTotal: number;
  averageMonthlyTotal: number;
  monthCount: number;
  transactionCount: number;
}

export interface MonthlySpending {
  month: string;
  total: number;
  categoryBreakdown: Array<{
    categoryName: string;
    total: number;
  }>;
}

export { RecurringCharge };

export interface SpendingAggregates {
  categorySpending: CategorySpending[];
  monthlySpending: MonthlySpending[];
  recurringCharges: RecurringCharge[];
  totalSpendingCurrentMonth: number;
  totalSpendingPreviousMonth: number;
  averageMonthlySpending: number;
  daysElapsedInMonth: number;
  daysInMonth: number;
  currency: string;
}

@Injectable()
export class InsightsAggregatorService {
  private readonly logger = new Logger(InsightsAggregatorService.name);

  constructor(
    @InjectRepository(Transaction)
    private readonly transactionRepo: Repository<Transaction>,
    @InjectRepository(ScheduledTransaction)
    private readonly scheduledTransactionRepo: Repository<ScheduledTransaction>,
    private readonly transactionAnalytics: TransactionAnalyticsService,
  ) {}

  async computeAggregates(
    userId: string,
    currency: string,
  ): Promise<SpendingAggregates> {
    const now = new Date();
    const currentMonthStart = new Date(now.getFullYear(), now.getMonth(), 1)
      .toISOString()
      .substring(0, 10);
    const sixMonthsAgo = new Date(now.getFullYear(), now.getMonth() - 6, 1)
      .toISOString()
      .substring(0, 10);
    const today = now.toISOString().substring(0, 10);

    const [categorySpending, monthlySpending, recurringCharges] =
      await Promise.all([
        this.getCategorySpending(
          userId,
          sixMonthsAgo,
          today,
          currentMonthStart,
        ),
        this.getMonthlySpending(userId, sixMonthsAgo, today),
        this.transactionAnalytics.getRecurringCharges(
          userId,
          sixMonthsAgo,
          today,
        ),
      ]);

    const currentMonth = monthlySpending.find(
      (m) => m.month === currentMonthStart.substring(0, 7),
    );
    const previousMonthDate = new Date(
      now.getFullYear(),
      now.getMonth() - 1,
      1,
    );
    const previousMonthKey = `${previousMonthDate.getFullYear()}-${String(previousMonthDate.getMonth() + 1).padStart(2, "0")}`;
    const previousMonth = monthlySpending.find(
      (m) => m.month === previousMonthKey,
    );

    const totalSpendingCurrentMonth = currentMonth?.total ?? 0;
    const totalSpendingPreviousMonth = previousMonth?.total ?? 0;

    const completedMonths = monthlySpending.filter(
      (m) => m.month !== currentMonthStart.substring(0, 7),
    );
    const averageMonthlySpending =
      completedMonths.length > 0
        ? completedMonths.reduce((sum, m) => sum + m.total, 0) /
          completedMonths.length
        : 0;

    const daysElapsedInMonth = now.getDate();
    const daysInMonth = new Date(
      now.getFullYear(),
      now.getMonth() + 1,
      0,
    ).getDate();

    return {
      categorySpending,
      monthlySpending,
      recurringCharges,
      totalSpendingCurrentMonth,
      totalSpendingPreviousMonth,
      averageMonthlySpending,
      daysElapsedInMonth,
      daysInMonth,
      currency,
    };
  }

  private async getCategorySpending(
    userId: string,
    startDate: string,
    endDate: string,
    currentMonthStart: string,
  ): Promise<CategorySpending[]> {
    const now = new Date();
    const previousMonthStart = new Date(
      now.getFullYear(),
      now.getMonth() - 1,
      1,
    )
      .toISOString()
      .substring(0, 10);
    const previousMonthEnd = new Date(now.getFullYear(), now.getMonth(), 0)
      .toISOString()
      .substring(0, 10);

    const rows = await this.transactionRepo
      .createQueryBuilder("t")
      .innerJoin("t.category", "cat")
      .select("cat.name", "categoryName")
      .addSelect("cat.id", "categoryId")
      .addSelect("SUM(ABS(t.amount))", "total")
      .addSelect("COUNT(*)", "txnCount")
      .addSelect(
        `SUM(CASE WHEN t.transactionDate >= :currentMonthStart THEN ABS(t.amount) ELSE 0 END)`,
        "currentMonthTotal",
      )
      .addSelect(
        `SUM(CASE WHEN t.transactionDate >= :previousMonthStart AND t.transactionDate <= :previousMonthEnd THEN ABS(t.amount) ELSE 0 END)`,
        "previousMonthTotal",
      )
      .addSelect(
        `COUNT(DISTINCT TO_CHAR(t.transactionDate, 'YYYY-MM'))`,
        "monthCount",
      )
      .where("t.userId = :userId", { userId })
      .andWhere("t.transactionDate >= :startDate", { startDate })
      .andWhere("t.transactionDate <= :endDate", { endDate })
      .andWhere("t.amount < 0")
      .andWhere("t.status != 'VOID'")
      .andWhere("t.isTransfer = false")
      .andWhere("t.parentTransactionId IS NULL")
      .setParameter("currentMonthStart", currentMonthStart)
      .setParameter("previousMonthStart", previousMonthStart)
      .setParameter("previousMonthEnd", previousMonthEnd)
      .groupBy("cat.id")
      .addGroupBy("cat.name")
      .orderBy("total", "DESC")
      .getRawMany();

    return rows.map((r) => ({
      categoryName: r.categoryName,
      categoryId: r.categoryId || null,
      currentMonthTotal: Number(r.currentMonthTotal) || 0,
      previousMonthTotal: Number(r.previousMonthTotal) || 0,
      averageMonthlyTotal:
        Number(r.monthCount) > 0 ? Number(r.total) / Number(r.monthCount) : 0,
      monthCount: Number(r.monthCount),
      transactionCount: Number(r.txnCount),
    }));
  }

  private async getMonthlySpending(
    userId: string,
    startDate: string,
    endDate: string,
  ): Promise<MonthlySpending[]> {
    const rows = await this.transactionRepo
      .createQueryBuilder("t")
      .innerJoin("t.category", "cat")
      .select("TO_CHAR(t.transactionDate, 'YYYY-MM')", "month")
      .addSelect("cat.name", "categoryName")
      .addSelect("SUM(ABS(t.amount))", "total")
      .where("t.userId = :userId", { userId })
      .andWhere("t.transactionDate >= :startDate", { startDate })
      .andWhere("t.transactionDate <= :endDate", { endDate })
      .andWhere("t.amount < 0")
      .andWhere("t.status != 'VOID'")
      .andWhere("t.isTransfer = false")
      .andWhere("t.parentTransactionId IS NULL")
      .groupBy("TO_CHAR(t.transactionDate, 'YYYY-MM')")
      .addGroupBy("cat.name")
      .orderBy("month", "ASC")
      .getRawMany();

    const monthMap = new Map<
      string,
      { total: number; breakdown: Map<string, number> }
    >();

    for (const row of rows) {
      const existing = monthMap.get(row.month) || {
        total: 0,
        breakdown: new Map<string, number>(),
      };
      const amount = Number(row.total);
      existing.total += amount;
      existing.breakdown.set(
        row.categoryName,
        (existing.breakdown.get(row.categoryName) || 0) + amount,
      );
      monthMap.set(row.month, existing);
    }

    return Array.from(monthMap.entries()).map(([month, data]) => ({
      month,
      total: data.total,
      categoryBreakdown: Array.from(data.breakdown.entries())
        .map(([categoryName, total]) => ({ categoryName, total }))
        .sort((a, b) => b.total - a.total),
    }));
  }
}
