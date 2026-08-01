'use client';

import { useEffect, useMemo, useState } from 'react';
import { useTranslations } from 'next-intl';
import { PencilSquareIcon, ChevronDoubleLeftIcon } from '@heroicons/react/24/outline';
import { Category } from '@/types/category';
import { ScheduledTransaction } from '@/types/scheduled-transaction';
import { GroupedTotal, MonthlyTotal, TransactionSummary } from '@/types/transaction';
import { CategoryBudgetStatus } from '@/types/budget';
import { transactionsApi } from '@/lib/transactions';
import { budgetsApi } from '@/lib/budgets';
import { countElapsedPeriods } from '@/lib/chart-buckets';
import { sumMoney } from '@/lib/format';
import { getNextScheduled } from '@/lib/scheduled-utils';
import { useNumberFormat } from '@/hooks/useNumberFormat';
import { useDateFormat } from '@/hooks/useDateFormat';
import { useExchangeRates } from '@/hooks/useExchangeRates';
import { createLogger } from '@/lib/logger';
import {
  WidgetFilterParams,
  buildDisplayCurrencyStrategy,
  summarizeInDisplayCurrency,
  aggregateGroupedTotals,
} from './widget-shared';

const logger = createLogger('CategoryInfoWidget');

interface CategoryInfoWidgetProps {
  category: Category;
  categories: Category[];
  /** Scheduled bills/deposits; the soonest in this category is surfaced. */
  scheduledTransactions?: ScheduledTransaction[];
  /** The page's monthly-totals chart data (already filtered to this category). */
  monthlyTotals?: MonthlyTotal[];
  /** Active page filters (date range, accounts, ...) minus any category ids. */
  filterParams: WidgetFilterParams;
  /** Bumped by the page on every reload so the summary refetches in lockstep. */
  refreshKey?: number;
  /** Open the shared category edit modal for this category. */
  onEdit: () => void;
  /** Collapse the widget so the chart can use the full width. */
  onCollapse: () => void;
  /** Narrow the transaction filter to a subcategory. */
  onSubcategoryClick?: (categoryId: string) => void;
  /** Narrow the transaction filter to one of the category's top payees. */
  onPayeeClick?: (payeeId: string) => void;
}

/**
 * Compact category summary shown beside the chart when the Transactions list
 * is filtered to a single category. Mirrors the AccountInfoWidget card:
 * period totals, this month's budget progress, subcategory shares, top
 * payees, and the next scheduled transaction in the category.
 */
