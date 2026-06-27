import { Injectable } from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { Repository } from "typeorm";
import { Transaction } from "../transactions/entities/transaction.entity";
import { Category } from "../categories/entities/category.entity";
import {
  ReportCurrencyService,
  RawCategoryAggregate,
  RawMonthlyAggregate,
} from "./report-currency.service";
import { roundMoney, sumMoney, toMoneyNumber } from "../common/round.util";
import {
  IncomeBySourceResponse,
  IncomeSourceItem,
  IncomeVsExpensesResponse,
  MonthlyIncomeExpenseItem,
} from "./dto";

@Injectable()
export class IncomeReportsService {
  constructor(
    @InjectRepository(Transaction)
    private transactionsRepository: Repository<Transaction>,
    @InjectRepository(Category)
    private categoriesRepository: Repository<Category>,
    private currencyService: ReportCurrencyService,
  ) {}

  async getIncomeBySource(
    userId: string,
    startDate: string | undefined,
    endDate: string,
  ): Promise<IncomeBySourceResponse> {
    const defaultCurrency =
      await this.currencyService.getDefaultCurrency(userId);
    const rateMap = await this.currencyService.buildRateMap(defaultCurrency);

    let query = `
      SELECT
        COALESCE(ts.category_id, t.category_id) as category_id,
        t.currency_code,
        SUM(COALESCE(ts.amount, t.amount)) as total
      FROM transactions t
      LEFT JOIN transaction_splits ts ON ts.transaction_id = t.id
      LEFT JOIN accounts a ON a.id = t.account_id
      INNER JOIN categories c ON c.id = COALESCE(ts.category_id, t.category_id)
      WHERE t.user_id = $1
        AND t.transaction_date <= $2
        AND c.is_income = true
        AND COALESCE(ts.amount, t.amount) > 0
        AND t.is_transfer = false
        AND (t.status IS NULL OR t.status != 'VOID')
        AND t.parent_transaction_id IS NULL
        AND a.account_type != 'INVESTMENT'
        AND (ts.transfer_account_id IS NULL OR ts.id IS NULL)
        AND NOT EXISTS (
          SELECT 1 FROM accounts ax
          WHERE ax.user_id = t.user_id
            AND ax.asset_category_id IS NOT NULL
            AND ax.asset_category_id = COALESCE(ts.category_id, t.category_id)
        )
    `;

    const params: (string | undefined)[] = [userId, endDate];

    if (startDate) {
      query += ` AND t.transaction_date >= $3`;
      params.push(startDate);
    }

    query += ` GROUP BY COALESCE(ts.category_id, t.category_id), t.currency_code`;

    const rawResults: RawCategoryAggregate[] =
      await this.transactionsRepository.query(query, params);

    const categories = await this.categoriesRepository.find({
      where: { userId },
    });
    const categoryMap = new Map(categories.map((c) => [c.id, c]));

    const categoryTotals = new Map<
      string,
      { total: number; category: Category }
    >();

    for (const row of rawResults) {
      const total = this.currencyService.convertAmount(
        toMoneyNumber(row.total),
        row.currency_code,
        defaultCurrency,
        rateMap,
      );
      const categoryId = row.category_id;
      if (!categoryId) continue;

      const category = categoryMap.get(categoryId);
      if (!category) continue;

      const parentCategory = category.parentId
        ? categoryMap.get(category.parentId)
        : null;
      const displayName = parentCategory
        ? `${parentCategory.name}: ${category.name}`
        : category.name;

      const existing = categoryTotals.get(category.id);
      if (existing) {
        existing.total += total;
      } else {
        categoryTotals.set(category.id, {
          total,
          category: { ...category, name: displayName } as Category,
        });
      }
    }

    const data: IncomeSourceItem[] = Array.from(categoryTotals.entries())
      .map(([id, { total, category }]) => ({
        categoryId: id,
        categoryName: category.name,
        color: category.color || null,
        total: roundMoney(total),
      }))
      .sort((a, b) => b.total - a.total)
      .slice(0, 15);

    const totalIncome = sumMoney(data.map((item) => item.total));

    return {
      data,
      totalIncome: roundMoney(totalIncome),
    };
  }

