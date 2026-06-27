'use client';

import { useMemo, useState, useEffect } from 'react';
import { useTranslations } from 'next-intl';
import { PieChart, Pie, Cell, ResponsiveContainer, Tooltip } from 'recharts';
import { AssetAllocation, AccountHoldings } from '@/types/investment';
import { investmentsApi } from '@/lib/investments';
import { useNumberFormat } from '@/hooks/useNumberFormat';
import { useExchangeRates } from '@/hooks/useExchangeRates';

type GroupBy = 'security' | 'tag';

function AllocationTooltip({
  active,
  payload,
  fmtVal,
  foreignCurrency,
  foreignTotal,
}: {
  active?: boolean;
  payload?: Array<{
    payload: { fullName: string; value: number; percentage: number; currencyCode?: string };
  }>;
  fmtVal: (v: number) => string;
  foreignCurrency: string | null;
  foreignTotal: number;
}) {
  if (active && payload && payload.length) {
    const data = payload[0].payload;
    const displayValue = foreignCurrency
      ? (data.percentage / 100) * foreignTotal
      : data.value;
    return (
      <div className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg shadow-lg p-3">
        <p className="font-medium text-gray-900 dark:text-gray-100">
          {data.fullName}
        </p>
        <p className="text-gray-600 dark:text-gray-400">
          {fmtVal(displayValue)} ({data.percentage.toFixed(1)}%)
        </p>
      </div>
    );
  }
  return null;
}

interface AssetAllocationChartProps {
  allocation: AssetAllocation | null;
  isLoading: boolean;
  singleAccountCurrency?: string | null;
  holdingsByAccount?: AccountHoldings[];
  titleSuffix?: string;
  /**
   * Account IDs the parent is currently filtering by. Used to fetch the
   * by-tag allocation when the user toggles "By tag". Omit to disable the
   * tag grouping toggle (e.g. where it isn't meaningful).
   */
  accountIds?: string[];
  enableTagGrouping?: boolean;
}

