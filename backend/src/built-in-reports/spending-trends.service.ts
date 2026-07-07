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
  SpendingProjectionEvent,
  SpendingTrendsResponse,
  SpendingTrendItem,
  SpendingTrendOutlier,
} from "./dto/spending-trends.dto";

interface HistoricalSpendRow {
  row_id: string;
  transaction_date: string | Date;
  category_id: string | null;
  amount: string;
  payee_name: string | null;
  transaction_id: string;
  exclude_from_projection: boolean | null;
  payee_id: string | null;
  is_scheduled_match: boolean;
}

interface ScheduledRow {
  category_id: string | null;
  frequency: string;
  amount: string;
}

interface ParsedHistoricalSpend {
  id: string;
  date: string;
  categoryId: string | null;
  amount: number;
  payeeName: string | null;
  transactionId: string;
  excludeFromProjection: boolean | null;
  payeeId: string | null;
  isScheduledMatch: boolean;
}

interface CategoryProjectionStats {
  categoryId: string | null;
  categoryName: string;
  trendFill: number;
  includedRows: ParsedHistoricalSpend[];
  monthsUsed: number;
  confidence: "low" | "medium" | "high";
}

const TREND_COVERAGE_SUPPRESSION_THRESHOLD = 0.9;
const ONE_TIME_EXPENSE_MIN_AMOUNT = 100;
const OUTLIER_MIN_DELTA = 100;
const DEFAULT_FORECAST_DAYS = 365;

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
    forecastDays: number = DEFAULT_FORECAST_DAYS,
  ): Promise<SpendingTrendsResponse> {
    // Resolve currency
    const prefs = await this.prefsRepo.findOne({ where: { userId } });
    const currencyCode = prefs?.defaultCurrency || "USD";

    // Determine completed calendar months in lookback window
    const now = new Date();
    const currentMonthStart = new Date(now.getFullYear(), now.getMonth(), 1);
    const windowStart = new Date(currentMonthStart);
    windowStart.setMonth(windowStart.getMonth() - lookbackMonths);
    const previousMonthEnd = new Date(currentMonthStart);
    previousMonthEnd.setDate(0);
    const startDate = this.formatDateKey(windowStart);
    const endDate = this.formatDateKey(previousMonthEnd);

    // Count completed months in window
    const monthsUsed = lookbackMonths;

    // Build parameterized account filter
    const accountCondition = accountId !== "all" ? "AND t.account_id = $4" : "";
    const scheduledAccountCondition =
      accountId !== "all" ? "AND st.account_id = $2" : "";
    const antiJoinAccountCondition =
      accountId !== "all" ? "AND st.account_id = $4" : "";
    const scheduledMatchAccountCondition =
      accountId !== "all" ? "AND st2.account_id = $4" : "";

    // Base params for historical query: [userId, startDate, endDate, accountId?]
    const histParams: (string | number)[] = [userId, startDate, endDate];
    if (accountId !== "all") histParams.push(accountId);

    // Base params for scheduled queries: [userId, accountId?]
    const schedParams: (string | number)[] = [userId];
    if (accountId !== "all") schedParams.push(accountId);

    // Step 1+2: Historical expense events per category
    // with NOT EXISTS anti-join excluding parent transactions that match
    // a split or uncategorized scheduled expense by (payee_id, rounded abs amount).
    // Unsplit categorized schedules are handled by category fallback below.
    // The NOT EXISTS runs against t.payee_id and t.amount (parent level),
    // so the entire parent transaction (including all splits) is excluded.
    const historicalRows: HistoricalSpendRow[] =
      await this.transactionsRepo.query(
        `SELECT
          COALESCE(ts.id::text, t.id::text) as row_id,
          t.transaction_date,
          COALESCE(ts.category_id, t.category_id) as category_id,
          ABS(COALESCE(ts.amount, t.amount)) as amount,
          COALESCE(p.name, t.payee_name, t.description) as payee_name,
          t.id::text as transaction_id,
          t.exclude_from_projection as exclude_from_projection,
          t.payee_id::text as payee_id,
          EXISTS (
            SELECT 1 FROM scheduled_transactions st2
            LEFT JOIN accounts sa2 ON sa2.id = st2.account_id
            WHERE st2.payee_id = t.payee_id
              AND ROUND(ABS(st2.amount)::numeric, 2) = ROUND(ABS(t.amount)::numeric, 2)
              AND st2.currency_code = t.currency_code
              AND st2.user_id = t.user_id
              AND st2.is_active = true
              AND st2.is_transfer = false
              AND st2.frequency != 'ONCE'
              AND st2.amount < 0
              AND (st2.occurrences_remaining IS NULL OR st2.occurrences_remaining > 0)
              AND (st2.end_date IS NULL OR st2.end_date >= CURRENT_DATE)
              AND sa2.account_type != 'INVESTMENT'
              AND sa2.is_closed = false
              ${scheduledMatchAccountCondition}
          ) as is_scheduled_match
        FROM transactions t
        LEFT JOIN transaction_splits ts ON ts.transaction_id = t.id
        LEFT JOIN accounts a ON a.id = t.account_id
        LEFT JOIN payees p ON p.id = t.payee_id
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
              AND (st.is_split = true OR st.category_id IS NULL)
              AND st.frequency != 'ONCE'
              AND st.amount < 0
              AND (st.occurrences_remaining IS NULL OR st.occurrences_remaining > 0)
              AND (st.end_date IS NULL OR st.end_date >= CURRENT_DATE)
              AND sa.account_type != 'INVESTMENT'
              AND sa.is_closed = false
              ${antiJoinAccountCondition}
          )`,
        histParams,
      );

    // Step 3: Category fallback — scheduled monthly equivalent per category
    // For unsplit scheduled transactions with a real category (any payee status).
    // Splits are excluded — they have the category mismatch that started this fix.
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

    const categoryNames = await this.getCategoryNames(userId);
    const parsedHistoricalRows = this.parseHistoricalRows(historicalRows);
    const { includedRowsByCategory, excludedOutliers } =
      this.filterHistoricalRows(parsedHistoricalRows, categoryNames);

    // Build historical map after one-time/outlier filtering:
    // categoryId -> monthly average
    const historicalMap = new Map<string | null, number>();
    for (const [catId, rows] of includedRowsByCategory) {
      const total = rows.reduce((sum, row) => sum + row.amount, 0);
      historicalMap.set(catId, total / monthsUsed);
    }

    // Step 4: Compute trend fill per category
    const trends: SpendingTrendItem[] = [];
    const projectionStats: CategoryProjectionStats[] = [];

    for (const [catId, monthlyAvg] of historicalMap) {
      const scheduledMonthly = scheduledMap.get(catId) || 0;
      const coverageRatio =
        monthlyAvg > 0 && scheduledMonthly > 0
          ? scheduledMonthly / monthlyAvg
          : 0;
      const trendFill =
        coverageRatio >= TREND_COVERAGE_SUPPRESSION_THRESHOLD
          ? 0
          : Math.max(0, monthlyAvg - scheduledMonthly);

      if (trendFill > 0.01) {
        trends.push({
          categoryId: catId,
          categoryName: categoryNames.get(catId) || "Uncategorized",
          monthlyAverage: Math.round(monthlyAvg * 100) / 100,
          scheduledMonthly: Math.round(scheduledMonthly * 100) / 100,
          trendFill: Math.round(trendFill * 100) / 100,
          dailyFill: Math.round((trendFill / 30) * 100) / 100,
        });
        const includedRows = includedRowsByCategory.get(catId) || [];
        projectionStats.push({
          categoryId: catId,
          categoryName: categoryNames.get(catId) || "Uncategorized",
          trendFill,
          includedRows,
          monthsUsed,
          confidence: this.getConfidence(includedRows, monthsUsed),
        });
      }
    }

    // Sort by trendFill descending
    trends.sort((a, b) => b.trendFill - a.trendFill);

    const totalMonthlyFill = trends.reduce((sum, t) => sum + t.trendFill, 0);
    const totalDailyFill = Math.round((totalMonthlyFill / 30) * 100) / 100;
    const projectionEvents = this.buildProjectionEvents(
      projectionStats,
      forecastDays,
    );

    return {
      trends,
      projectionEvents,
      excludedOutliers,
      totalMonthlyFill: Math.round(totalMonthlyFill * 100) / 100,
      totalDailyFill,
      lookbackMonths,
      monthsUsed,
      currencyCode,
    };
  }

  private parseHistoricalRows(
    rows: HistoricalSpendRow[],
  ): ParsedHistoricalSpend[] {
    return rows
      .map((row) => ({
        id: row.row_id,
        date: this.formatDateKey(this.toLocalDate(row.transaction_date)),
        categoryId: row.category_id,
        amount: Math.abs(parseFloat(row.amount)),
        payeeName: row.payee_name,
        transactionId: row.transaction_id,
        excludeFromProjection: row.exclude_from_projection ?? null,
        payeeId: row.payee_id ?? null,
        isScheduledMatch: !!row.is_scheduled_match,
      }))
      .filter((row) => Number.isFinite(row.amount) && row.amount > 0);
  }

  private filterHistoricalRows(
    rows: ParsedHistoricalSpend[],
    categoryNames: Map<string | null, string>,
  ): {
    includedRowsByCategory: Map<string | null, ParsedHistoricalSpend[]>;
    excludedOutliers: SpendingTrendOutlier[];
  } {
    const grouped = new Map<string | null, ParsedHistoricalSpend[]>();
    for (const row of rows) {
      const existing = grouped.get(row.categoryId) || [];
      existing.push(row);
      grouped.set(row.categoryId, existing);
    }

    const includedRowsByCategory = new Map<
      string | null,
      ParsedHistoricalSpend[]
    >();
    const excludedOutliers: SpendingTrendOutlier[] = [];

    for (const [categoryId, categoryRows] of grouped) {
      const included: ParsedHistoricalSpend[] = [];
      for (const row of categoryRows) {
        let reason: string | null;
        if (row.excludeFromProjection === true) {
          reason = "marked_one_time";
        } else if (row.excludeFromProjection === false) {
          reason = null; // force include: skip all heuristics
        } else {
          reason = this.getOutlierReason(row, categoryRows);
        }
        if (reason) {
          excludedOutliers.push({
            date: row.date,
            categoryId,
            categoryName: categoryNames.get(categoryId) || "Uncategorized",
            amount: this.roundMoney(row.amount),
            payeeName: row.payeeName,
            reason,
            transactionId: row.transactionId,
          });
        } else {
          included.push(row);
        }
      }

      if (included.length > 0) {
        includedRowsByCategory.set(categoryId, included);
      }
    }

    excludedOutliers.sort((a, b) => b.amount - a.amount);
    return { includedRowsByCategory, excludedOutliers };
  }

  private getOutlierReason(
    row: ParsedHistoricalSpend,
    rows: ParsedHistoricalSpend[],
  ): string | null {
    if (rows.length === 1 && row.amount >= ONE_TIME_EXPENSE_MIN_AMOUNT) {
      return "single_historical_occurrence";
    }

    if (rows.length < 2) return null;

    const amounts = rows.map((r) => r.amount).sort((a, b) => a - b);
    const medianAmount = this.median(amounts);
    if (medianAmount <= 0) return null;

    const largeMultiple =
      row.amount >= medianAmount * (rows.length >= 4 ? 2.5 : 4);
    const largeDelta = row.amount - medianAmount >= OUTLIER_MIN_DELTA;

    if (rows.length >= 4) {
      const q1 = this.quantile(amounts, 0.25);
      const q3 = this.quantile(amounts, 0.75);
      const iqr = q3 - q1;
      const highFence = iqr > 0 ? q3 + 1.5 * iqr : medianAmount * 3;
      if (row.amount > highFence && largeMultiple && largeDelta) {
        return "amount_outlier";
      }
    }

    if (rows.length < 4 && largeMultiple && largeDelta) {
      return "amount_outlier";
    }

    return null;
  }

  private buildProjectionEvents(
    stats: CategoryProjectionStats[],
    forecastDays: number,
  ): SpendingProjectionEvent[] {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const endDate = new Date(today);
    endDate.setDate(today.getDate() + forecastDays);
    const projectionEvents: SpendingProjectionEvent[] = [];

    for (const stat of stats) {
      if (stat.includedRows.length === 0 || stat.trendFill <= 0) continue;

      const typicalAmount =
        this.median(stat.includedRows.map((row) => row.amount)) ||
        stat.trendFill;
      if (typicalAmount <= 0) continue;

      const monthlyOccurrences = stat.trendFill / typicalAmount;
      if (monthlyOccurrences <= 0) continue;

      const activeMonthRatio =
        this.countActiveMonths(stat.includedRows) / stat.monthsUsed;
      const isRegular = monthlyOccurrences >= 0.75 || activeMonthRatio >= 0.67;

      if (isRegular) {
        this.addRegularProjectionEvents(
          projectionEvents,
          stat,
          today,
          endDate,
          monthlyOccurrences,
        );
      } else {
        this.addOccasionalProjectionEvents(
          projectionEvents,
          stat,
          today,
          endDate,
          typicalAmount,
          monthlyOccurrences,
        );
      }
    }

    return this.aggregateProjectionEvents(projectionEvents).sort((a, b) =>
      a.date.localeCompare(b.date),
    );
  }

  private aggregateProjectionEvents(
    events: SpendingProjectionEvent[],
  ): SpendingProjectionEvent[] {
    const grouped = new Map<string, SpendingProjectionEvent>();

    for (const event of events) {
      const key = `${event.date}:${this.normalizeProjectionName(event.categoryName)}:${event.source}`;
      const existing = grouped.get(key);
      if (!existing) {
        grouped.set(key, { ...event });
        continue;
      }

      existing.amount = this.roundMoney(existing.amount + event.amount);
    }

    return Array.from(grouped.values());
  }

  private normalizeProjectionName(name: string): string {
    return name.trim().toLocaleLowerCase();
  }

  private addRegularProjectionEvents(
    events: SpendingProjectionEvent[],
    stat: CategoryProjectionStats,
    today: Date,
    endDate: Date,
    monthlyOccurrences: number,
  ) {
    const months = this.enumerateMonthStarts(today, endDate);
    const countPerMonth = Math.max(1, Math.round(monthlyOccurrences));
    const amount = this.roundMoney(stat.trendFill / countPerMonth);

    for (const monthStart of months) {
      for (let i = 0; i < countPerMonth; i++) {
        const eventDate = this.projectDateInMonth(
          monthStart,
          stat.includedRows,
          i,
          countPerMonth,
        );
        if (eventDate < today || eventDate > endDate) continue;
        events.push(this.toProjectionEvent(stat, eventDate, -amount));
      }
    }
  }

  private addOccasionalProjectionEvents(
    events: SpendingProjectionEvent[],
    stat: CategoryProjectionStats,
    today: Date,
    endDate: Date,
    typicalAmount: number,
    monthlyOccurrences: number,
  ) {
    const intervalMonths = Math.max(1, Math.round(1 / monthlyOccurrences));
    let nextDate = this.addMonthsClamped(
      this.latestHistoricalDate(stat.includedRows),
      intervalMonths,
    );

    while (nextDate < today) {
      nextDate = this.addMonthsClamped(nextDate, intervalMonths);
    }

    while (nextDate <= endDate) {
      events.push(
        this.toProjectionEvent(stat, nextDate, -this.roundMoney(typicalAmount)),
      );
      nextDate = this.addMonthsClamped(nextDate, intervalMonths);
    }
  }

  private toProjectionEvent(
    stat: CategoryProjectionStats,
    date: Date,
    amount: number,
  ): SpendingProjectionEvent {
    return {
      date: this.formatDateKey(date),
      categoryId: stat.categoryId,
      categoryName: stat.categoryName,
      amount: this.roundMoney(amount),
      confidence: stat.confidence,
      source: "historical_pattern",
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

  private getConfidence(
    rows: ParsedHistoricalSpend[],
    monthsUsed: number,
  ): "low" | "medium" | "high" {
    const activeMonthRatio = this.countActiveMonths(rows) / monthsUsed;
    if (rows.length >= monthsUsed * 3 && activeMonthRatio >= 0.67) {
      return "high";
    }
    if (rows.length >= 2 && activeMonthRatio >= 0.34) {
      return "medium";
    }
    return "low";
  }

  private countActiveMonths(rows: ParsedHistoricalSpend[]): number {
    return new Set(rows.map((row) => row.date.slice(0, 7))).size;
  }

  private enumerateMonthStarts(startDate: Date, endDate: Date): Date[] {
    const months: Date[] = [];
    const cursor = new Date(startDate.getFullYear(), startDate.getMonth(), 1);
    while (cursor <= endDate) {
      months.push(new Date(cursor));
      cursor.setMonth(cursor.getMonth() + 1);
    }
    return months;
  }

  private projectDateInMonth(
    monthStart: Date,
    rows: ParsedHistoricalSpend[],
    occurrenceIndex: number,
    occurrenceCount: number,
  ): Date {
    const daysInMonth = new Date(
      monthStart.getFullYear(),
      monthStart.getMonth() + 1,
      0,
    ).getDate();
    const preferredDay = this.selectPreferredDay(
      rows,
      occurrenceIndex,
      occurrenceCount,
      daysInMonth,
    );
    const date = new Date(
      monthStart.getFullYear(),
      monthStart.getMonth(),
      preferredDay,
    );
    return this.adjustToPreferredWeekday(
      date,
      this.selectPreferredWeekday(rows, occurrenceIndex),
    );
  }

  private selectPreferredDay(
    rows: ParsedHistoricalSpend[],
    occurrenceIndex: number,
    occurrenceCount: number,
    daysInMonth: number,
  ): number {
    const days = rows
      .map((row) => this.toLocalDate(row.date).getDate())
      .sort((a, b) => a - b);

    if (days.length > 0) {
      const idx = Math.min(
        days.length - 1,
        Math.floor(((occurrenceIndex + 0.5) * days.length) / occurrenceCount),
      );
      return Math.min(daysInMonth, Math.max(1, days[idx]));
    }

    return Math.min(
      daysInMonth,
      Math.max(
        1,
        Math.round(
          ((occurrenceIndex + 1) * daysInMonth) / (occurrenceCount + 1),
        ),
      ),
    );
  }

  private selectPreferredWeekday(
    rows: ParsedHistoricalSpend[],
    occurrenceIndex: number,
  ): number {
    const weekdays = rows
      .map((row) => this.toLocalDate(row.date).getDay())
      .sort((a, b) => a - b);
    if (weekdays.length === 0) return 0;
    return weekdays[occurrenceIndex % weekdays.length];
  }

  private adjustToPreferredWeekday(date: Date, preferredWeekday: number): Date {
    if (date.getDay() === preferredWeekday) return date;

    const candidates: Date[] = [];
    for (let offset = 1; offset <= 3; offset++) {
      const before = new Date(date);
      before.setDate(date.getDate() - offset);
      candidates.push(before);
      const after = new Date(date);
      after.setDate(date.getDate() + offset);
      candidates.push(after);
    }

    const sameMonth = candidates.find(
      (candidate) =>
        candidate.getMonth() === date.getMonth() &&
        candidate.getDay() === preferredWeekday,
    );
    return sameMonth || date;
  }

  private latestHistoricalDate(rows: ParsedHistoricalSpend[]): Date {
    return rows
      .map((row) => this.toLocalDate(row.date))
      .sort((a, b) => b.getTime() - a.getTime())[0];
  }

  private addMonthsClamped(date: Date, months: number): Date {
    const target = new Date(date);
    const originalDay = target.getDate();
    target.setDate(1);
    target.setMonth(target.getMonth() + months);
    const lastDay = new Date(
      target.getFullYear(),
      target.getMonth() + 1,
      0,
    ).getDate();
    target.setDate(Math.min(originalDay, lastDay));
    return target;
  }

  private median(values: number[]): number {
    if (values.length === 0) return 0;
    const sorted = [...values].sort((a, b) => a - b);
    const middle = Math.floor(sorted.length / 2);
    if (sorted.length % 2 === 1) return sorted[middle];
    return (sorted[middle - 1] + sorted[middle]) / 2;
  }

  private quantile(sortedValues: number[], q: number): number {
    if (sortedValues.length === 0) return 0;
    const pos = (sortedValues.length - 1) * q;
    const base = Math.floor(pos);
    const rest = pos - base;
    const next = sortedValues[base + 1];
    if (next === undefined) return sortedValues[base];
    return sortedValues[base] + rest * (next - sortedValues[base]);
  }

  private roundMoney(amount: number): number {
    return Math.round(amount * 100) / 100;
  }

  private toLocalDate(value: string | Date): Date {
    if (value instanceof Date) {
      return new Date(value.getFullYear(), value.getMonth(), value.getDate());
    }
    const [year, month, day] = value.split("T")[0].split("-").map(Number);
    return new Date(year, month - 1, day);
  }

  private formatDateKey(date: Date): string {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, "0");
    const day = String(date.getDate()).padStart(2, "0");
    return `${year}-${month}-${day}`;
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