  async getIncomeVsExpenses(
    userId: string,
    startDate: string | undefined,
    endDate: string,
  ): Promise<IncomeVsExpensesResponse> {
    const defaultCurrency =
      await this.currencyService.getDefaultCurrency(userId);
    const rateMap = await this.currencyService.buildRateMap(defaultCurrency);

    let query = `
      SELECT
        TO_CHAR(t.transaction_date, 'YYYY-MM') as month,
        t.currency_code,
        SUM(CASE
          WHEN c.is_income = true THEN COALESCE(ts.amount, t.amount)
          WHEN c.is_income = false THEN 0
          WHEN COALESCE(ts.amount, t.amount) > 0 THEN COALESCE(ts.amount, t.amount)
          ELSE 0
        END) as income,
        SUM(CASE
          WHEN c.is_income = false THEN -1 * COALESCE(ts.amount, t.amount)
          WHEN c.is_income = true THEN 0
          WHEN COALESCE(ts.amount, t.amount) < 0 THEN ABS(COALESCE(ts.amount, t.amount))
          ELSE 0
        END) as expenses
      FROM transactions t
      LEFT JOIN transaction_splits ts ON ts.transaction_id = t.id
      LEFT JOIN categories c ON c.id = COALESCE(ts.category_id, t.category_id)
      LEFT JOIN accounts a ON a.id = t.account_id
      WHERE t.user_id = $1
        AND t.transaction_date <= $2
        AND t.is_transfer = false
        AND (t.status IS NULL OR t.status != 'VOID')
        AND t.parent_transaction_id IS NULL
        AND a.account_type != 'INVESTMENT'
        AND (ts.transfer_account_id IS NULL OR ts.id IS NULL)
        AND NOT EXISTS (
          SELECT 1 FROM accounts ax
          WHERE ax.user_id = t.user_id
            AND ax.asset_category_id IS NOT NULL
            AND ax.asset_category_id = COALESCE(ts.category_id, t.category_id)
        )
    `;

    const params: (string | undefined)[] = [userId, endDate];

    if (startDate) {
      query += ` AND t.transaction_date >= $3`;
      params.push(startDate);
    }

    query += `
      GROUP BY TO_CHAR(t.transaction_date, 'YYYY-MM'), t.currency_code
      ORDER BY month
    `;

    const rawResults: RawMonthlyAggregate[] =
      await this.transactionsRepository.query(query, params);

    const monthlyMap = new Map<string, { income: number; expenses: number }>();
    for (const row of rawResults) {
      const income = this.currencyService.convertAmount(
        toMoneyNumber(row.income),
        row.currency_code,
        defaultCurrency,
        rateMap,
      );
      const expenses = this.currencyService.convertAmount(
        toMoneyNumber(row.expenses),
        row.currency_code,
        defaultCurrency,
        rateMap,
      );
      const existing = monthlyMap.get(row.month);
      if (existing) {
        existing.income += income;
        existing.expenses += expenses;
      } else {
        monthlyMap.set(row.month, { income, expenses });
      }
    }

    const data: MonthlyIncomeExpenseItem[] = Array.from(monthlyMap.entries())
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([month, { income, expenses }]) => ({
        month,
        income: roundMoney(income),
        expenses: roundMoney(expenses),
        net: roundMoney(income - expenses),
      }));

    const totals = {
      income: sumMoney(data.map((item) => item.income)),
      expenses: sumMoney(data.map((item) => item.expenses)),
      net: sumMoney(data.map((item) => item.net)),
    };

    return {
      data,
      totals: {
        income: roundMoney(totals.income),
        expenses: roundMoney(totals.expenses),
        net: roundMoney(totals.net),
      },
    };
  }
}