export function AssetAllocationChart({
  allocation,
  isLoading,
  singleAccountCurrency,
  holdingsByAccount,
  titleSuffix,
  accountIds,
  enableTagGrouping = true,
}: AssetAllocationChartProps) {
  const t = useTranslations('investments');
  const { formatCurrencyCompact: formatCurrency } = useNumberFormat();
  const { defaultCurrency } = useExchangeRates();

  const [groupBy, setGroupBy] = useState<GroupBy>('security');
  // By-tag allocations cached per account-filter key so toggling back and
  // forth (or re-selecting the same accounts) does not refetch.
  const [tagCache, setTagCache] = useState<Record<string, AssetAllocation>>({});
  const accountKey =
    accountIds && accountIds.length > 0 ? [...accountIds].sort().join(',') : 'all';

  useEffect(() => {
    if (groupBy !== 'tag') return;
    let cancelled = false;
    const ids = accountKey === 'all' ? undefined : accountKey.split(',');
    investmentsApi
      .getAllocationByTag(ids)
      .then((res) => {
        if (!cancelled) setTagCache((prev) => ({ ...prev, [accountKey]: res }));
      })
      .catch(() => {
        if (!cancelled)
          setTagCache((prev) => ({
            ...prev,
            [accountKey]: { allocation: [], totalValue: 0 },
          }));
      });
    return () => {
      cancelled = true;
    };
  }, [groupBy, accountKey]);

  const isTagView = groupBy === 'tag';
  const activeAllocation = isTagView ? (tagCache[accountKey] ?? null) : allocation;
  const activeLoading = isTagView ? !tagCache[accountKey] : isLoading;

  // When viewing a single foreign-currency account, show values in that
  // currency. The by-tag allocation is always returned in the default
  // currency, so the foreign-currency display only applies to the security view.
  const foreignCurrency =
    !isTagView && singleAccountCurrency && singleAccountCurrency !== defaultCurrency
      ? singleAccountCurrency
      : null;

  // Compute raw total in the foreign currency from holdingsByAccount
  const foreignTotal = useMemo(() => {
    if (!foreignCurrency || !holdingsByAccount) return 0;
    let total = 0;
    for (const acct of holdingsByAccount) {
      total += acct.cashBalance + acct.totalMarketValue;
    }
    return total;
  }, [foreignCurrency, holdingsByAccount]);

  const fmtVal = (value: number) => {
    if (foreignCurrency) return `${formatCurrency(value, foreignCurrency)} ${foreignCurrency}`;
    return formatCurrency(value);
  };

  const chartData = useMemo(() => {
    if (!activeAllocation) return [];
    return activeAllocation.allocation.map((item) => {
      const label =
        item.type === 'cash'
          ? t('assetAllocation.cash')
          : item.type === 'untagged'
            ? t('assetAllocation.untagged')
            : item.name;
      return {
        name: item.symbol || label,
        fullName: label,
        value: item.value,
        percentage: item.percentage,
        color: item.color || '#6b7280',
        currencyCode: item.currencyCode,
      };
    });
  }, [activeAllocation, t]);

  const groupToggle = enableTagGrouping ? (
    <div className="inline-flex rounded-md border border-gray-200 dark:border-gray-700 overflow-hidden text-xs">
      <button
        type="button"
        onClick={() => setGroupBy('security')}
        className={`px-2 py-1 ${
          !isTagView
            ? 'bg-blue-600 text-white'
            : 'bg-white dark:bg-gray-800 text-gray-600 dark:text-gray-300'
        }`}
        aria-pressed={!isTagView}
      >
        {t('assetAllocation.groupBy.security')}
      </button>
      <button
        type="button"
        onClick={() => setGroupBy('tag')}
        className={`px-2 py-1 ${
          isTagView
            ? 'bg-blue-600 text-white'
            : 'bg-white dark:bg-gray-800 text-gray-600 dark:text-gray-300'
        }`}
        aria-pressed={isTagView}
      >
        {t('assetAllocation.groupBy.tag')}
      </button>
    </div>
  ) : null;

  const heading = (
    <div className="flex items-center justify-between gap-2 mb-4">
      <h3 className="text-lg font-semibold text-gray-900 dark:text-gray-100">
        {t('assetAllocation.title')}
        {titleSuffix ? ` (${titleSuffix})` : ''}
      </h3>
      {groupToggle}
    </div>
  );

  if (activeLoading) {
    return (
      <div className="bg-white dark:bg-gray-800 rounded-lg shadow dark:shadow-gray-700/50 p-3 sm:p-6 lg:min-h-[420px]">
        {heading}
        <div className="h-64 flex items-center justify-center">
          <div className="animate-pulse w-48 h-48 rounded-full bg-gray-200 dark:bg-gray-700" />
        </div>
      </div>
    );
  }

  if (!activeAllocation || activeAllocation.allocation.length === 0) {
    return (
      <div className="bg-white dark:bg-gray-800 rounded-lg shadow dark:shadow-gray-700/50 p-3 sm:p-6 lg:min-h-[420px]">
        {heading}
        <p className="text-gray-500 dark:text-gray-400">
          {isTagView
            ? t('assetAllocation.noTagData')
            : t('assetAllocation.noData')}
        </p>
      </div>
    );
  }

  return (
    <div className="bg-white dark:bg-gray-800 rounded-lg shadow dark:shadow-gray-700/50 p-3 sm:p-6 lg:min-h-[420px]">
      {heading}
      {isTagView && (
        <p className="text-xs text-gray-500 dark:text-gray-400 -mt-2 mb-3">
          {t('assetAllocation.tagExposureNote')}
        </p>
      )}
      <div className="h-64">
        <ResponsiveContainer width="100%" height="100%" minWidth={0}>
          <PieChart>
            <Pie
              data={chartData}
              cx="50%"
              cy="50%"
              innerRadius={50}
              outerRadius={80}
              paddingAngle={2}
              dataKey="value"
            >
              {chartData.map((entry, index) => (
                <Cell key={`cell-${index}`} fill={entry.color} />
              ))}
            </Pie>
            <Tooltip content={<AllocationTooltip fmtVal={fmtVal} foreignCurrency={foreignCurrency} foreignTotal={foreignTotal} />} />
          </PieChart>
        </ResponsiveContainer>
      </div>
      <div className="mt-4 grid grid-cols-2 gap-2">
        {chartData.slice(0, 10).map((item, index) => {
          const isForeign = !foreignCurrency && item.currencyCode && item.currencyCode !== defaultCurrency;
          return (
            <div key={index} className="flex items-center gap-2 text-sm">
              <div
                className="w-3 h-3 rounded-full flex-shrink-0"
                style={{ backgroundColor: item.color }}
              />
              <span className="text-gray-600 dark:text-gray-400 truncate">
                {item.name}
                {isForeign && (
                  <span className="ml-1 text-xs text-amber-600 dark:text-amber-400">({item.currencyCode})</span>
                )}
              </span>
              <span className="text-gray-900 dark:text-gray-100 ml-auto">
                {item.percentage.toFixed(1)}%
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
