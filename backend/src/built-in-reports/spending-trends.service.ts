import { Injectable, Logger } from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { Repository } from "typeorm";
import { Transaction } from "../transactions/entities/transaction.entity";
import { Account } from "../accounts/entities/account.entity";
import { Category } from "../categories/entities/category.entity";
import { ScheduledTransaction } from "../scheduled-transactions/entities/scheduled-transaction.entity";
import { ScheduledTransactionSplit } from "../scheduled-transactions/entities/scheduled-transaction-split.entity";
import { UserPreference } from "../users/entities/user-preference.entity";
import { ReportCurrencyService } from "./report-currency.service";
import {
  SpendingTrendsResponse,
  SpendingTrendItem,
} from "./dto/spending-trends.dto";

interface CategorySpendRow {
  category_id: string | null;
  total: string;
}

interface ScheduledRow {
  category_id: string | null;
  frequency: string;
  amount: string;
}

@Injectable()
export class SpendingTrendsService {
  private readonly logger = new Logger(SpendingTrendsService.name);

  constructor(
    @InjectRepository(Transaction)
    private readonly transactionsRepo: Repository<Transaction>,
    @InjectRepository(Account)
    private readonly accountsRepo: Repository<Account>,
    @InjectRepository(Category)
    private readonly categoriesRepo: Repository<Category>,
    @InjectRepository(ScheduledTransaction)
    private readonly scheduledRepo: Repository<ScheduledTransaction>,
    @InjectRepository(ScheduledTransactionSplit)
    private readonly scheduledSplitRepo: Repository<ScheduledTransactionSplit>,
    @InjectRepository(UserPreference)
    private readonly prefsRepo: Repository<UserPreference>,
    private readonly currencyService: ReportCurrencyService,
  ) {}

