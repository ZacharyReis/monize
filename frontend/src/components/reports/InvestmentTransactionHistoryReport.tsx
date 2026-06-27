'use client';

import { useState, useEffect, useMemo, useCallback } from 'react';
import { Skeleton } from '@/components/ui/LoadingSkeleton';
import { format } from 'date-fns';
import { investmentsApi } from '@/lib/investments';
import { InvestmentTransaction, InvestmentAction } from '@/types/investment';
import { Account } from '@/types/account';
import { parseLocalDate } from '@/lib/utils';
import { useNumberFormat } from '@/hooks/useNumberFormat';
import { useExchangeRates } from '@/hooks/useExchangeRates';
import { useDateRange } from '@/hooks/useDateRange';
import { useReportData } from '@/hooks/useReportData';
import { DateRangeSelector } from '@/components/ui/DateRangeSelector';
import { ExportDropdown } from '@/components/ui/ExportDropdown';
import { MultiSelect } from '@/components/ui/MultiSelect';
import { ReportAccountMultiSelect } from '@/components/reports/ReportAccountMultiSelect';
import { RefreshPricesButton } from '@/components/reports/RefreshPricesButton';
import { ReportError } from '@/components/reports/ReportError';
import { exportToCsv } from '@/lib/csv-export';
import { SortableHeader } from '@/components/ui/SortableHeader';
import { useSortableTable, compareValues } from '@/hooks/useSortableTable';
import { createLogger } from '@/lib/logger';
import { useTranslations } from 'next-intl';
import { useMainAccountName } from '@/hooks/useMainAccountName';

const logger = createLogger('InvestmentTransactionHistoryReport');

const MAX_PAGES = 50;

type InvestmentTxSortField = 'date' | 'action' | 'security' | 'account' | 'quantity' | 'price' | 'total';

const ACTION_COLORS: Record<InvestmentAction, string> = {
  BUY: 'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300',
  SELL: 'bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-300',
  DIVIDEND: 'bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-300',
  INTEREST: 'bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-300',
  CAPITAL_GAIN: 'bg-purple-100 text-purple-800 dark:bg-purple-900/30 dark:text-purple-300',
  SPLIT: 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-300',
  TRANSFER_IN: 'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300',
  TRANSFER_OUT: 'bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-300',
  REINVEST: 'bg-indigo-100 text-indigo-800 dark:bg-indigo-900/30 dark:text-indigo-300',
  ADD_SHARES: 'bg-teal-100 text-teal-800 dark:bg-teal-900/30 dark:text-teal-300',
  REMOVE_SHARES: 'bg-orange-100 text-orange-800 dark:bg-orange-900/30 dark:text-orange-300',
};

interface ActionSummary {
  action: InvestmentAction;
  count: number;
  totalAmount: number;
}