export function CategoryInfoWidget({
  category,
  categories,
  scheduledTransactions = [],
  monthlyTotals = [],
  filterParams,
  refreshKey,
  onEdit,
  onCollapse,
  onSubcategoryClick,
  onPayeeClick,
}: CategoryInfoWidgetProps) {
  const t = useTranslations('transactions');
  const { formatCurrency } = useNumberFormat();
  const { formatDate } = useDateFormat();
  const { convertToDefault, defaultCurrency } = useExchangeRates();

  const [summary, setSummary] = useState<TransactionSummary | null>(null);
  const [groupedPayees, setGroupedPayees] = useState<GroupedTotal[]>([]);
  const [groupedCategories, setGroupedCategories] = useState<GroupedTotal[]>([]);
  const [budgetStatus, setBudgetStatus] = useState<CategoryBudgetStatus | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  const filterKey = JSON.stringify(filterParams);

  useEffect(() => {
    let cancelled = false;
    const params: WidgetFilterParams = JSON.parse(filterKey);

    const load = async () => {
      setIsLoading(true);
      const [summaryResult, payeeRows, categoryRows, budgetMap] = await Promise.all([
        transactionsApi
          .getSummary({ ...params, categoryIds: [category.id] })
          .catch((error) => {
            logger.error(error);
            return null;
          }),
        transactionsApi
          .getGroupedTotals({ ...params, groupBy: 'payee', categoryIds: [category.id], limit: 25 })
          .catch((error) => {
            logger.error(error);
            return [] as GroupedTotal[];
          }),
        transactionsApi
          .getGroupedTotals({ ...params, groupBy: 'category', categoryIds: [category.id], limit: 100 })
          .catch((error) => {
            logger.error(error);
            return [] as GroupedTotal[];
          }),
        budgetsApi
          .getCategoryBudgetStatus([category.id])
          .catch(() => ({}) as Record<string, CategoryBudgetStatus>),
      ]);
      if (cancelled) return;
      setSummary(summaryResult);
      setGroupedPayees(payeeRows);
      setGroupedCategories(categoryRows);
      setBudgetStatus(budgetMap[category.id] ?? null);
      setIsLoading(false);
    };
    load();
    return () => {
      cancelled = true;
    };
  }, [category.id, filterKey, refreshKey]);

  const parentCategory = useMemo(
    () => (category.parentId ? categories.find((c) => c.id === category.parentId) : undefined),
    [category.parentId, categories],
  );

  const subcategories = useMemo(
    () => categories.filter((c) => c.parentId === category.id),
    [categories, category.id],
  );

  // Every category id in this category's subtree, for the scheduled-item
  // predicate (the backend already expands descendants for the queries).
  const descendantIds = useMemo(() => {
    const ids = new Set<string>([category.id]);
    let added = true;
    while (added) {
      added = false;
      for (const c of categories) {
        if (c.parentId && ids.has(c.parentId) && !ids.has(c.id)) {
          ids.add(c.id);
          added = true;
        }
      }
    }
    return ids;
  }, [categories, category.id]);

  const nextScheduled = useMemo(
    () =>
      getNextScheduled(scheduledTransactions, (st) =>
        st.categoryId ? descendantIds.has(st.categoryId) : false,
      ),
    [scheduledTransactions, descendantIds],
  );

  const currencyStrategy = useMemo(
    () => buildDisplayCurrencyStrategy(summary, defaultCurrency, convertToDefault),
    [summary, defaultCurrency, convertToDefault],
  );

  const totals = useMemo(
    () => (summary ? summarizeInDisplayCurrency(summary, currencyStrategy) : null),
    [summary, currencyStrategy],
  );

  const topPayees = useMemo(
    () => aggregateGroupedTotals(groupedPayees, currencyStrategy).slice(0, 3),
    [groupedPayees, currencyStrategy],
  );

  // Roll grouped rows (which the backend returns per leaf category) up to
  // this category's direct children; rows for the category itself become a
  // "This category" bucket. Shares are of the summed absolute total.
  const subcategoryShares = useMemo(() => {
    if (subcategories.length === 0) return [];
    const parentOf = new Map(categories.map((c) => [c.id, c.parentId]));
    const rollupTarget = (id: string | null): string | null => {
      if (!id) return null;
      let current: string | null = id;
      while (current) {
        if (current === category.id) return category.id;
        const parent: string | null = parentOf.get(current) ?? null;
        if (parent === category.id) return current;
        current = parent;
      }
      return null;
    };

    const buckets = new Map<string, number>();
    for (const row of aggregateGroupedTotals(groupedCategories, currencyStrategy)) {
      const target = rollupTarget(row.id);
      if (!target) continue;
      buckets.set(target, (buckets.get(target) ?? 0) + row.total);
    }
    const grandTotal = [...buckets.values()].reduce((sum, v) => sum + Math.abs(v), 0);
    if (grandTotal === 0) return [];

    const byId = new Map(categories.map((c) => [c.id, c]));
    return [...buckets.entries()]
      .map(([id, total]) => ({
        id,
        name: id === category.id ? null : (byId.get(id)?.name ?? ''),
        total,
        share: Math.abs(total) / grandTotal,
      }))
      .sort((a, b) => Math.abs(b.total) - Math.abs(a.total));
  }, [subcategories.length, categories, groupedCategories, currencyStrategy, category.id]);

  const transactionCount = summary?.transactionCount ?? 0;
  const averageAmount =
    totals && transactionCount > 0 ? (totals.income + totals.expenses) / transactionCount : null;

  // Average spend per elapsed month over the period the chart covers. Dividing
  // by elapsed months (including months with no transaction) rather than only
  // the months that had activity matches the chart's "Monthly Avg" and reads
  // as the intuitive "total spend / months elapsed".
  const monthlyAverage = useMemo(() => {
    if (monthlyTotals.length === 0) return null;
    const sum = sumMoney(monthlyTotals.map((m) => Math.abs(m.total)));
    const elapsedMonths = countElapsedPeriods(monthlyTotals, 'month');
    return elapsedMonths > 0 ? sum / elapsedMonths : null;
  }, [monthlyTotals]);

  const headlineTotal = totals ? (category.isIncome ? totals.income : totals.expenses) : null;
  const swatchColor = category.effectiveColor ?? category.color;
  const budgetPercent = budgetStatus ? Math.min(budgetStatus.percentUsed, 100) : 0;
  const budgetBarColor = budgetStatus
    ? budgetStatus.percentUsed >= 100
      ? 'bg-red-500'
      : budgetStatus.percentUsed >= 80
        ? 'bg-amber-500'
        : 'bg-green-500'
    : '';

  return (
    <div className="bg-white dark:bg-gray-800 rounded-lg shadow dark:shadow-gray-700/50 p-4 sm:p-6 mb-6 lg:mb-0 lg:absolute lg:inset-x-0 lg:top-0 lg:bottom-6 lg:overflow-y-auto flex flex-col">
      <div className="flex items-start justify-between gap-2 mb-4">
        <div className="flex items-center gap-3 min-w-0">
          {swatchColor && (
            <span
              className="flex-shrink-0 h-4 w-4 rounded"
              style={{ backgroundColor: swatchColor }}
              aria-hidden
            />
          )}
          <div className="min-w-0">
            <h3 className="text-lg font-semibold text-gray-900 dark:text-gray-100 truncate">
              {category.icon ? `${category.icon} ` : ''}
              {category.name}
            </h3>
            <div className="flex items-center gap-2 min-w-0">
              {parentCategory && (
                <p className="text-sm text-gray-500 dark:text-gray-400 truncate">
                  {parentCategory.name}
                </p>
              )}
              <span className="flex-shrink-0 text-xs font-medium px-2 py-0.5 rounded-full bg-gray-200 dark:bg-gray-700 text-gray-600 dark:text-gray-300">
                {category.isIncome ? t('categoryWidget.income') : t('categoryWidget.expense')}
              </span>
            </div>
          </div>
        </div>
        <div className="flex items-center gap-0.5 flex-shrink-0">
          <button
            type="button"
            onClick={onEdit}
            aria-label={t('categoryWidget.editAria')}
            title={t('categoryWidget.editAria')}
            className="text-gray-400 hover:text-blue-600 dark:hover:text-blue-400 focus:outline-none focus:ring-2 focus:ring-blue-500 rounded p-1"
          >
            <PencilSquareIcon className="h-5 w-5" />
          </button>
          <button
            type="button"
            onClick={onCollapse}
            aria-label={t('categoryWidget.collapseAria')}
            title={t('categoryWidget.collapseAria')}
            className="text-gray-400 hover:text-blue-600 dark:hover:text-blue-400 focus:outline-none focus:ring-2 focus:ring-blue-500 rounded p-1"
          >
            <ChevronDoubleLeftIcon className="h-5 w-5" />
          </button>
        </div>
      </div>

      <div className="mb-4">
        <p className="text-sm text-gray-500 dark:text-gray-400">
          {category.isIncome ? t('categoryWidget.totalEarned') : t('categoryWidget.totalSpent')}
        </p>
        <p
          className={`text-2xl font-bold ${
            category.isIncome
              ? 'text-green-600 dark:text-green-400'
              : 'text-red-600 dark:text-red-400'
          }`}
        >
          {headlineTotal !== null
            ? formatCurrency(headlineTotal, currencyStrategy.displayCurrency)
            : '—'}
        </p>
      </div>

      {budgetStatus && !category.isIncome && (
        <div className="mb-4">
          <div className="flex items-baseline justify-between gap-3">
            <p className="text-sm text-gray-500 dark:text-gray-400">
              {t('categoryWidget.budgetThisMonth')}
            </p>
            <p className="text-sm text-gray-900 dark:text-gray-100">
              {t('categoryWidget.budgetProgress', {
                spent: formatCurrency(budgetStatus.spent, defaultCurrency),
                budgeted: formatCurrency(budgetStatus.budgeted, defaultCurrency),
              })}
            </p>
          </div>
          <div
            className="mt-1 h-2 w-full rounded-full bg-gray-200 dark:bg-gray-700 overflow-hidden"
            role="progressbar"
            aria-valuenow={Math.round(budgetStatus.percentUsed)}
            aria-valuemin={0}
            aria-valuemax={100}
          >
            <div className={`h-full ${budgetBarColor}`} style={{ width: `${budgetPercent}%` }} />
          </div>
        </div>
      )}

      <dl className="space-y-2 text-sm mb-4">
        <div className="flex items-baseline justify-between gap-3">
          <dt className="text-gray-500 dark:text-gray-400">
            {t('categoryWidget.transactions')}
          </dt>
          <dd className="text-gray-900 dark:text-gray-100 text-right">{transactionCount}</dd>
        </div>
        {averageAmount !== null && (
          <div className="flex items-baseline justify-between gap-3">
            <dt className="text-gray-500 dark:text-gray-400">
              {t('categoryWidget.averageAmount')}
            </dt>
            <dd className="text-gray-900 dark:text-gray-100 text-right">
              {formatCurrency(averageAmount, currencyStrategy.displayCurrency)}
            </dd>
          </div>
        )}
        {monthlyAverage !== null && (
          <div className="flex items-baseline justify-between gap-3">
            <dt className="text-gray-500 dark:text-gray-400">
              {t('categoryWidget.monthlyAverage')}
            </dt>
            <dd className="text-gray-900 dark:text-gray-100 text-right">
              {formatCurrency(monthlyAverage, currencyStrategy.displayCurrency)}
            </dd>
          </div>
        )}
      </dl>

      {!isLoading && transactionCount === 0 && (
        <p className="mb-4 text-sm text-gray-500 dark:text-gray-400">
          {t('categoryWidget.noTransactions')}
        </p>
      )}

      {subcategoryShares.length > 0 && (
        <div className="mb-4">
          <p className="text-sm text-gray-500 dark:text-gray-400 mb-1">
            {t('categoryWidget.subcategories')}
          </p>
          <ul className="space-y-1 text-sm">
            {subcategoryShares.map((row) => {
              const label = row.name ?? t('categoryWidget.thisCategory');
              const amount = `${formatCurrency(Math.abs(row.total), currencyStrategy.displayCurrency)} · ${Math.round(row.share * 100)}%`;
              const clickable = row.id !== category.id && onSubcategoryClick;
              return (
                <li key={row.id}>
                  {clickable ? (
                    <button
                      type="button"
                      onClick={() => onSubcategoryClick!(row.id)}
                      className="w-full flex items-baseline justify-between gap-3 text-left rounded hover:bg-gray-50 dark:hover:bg-gray-700/40 px-1 -mx-1"
                    >
                      <span className="text-blue-600 dark:text-blue-400 truncate">{label}</span>
                      <span className="text-gray-900 dark:text-gray-100 whitespace-nowrap">
                        {amount}
                      </span>
                    </button>
                  ) : (
                    <div className="flex items-baseline justify-between gap-3 px-1 -mx-1">
                      <span className="text-gray-700 dark:text-gray-300 truncate">{label}</span>
                      <span className="text-gray-900 dark:text-gray-100 whitespace-nowrap">
                        {amount}
                      </span>
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        </div>
      )}

      {topPayees.length > 0 && (
        <div className="mb-4">
          <p className="text-sm text-gray-500 dark:text-gray-400 mb-1">
            {t('categoryWidget.topPayees')}
          </p>
          <ul className="space-y-1 text-sm">
            {topPayees.map((row) => {
              const label = row.name ?? t('categoryWidget.noPayee');
              const amount = formatCurrency(Math.abs(row.total), currencyStrategy.displayCurrency);
              return (
                <li key={row.id ?? 'no-payee'}>
                  {row.id && onPayeeClick ? (
                    <button
                      type="button"
                      onClick={() => onPayeeClick(row.id!)}
                      className="w-full flex items-baseline justify-between gap-3 text-left rounded hover:bg-gray-50 dark:hover:bg-gray-700/40 px-1 -mx-1"
                    >
                      <span className="text-blue-600 dark:text-blue-400 truncate">{label}</span>
                      <span className="text-gray-900 dark:text-gray-100">{amount}</span>
                    </button>
                  ) : (
                    <div className="flex items-baseline justify-between gap-3 px-1 -mx-1">
                      <span className="text-gray-700 dark:text-gray-300 truncate">{label}</span>
                      <span className="text-gray-900 dark:text-gray-100">{amount}</span>
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        </div>
      )}

      {nextScheduled && (
        <div className="mb-4 rounded-md bg-gray-50 dark:bg-gray-700/40 px-3 py-2">
          <p className="text-sm text-gray-500 dark:text-gray-400">
            {t('categoryWidget.nextScheduled')}
          </p>
          <div className="flex items-baseline justify-between gap-3">
            <p
              className={`text-base font-semibold ${
                nextScheduled.amount < 0
                  ? 'text-red-600 dark:text-red-400'
                  : 'text-green-600 dark:text-green-400'
              }`}
            >
              {formatCurrency(Math.abs(nextScheduled.amount), nextScheduled.currencyCode)}
            </p>
            <div className="text-right min-w-0">
              {nextScheduled.payeeName && (
                <p className="text-sm text-gray-700 dark:text-gray-300 truncate">
                  {nextScheduled.payeeName}
                </p>
              )}
              <p className="text-base font-semibold text-gray-700 dark:text-gray-300">
                {formatDate(nextScheduled.date)}
              </p>
            </div>
          </div>
        </div>
      )}

      {category.description && (
        <p className="mt-auto text-sm text-gray-500 dark:text-gray-400 break-words">
          {category.description}
        </p>
      )}
    </div>
  );
}