  async getSpendingTrends(
    userId: string,
    lookbackMonths: number,
    accountId: string,
  ): Promise<SpendingTrendsResponse> {
    // Resolve currency
    const prefs = await this.prefsRepo.findOne({ where: { userId } });
    const currencyCode = prefs?.defaultCurrency || "USD";

    // Determine completed calendar months in lookback window
    const now = new Date();
    const currentMonthStart = new Date(now.getFullYear(), now.getMonth(), 1);
    const windowStart = new Date(currentMonthStart);
    windowStart.setMonth(windowStart.getMonth() - lookbackMonths);
    const startDate = windowStart.toISOString().split("T")[0];
    const endDate = new Date(currentMonthStart.getTime() - 1)
      .toISOString()
      .split("T")[0]; // last day of prev month

    // Count completed months in window
    const monthsUsed = lookbackMonths;

    // Build parameterized account filter
    const accountCondition =
      accountId !== "all" ? "AND t.account_id = $4" : "";
    const scheduledAccountCondition =
      accountId !== "all" ? "AND st.account_id = $2" : "";

    // Base params for historical query: [userId, startDate, endDate, accountId?]
    const histParams: (string | number)[] = [userId, startDate, endDate];
    if (accountId !== "all") histParams.push(accountId);

    // Base params for scheduled queries: [userId, accountId?]
    const schedParams: (string | number)[] = [userId];
    if (accountId !== "all") schedParams.push(accountId);

    // Step 1+2: Historical monthly average per category
    // with NOT EXISTS anti-join excluding parent transactions that match
    // a scheduled expense by (payee_id, rounded abs amount).
    // The NOT EXISTS runs against t.payee_id and t.amount (parent level),
    // so the entire parent transaction (including all splits) is excluded.
    const historicalRows: CategorySpendRow[] =
      await this.transactionsRepo.query(
        `SELECT
          COALESCE(ts.category_id, t.category_id) as category_id,
          SUM(ABS(COALESCE(ts.amount, t.amount))) as total
        FROM transactions t
        LEFT JOIN transaction_splits ts ON ts.transaction_id = t.id
        LEFT JOIN accounts a ON a.id = t.account_id
        WHERE t.user_id = $1
          AND t.transaction_date >= $2
          AND t.transaction_date <= $3
          AND COALESCE(ts.amount, t.amount) < 0
          AND t.is_transfer = false
          AND (t.status IS NULL OR t.status != 'VOID')
          AND t.parent_transaction_id IS NULL
          AND a.account_type != 'INVESTMENT'
          AND a.is_closed = false
          AND (ts.transfer_account_id IS NULL OR ts.id IS NULL)
          ${accountCondition}
          AND NOT EXISTS (
            SELECT 1 FROM scheduled_transactions st
            LEFT JOIN accounts sa ON sa.id = st.account_id
            WHERE st.payee_id = t.payee_id
              AND ROUND(ABS(st.amount)::numeric, 2) = ROUND(ABS(t.amount)::numeric, 2)
              AND st.currency_code = t.currency_code
              AND st.user_id = t.user_id
              AND st.is_active = true
              AND st.is_transfer = false
              AND st.frequency != 'ONCE'
              AND st.amount < 0
              AND (st.occurrences_remaining IS NULL OR st.occurrences_remaining > 0)
              AND (st.end_date IS NULL OR st.end_date >= CURRENT_DATE)
              AND sa.account_type != 'INVESTMENT'
              AND sa.is_closed = false
          )
        GROUP BY COALESCE(ts.category_id, t.category_id)`,
        histParams,
      );

    // Build historical map: categoryId -> monthly average
    const historicalMap = new Map<string | null, number>();
    for (const row of historicalRows) {
      const catId = row.category_id;
      const monthlyAvg = parseFloat(row.total) / monthsUsed;
      historicalMap.set(catId, monthlyAvg);
    }

    // Step 3: Category fallback — scheduled monthly equivalent per category
    // NARROWED: only unsplit scheduled transactions with a real category and no payee
    const scheduledUnsplitRows: ScheduledRow[] =
      await this.transactionsRepo.query(
        `SELECT
          st.category_id,
          st.frequency,
          st.amount
        FROM scheduled_transactions st
        LEFT JOIN accounts a ON a.id = st.account_id
        WHERE st.user_id = $1
          AND st.is_active = true
          AND st.is_split = false
          AND st.is_transfer = false
          AND st.frequency != 'ONCE'
          AND st.payee_id IS NULL
          AND st.category_id IS NOT NULL
          AND st.amount < 0
          AND (st.occurrences_remaining IS NULL OR st.occurrences_remaining > 0)
          AND (st.end_date IS NULL OR st.end_date >= CURRENT_DATE)
          AND a.account_type != 'INVESTMENT'
          AND a.is_closed = false
          ${scheduledAccountCondition}`,
        schedParams,
      );

    // No split fallback — payee-less splits are not eligible (same mismatch problem)

    // Build scheduled map: categoryId -> monthly equivalent (absolute)
    const scheduledMap = new Map<string | null, number>();
    for (const row of scheduledUnsplitRows) {
      const catId = row.category_id;
      const amount = Math.abs(parseFloat(row.amount));
      const monthly = this.toMonthlyEquivalent(amount, row.frequency);
      scheduledMap.set(catId, (scheduledMap.get(catId) || 0) + monthly);
    }

    // Step 4: Compute trend fill per category
    const categoryNames = await this.getCategoryNames(userId);
    const trends: SpendingTrendItem[] = [];

    for (const [catId, monthlyAvg] of historicalMap) {
      const scheduledMonthly = scheduledMap.get(catId) || 0;
      const trendFill = Math.max(0, monthlyAvg - scheduledMonthly);

      if (trendFill > 0.01) {
        trends.push({
          categoryId: catId,
          categoryName: categoryNames.get(catId) || "Uncategorized",
          monthlyAverage: Math.round(monthlyAvg * 100) / 100,
          scheduledMonthly: Math.round(scheduledMonthly * 100) / 100,
          trendFill: Math.round(trendFill * 100) / 100,
          dailyFill: Math.round((trendFill / 30) * 100) / 100,
        });
      }
    }

    // Sort by trendFill descending
    trends.sort((a, b) => b.trendFill - a.trendFill);

    const totalMonthlyFill = trends.reduce((sum, t) => sum + t.trendFill, 0);
    const totalDailyFill = Math.round((totalMonthlyFill / 30) * 100) / 100;

    return {
      trends,
      totalMonthlyFill: Math.round(totalMonthlyFill * 100) / 100,
      totalDailyFill,
      lookbackMonths,
      monthsUsed,
      currencyCode,
    };
  }

  private toMonthlyEquivalent(amount: number, frequency: string): number {
    switch (frequency) {
      case "DAILY":
        return (amount * 365) / 12;
      case "WEEKLY":
        return (amount * 52) / 12;
      case "BIWEEKLY":
        return (amount * 26) / 12;
      case "EVERY4WEEKS":
        return (amount * 13) / 12;
      case "SEMIMONTHLY":
        return amount * 2;
      case "MONTHLY":
        return amount;
      case "QUARTERLY":
        return amount / 3;
      case "YEARLY":
        return amount / 12;
      default:
        return 0;
    }
  }

  private async getCategoryNames(
    userId: string,
  ): Promise<Map<string | null, string>> {
    const categories = await this.categoriesRepo.find({ where: { userId } });
    const map = new Map<string | null, string>();
    for (const cat of categories) {
      map.set(cat.id, cat.name);
    }
    map.set(null, "Uncategorized");
    return map;
  }
}