export function InvestmentTransactionHistoryReport() {
  const t = useTranslations('reports');
  const mainAccountName = useMainAccountName();
  const { formatCurrency: formatCurrencyFull } = useNumberFormat();
  const { defaultCurrency, convertToDefault } = useExchangeRates();
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [selectedAccountIds, setSelectedAccountIds] = useState<string[]>([]);
  const [selectedActions, setSelectedActions] = useState<string[]>([]);

  const actionLabels = useMemo<Record<InvestmentAction, string>>(() => ({
    BUY: t('investmentTransactions.actionBuy'),
    SELL: t('investmentTransactions.actionSell'),
    DIVIDEND: t('investmentTransactions.actionDividend'),
    INTEREST: t('investmentTransactions.actionInterest'),
    CAPITAL_GAIN: t('investmentTransactions.actionCapitalGain'),
    SPLIT: t('investmentTransactions.actionSplit'),
    TRANSFER_IN: t('investmentTransactions.actionTransferIn'),
    TRANSFER_OUT: t('investmentTransactions.actionTransferOut'),
    REINVEST: t('investmentTransactions.actionReinvest'),
    ADD_SHARES: t('investmentTransactions.actionAddShares'),
    REMOVE_SHARES: t('investmentTransactions.actionRemoveShares'),
  }), [t]);

  const actionOptions = useMemo(
    () =>
      (Object.keys(actionLabels) as InvestmentAction[]).map((action) => ({
        value: action,
        label: actionLabels[action],
      })),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [t],
  );
  const { dateRange, setDateRange, resolvedRange, isValid } = useDateRange({ defaultRange: '1y', alignment: 'month' });
  const { start: rangeStart, end: rangeEnd } = resolvedRange;
  const isSingleAccount = selectedAccountIds.length === 1;
  const { sortField, sortDirection, handleSort } = useSortableTable<InvestmentTxSortField>(
    'reports.investment-transactions.sort',
    { field: 'date', direction: 'desc' },
  );

  const accountCurrencyMap = useMemo(() => {
    const map = new Map<string, string>();
    accounts.forEach((a) => map.set(a.id, a.currencyCode));
    return map;
  }, [accounts]);

  const selectedAccount = isSingleAccount
    ? accounts.find((a) => a.id === selectedAccountIds[0])
    : undefined;
  const displayCurrency = selectedAccount?.currencyCode || defaultCurrency;
  const isForeign = displayCurrency !== defaultCurrency;

  const getTxAmount = useCallback((tx: InvestmentTransaction): number => {
    const amount = Math.abs(tx.totalAmount);
    if (isSingleAccount) return amount;
    const txCurrency = accountCurrencyMap.get(tx.accountId) || defaultCurrency;
    return convertToDefault(amount, txCurrency);
  }, [isSingleAccount, accountCurrencyMap, defaultCurrency, convertToDefault]);

  const fmtValue = useCallback((value: number): string => {
    if (isForeign) {
      return `${formatCurrencyFull(value, displayCurrency)} ${displayCurrency}`;
    }
    return formatCurrencyFull(value);
  }, [isForeign, displayCurrency, formatCurrencyFull]);

  // Fetch accounts once on mount
  useEffect(() => {
    investmentsApi.getInvestmentAccounts()
      .then(setAccounts)
      .catch((error) => logger.error('Failed to load accounts:', error));
  }, []);

  const { data: response, isLoading, error, reload } = useReportData(
    async () => {
      if (!isValid) return null;
      const allTransactions: InvestmentTransaction[] = [];
      let page = 1;
      let hasMore = true;
      while (hasMore && page <= MAX_PAGES) {
        const result = await investmentsApi.getTransactions({
          accountIds: selectedAccountIds.length > 0 ? selectedAccountIds.join(',') : undefined,
          startDate: rangeStart || undefined,
          endDate: rangeEnd,
          limit: 200,
          page,
        });
        allTransactions.push(...result.data);
        hasMore = result.pagination.hasMore;
        page++;
      }
      return allTransactions;
    },
    [selectedAccountIds, rangeStart, rangeEnd, isValid],
  );

  // Only the first load shows the full skeleton. Later reloads (e.g. changing
  // the account filter) keep the existing content -- and the account dropdown --
  // mounted so they update in place instead of unmounting the whole report.
  const transactions = useMemo<InvestmentTransaction[]>(() => response ?? [], [response]);

  // Action filtering happens client-side so toggling actions never re-fetches.
  const filteredTransactions = useMemo(() => {
    if (selectedActions.length === 0) return transactions;
    const set = new Set(selectedActions);
    return transactions.filter((tx) => set.has(tx.action));
  }, [transactions, selectedActions]);

  const actionSummaries = useMemo((): ActionSummary[] => {
    const map = new Map<InvestmentAction, ActionSummary>();

    filteredTransactions.forEach((tx) => {
      let entry = map.get(tx.action);
      if (!entry) {
        entry = { action: tx.action, count: 0, totalAmount: 0 };
        map.set(tx.action, entry);
      }
      entry.count += 1;
      entry.totalAmount += getTxAmount(tx);
    });

    return Array.from(map.values()).sort((a, b) => b.totalAmount - a.totalAmount);
  }, [filteredTransactions, getTxAmount]);

  const totalAmount = useMemo(
    () => filteredTransactions.reduce((sum, tx) => sum + getTxAmount(tx), 0),
    [filteredTransactions, getTxAmount],
  );

  const accountNameMap = useMemo(() => {
    const map = new Map<string, string>();
    accounts.forEach((a) => map.set(a.id, a.name));
    return map;
  }, [accounts]);

  const sortedTransactions = useMemo(() => {
    const sorted = [...filteredTransactions];
    sorted.sort((a, b) => {
      let comparison = 0;
      switch (sortField) {
        case 'date':
          comparison = compareValues(a.transactionDate, b.transactionDate);
          break;
        case 'action':
          comparison = compareValues(a.action, b.action);
          break;
        case 'security':
          comparison = compareValues(a.security?.symbol || '', b.security?.symbol || '');
          break;
        case 'account':
          comparison = compareValues(
            accountNameMap.get(a.accountId) || '',
            accountNameMap.get(b.accountId) || '',
          );
          break;
        case 'quantity':
          comparison = compareValues(
            a.quantity != null ? Math.abs(a.quantity) : null,
            b.quantity != null ? Math.abs(b.quantity) : null,
          );
          break;
        case 'price':
          comparison = compareValues(a.price, b.price);
          break;
        case 'total':
          comparison = compareValues(getTxAmount(a), getTxAmount(b));
          break;
      }
      return sortDirection === 'asc' ? comparison : -comparison;
    });
    return sorted;
  }, [filteredTransactions, sortField, sortDirection, accountNameMap, getTxAmount]);

  const getExportData = useCallback((formatted: boolean) => {
    const headers = [t('investmentTransactions.colDate'), t('investmentTransactions.colAction'), t('investmentTransactions.colSecurity'), t('investmentTransactions.colAccount'), t('investmentTransactions.colQuantity'), t('investmentTransactions.colPrice'), t('investmentTransactions.colTotal')];
    const rows: (string | number)[][] = sortedTransactions.map((tx) => [
      format(parseLocalDate(tx.transactionDate), 'yyyy-MM-dd'),
      actionLabels[tx.action],
      tx.security?.symbol || '-',
      accountNameMap.get(tx.accountId) || '-',
      tx.quantity != null ? Math.abs(tx.quantity) : '',
      tx.price != null ? (formatted ? fmtValue(tx.price) : tx.price) : '',
      formatted ? fmtValue(Math.abs(tx.totalAmount)) : Math.abs(tx.totalAmount),
    ]);
    return { headers, rows };
  }, [sortedTransactions, accountNameMap, fmtValue, actionLabels, t]);

  const handleExportCsv = useCallback(() => {
    const { headers, rows } = getExportData(false);
    exportToCsv('investment-transactions', headers, rows);
  }, [getExportData]);

  const handleExportPdf = useCallback(async () => {
    const { exportToPdf } = await import('@/lib/pdf-export');
    const { headers, rows } = getExportData(true);
    const accountLabel = selectedAccount
      ? mainAccountName(selectedAccount.name)
      : t('investmentTransactions.allAccounts');
    const uniqueSecurities = new Set(filteredTransactions.filter((tx) => tx.security).map((tx) => tx.security!.symbol)).size;
    await exportToPdf({
      title: t('investmentTransactions.pdfTitle'),
      subtitle: `${accountLabel} | ${filteredTransactions.length} transactions | Total volume: ${fmtValue(totalAmount)}`,
      summaryCards: [
        { label: t('investmentTransactions.totalTransactions'), value: String(filteredTransactions.length), color: '#111827' },
        { label: t('investmentTransactions.totalVolume'), value: fmtValue(totalAmount), color: '#111827' },
        { label: t('investmentTransactions.actionTypes'), value: String(actionSummaries.length), color: '#111827' },
        { label: t('investmentTransactions.securitiesTraded'), value: String(uniqueSecurities), color: '#111827' },
      ],
      tableData: { headers, rows },
      filename: 'investment-transactions',
    });
  }, [getExportData, selectedAccount, filteredTransactions, fmtValue, totalAmount, actionSummaries, t, mainAccountName]);

  if (error) {
    return <ReportError onRetry={reload} />;
  }

  if (isLoading && response === null) {
    return (
      <div className="bg-white dark:bg-gray-800 rounded-lg shadow dark:shadow-gray-700/50 p-6">
        <div className="space-y-4">
          <Skeleton className="h-8 w-1/3" />
          <Skeleton className="h-64 w-full" />
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Summary Cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <div className="bg-white dark:bg-gray-800 rounded-lg shadow dark:shadow-gray-700/50 p-4">
          <div className="text-sm text-gray-500 dark:text-gray-400">{t('investmentTransactions.totalTransactions')}</div>
          <div className="text-xl font-bold text-gray-900 dark:text-gray-100">
            {filteredTransactions.length}
          </div>
        </div>
        <div className="bg-white dark:bg-gray-800 rounded-lg shadow dark:shadow-gray-700/50 p-4">
          <div className="text-sm text-gray-500 dark:text-gray-400">{t('investmentTransactions.totalVolume')}</div>
          <div className="text-xl font-bold text-gray-900 dark:text-gray-100">
            {fmtValue(totalAmount)}
          </div>
        </div>
        <div className="bg-white dark:bg-gray-800 rounded-lg shadow dark:shadow-gray-700/50 p-4">
          <div className="text-sm text-gray-500 dark:text-gray-400">{t('investmentTransactions.actionTypes')}</div>
          <div className="text-xl font-bold text-gray-900 dark:text-gray-100">
            {actionSummaries.length}
          </div>
        </div>
        <div className="bg-white dark:bg-gray-800 rounded-lg shadow dark:shadow-gray-700/50 p-4">
          <div className="text-sm text-gray-500 dark:text-gray-400">{t('investmentTransactions.securitiesTraded')}</div>
          <div className="text-xl font-bold text-gray-900 dark:text-gray-100">
            {new Set(filteredTransactions.filter((tx) => tx.security).map((tx) => tx.security!.symbol)).size}
          </div>
        </div>
      </div>

      {/* Controls */}
      <div className="bg-white dark:bg-gray-800 rounded-lg shadow dark:shadow-gray-700/50 p-4">
        <div className="flex flex-wrap gap-3 items-center">
          <div className="flex gap-3 items-center">
            <ReportAccountMultiSelect
              accounts={accounts}
              value={selectedAccountIds}
              onChange={setSelectedAccountIds}
            />
            <div className="w-48">
              <MultiSelect
                ariaLabel={t('investmentTransactions.filterByAction')}
                placeholder={t('investmentTransactions.allActionsPlaceholder')}
                showSearch={false}
                options={actionOptions}
                value={selectedActions}
                onChange={setSelectedActions}
              />
            </div>
          </div>
          <DateRangeSelector
            ranges={['6m', '1y', '2y', 'all']}
            value={dateRange}
            onChange={setDateRange}
          />
          <div className="ml-auto shrink-0 flex gap-2 items-center">
            <RefreshPricesButton onRefreshComplete={reload} />
            <ExportDropdown onExportCsv={handleExportCsv} onExportPdf={handleExportPdf} disabled={filteredTransactions.length === 0} />
          </div>
        </div>
      </div>

      {/* Action Summary */}
      {actionSummaries.length > 0 && (
        <div className="bg-white dark:bg-gray-800 rounded-lg shadow dark:shadow-gray-700/50 p-6">
          <h3 className="text-lg font-semibold text-gray-900 dark:text-gray-100 mb-4">
            {t('investmentTransactions.activitySummary')}
          </h3>
          <div className="flex flex-wrap gap-3">
            {actionSummaries.map((summary) => (
              <div
                key={summary.action}
                className="flex items-center gap-2 px-3 py-2 rounded-lg bg-gray-50 dark:bg-gray-700/50"
              >
                <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${ACTION_COLORS[summary.action]}`}>
                  {actionLabels[summary.action]}
                </span>
                <span className="text-sm text-gray-900 dark:text-gray-100 font-medium">
                  {summary.count}
                </span>
                <span className="text-sm text-gray-500 dark:text-gray-400">
                  ({fmtValue(summary.totalAmount)})
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Transaction List */}
      {filteredTransactions.length === 0 ? (
        <div className="bg-white dark:bg-gray-800 rounded-lg shadow dark:shadow-gray-700/50 p-6">
          <p className="text-gray-500 dark:text-gray-400 text-center py-8">
            {t('investmentTransactions.noTransactions')}
          </p>
        </div>
      ) : (
        <div className="bg-white dark:bg-gray-800 rounded-lg shadow dark:shadow-gray-700/50 overflow-hidden">
          <div className="px-6 py-4 border-b border-gray-200 dark:border-gray-700">
            <h3 className="text-lg font-semibold text-gray-900 dark:text-gray-100">
              {t('investmentTransactions.transactionHistory', { count: filteredTransactions.length })}
            </h3>
          </div>
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-gray-200 dark:divide-gray-700">
              <thead className="bg-gray-50 dark:bg-gray-900/50">
                <tr>
                  <SortableHeader<InvestmentTxSortField>
                    field="date"
                    sortField={sortField}
                    sortDirection={sortDirection}
                    onSort={handleSort}
                    className="px-4 py-3 text-xs font-medium text-gray-500 dark:text-gray-400 uppercase"
                  >
                    {t('investmentTransactions.colDate')}
                  </SortableHeader>
                  <SortableHeader<InvestmentTxSortField>
                    field="action"
                    sortField={sortField}
                    sortDirection={sortDirection}
                    onSort={handleSort}
                    className="px-4 py-3 text-xs font-medium text-gray-500 dark:text-gray-400 uppercase"
                  >
                    {t('investmentTransactions.colAction')}
                  </SortableHeader>
                  <SortableHeader<InvestmentTxSortField>
                    field="security"
                    sortField={sortField}
                    sortDirection={sortDirection}
                    onSort={handleSort}
                    className="px-4 py-3 text-xs font-medium text-gray-500 dark:text-gray-400 uppercase"
                  >
                    {t('investmentTransactions.colSecurity')}
                  </SortableHeader>
                  <SortableHeader<InvestmentTxSortField>
                    field="account"
                    sortField={sortField}
                    sortDirection={sortDirection}
                    onSort={handleSort}
                    className="px-4 py-3 text-xs font-medium text-gray-500 dark:text-gray-400 uppercase hidden md:table-cell"
                  >
                    {t('investmentTransactions.colAccount')}
                  </SortableHeader>
                  <SortableHeader<InvestmentTxSortField>
                    field="quantity"
                    sortField={sortField}
                    sortDirection={sortDirection}
                    onSort={handleSort}
                    align="right"
                    className="px-4 py-3 text-xs font-medium text-gray-500 dark:text-gray-400 uppercase"
                  >
                    {t('investmentTransactions.colQuantity')}
                  </SortableHeader>
                  <SortableHeader<InvestmentTxSortField>
                    field="price"
                    sortField={sortField}
                    sortDirection={sortDirection}
                    onSort={handleSort}
                    align="right"
                    className="px-4 py-3 text-xs font-medium text-gray-500 dark:text-gray-400 uppercase"
                  >
                    {t('investmentTransactions.colPrice')}
                  </SortableHeader>
                  <SortableHeader<InvestmentTxSortField>
                    field="total"
                    sortField={sortField}
                    sortDirection={sortDirection}
                    onSort={handleSort}
                    align="right"
                    className="px-4 py-3 text-xs font-medium text-gray-500 dark:text-gray-400 uppercase"
                  >
                    {t('investmentTransactions.colTotal')}
                  </SortableHeader>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-200 dark:divide-gray-700">
                {sortedTransactions.map((tx) => (
                  <tr key={tx.id} className="hover:bg-gray-50 dark:hover:bg-gray-700/50">
                    <td className="px-4 py-3 text-sm text-gray-900 dark:text-gray-100 whitespace-nowrap">
                      {format(parseLocalDate(tx.transactionDate), 'MMM d, yyyy')}
                    </td>
                    <td className="px-4 py-3">
                      <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${ACTION_COLORS[tx.action]}`}>
                        {actionLabels[tx.action]}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <div className="font-medium text-sm text-gray-900 dark:text-gray-100">
                        {tx.security?.symbol || '-'}
                      </div>
                      {tx.security?.name && (
                        <div className="text-xs text-gray-500 dark:text-gray-400">
                          {tx.security.name}
                        </div>
                      )}
                    </td>
                    <td className="px-4 py-3 text-sm text-gray-500 dark:text-gray-400 hidden md:table-cell">
                      {accountNameMap.get(tx.accountId) || '-'}
                    </td>
                    <td className="px-4 py-3 text-right text-sm text-gray-900 dark:text-gray-100">
                      {tx.quantity != null ? Math.abs(tx.quantity).toFixed(4) : '-'}
                    </td>
                    <td className="px-4 py-3 text-right text-sm text-gray-900 dark:text-gray-100">
                      {tx.price != null ? fmtValue(tx.price) : '-'}
                    </td>
                    <td className="px-4 py-3 text-right text-sm font-medium text-gray-900 dark:text-gray-100">
                      {fmtValue(Math.abs(tx.totalAmount))}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
