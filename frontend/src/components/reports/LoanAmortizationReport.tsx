'use client';

import { useState, useEffect, useMemo, Fragment } from 'react';
import { Skeleton } from '@/components/ui/LoadingSkeleton';
import { format, parseISO } from 'date-fns';
import { accountsApi } from '@/lib/accounts';
import { Transaction } from '@/types/transaction';
import { generateLoanSchedule } from '@/lib/loan-schedule';
import {
  buildLoanProjectionInput,
  deriveLoanPaymentHistory,
  fetchAllAccountTransactions,
  fetchLoanInterestTransactions,
} from '@/lib/loan-history';
import { useNumberFormat } from '@/hooks/useNumberFormat';
import { exportToCsv } from '@/lib/csv-export';
import { ExportDropdown } from '@/components/ui/ExportDropdown';
import { SortableHeader } from '@/components/ui/SortableHeader';
import { useSortableTable, compareValues } from '@/hooks/useSortableTable';
import { useReportData } from '@/hooks/useReportData';
import { ReportError } from '@/components/reports/ReportError';
import { createLogger } from '@/lib/logger';
import { useTranslations } from 'next-intl';

const logger = createLogger('LoanAmortizationReport');

type AmortizationSortField = 'paymentNumber' | 'date' | 'payment' | 'principal' | 'interest' | 'balance';

interface PaymentRow {
  paymentNumber: number;
  date: string;
  payment: number;
  principal: number;
  interest: number;
  balance: number;
  isProjected: boolean;
}

export function LoanAmortizationReport() {
  const t = useTranslations('reports');
  const { formatCurrency } = useNumberFormat();

  const friendlyAccountType = (type: string): string => {
    switch (type) {
      case 'LINE_OF_CREDIT': return t('loanAmortization.typeLineOfCredit');
      case 'LOAN': return t('loanAmortization.typeLoan');
      case 'MORTGAGE': return t('loanAmortization.typeMortgage');
      default: return type.charAt(0) + type.slice(1).toLowerCase();
    }
  };
  const [selectedAccountId, setSelectedAccountId] = useState<string>('');
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [interestTransactions, setInterestTransactions] = useState<Transaction[]>([]);
  const [showAllRows, setShowAllRows] = useState(false);
  const { sortField, sortDirection, handleSort } = useSortableTable<AmortizationSortField>(
    'reports.loan-amortization.sort',
    { field: 'paymentNumber', direction: 'asc' },
  );

  // Load all accounts and filter for loans.
  const { data: fetchedAccounts, isLoading, error, reload } = useReportData(
    () => accountsApi.getAll(true),
    [],
  );

  const accounts = useMemo(
    () =>
      (fetchedAccounts ?? []).filter(
        (a) => a.accountType === 'LOAN' || a.accountType === 'MORTGAGE' || a.accountType === 'LINE_OF_CREDIT',
      ),
    [fetchedAccounts],
  );

  // Default the selection to the first loan once accounts arrive. Seeded during
  // render (not in an effect) so the transactions fetch carries it immediately.
  const [seededAccounts, setSeededAccounts] = useState(false);
  if (!seededAccounts && accounts.length > 0) {
    setSeededAccounts(true);
    setSelectedAccountId(accounts[0].id);
  }

  const selectedAccount = accounts.find((a) => a.id === selectedAccountId);

  // Load the loan account's transactions plus its separately-booked interest
  // expenses, so the derived interest matches the loan detail page (see #893).
  useEffect(() => {
    const loadTransactions = async () => {
      if (!selectedAccountId) {
        setTransactions([]);
        setInterestTransactions([]);
        return;
      }

      const account = accounts.find((a) => a.id === selectedAccountId);
      try {
        const [txns, interest] = await Promise.all([
          fetchAllAccountTransactions(selectedAccountId),
          account ? fetchLoanInterestTransactions(account) : Promise.resolve([]),
        ]);
        setTransactions(txns);
        setInterestTransactions(interest);
      } catch (error) {
        logger.error('Failed to load transactions:', error);
        setTransactions([]);
        setInterestTransactions([]);
      }
    };

    loadTransactions();
  }, [selectedAccountId, accounts]);

  // Build payment history from actual transactions + projected future payments
  const paymentHistory = useMemo((): PaymentRow[] => {
    if (!selectedAccount) return [];

    // --- Historical payments from actual transactions ---
    const history = deriveLoanPaymentHistory(selectedAccount, transactions, [], interestTransactions);
    const payments: PaymentRow[] = history.events.map((event, index) => ({
      paymentNumber: index + 1,
      date: event.date,
      payment: event.principal + event.interest,
      principal: event.principal,
      interest: event.interest,
      balance: event.balance,
      isProjected: false,
    }));

    // --- Project future payments ---
    const projectionInput = buildLoanProjectionInput(selectedAccount, history);
    if (projectionInput) {
      const projection = generateLoanSchedule(projectionInput);

      for (const row of projection.rows) {
        payments.push({
          paymentNumber: history.events.length + row.paymentNumber,
          date: row.date,
          payment: row.payment,
          principal: row.principal,
          interest: row.interest,
          balance: row.balance,
          isProjected: true,
        });
      }
    }

    return payments;
  }, [selectedAccount, transactions, interestTransactions]);

  const historicalCount = useMemo(() => paymentHistory.filter((r) => !r.isProjected).length, [paymentHistory]);
  const hasProjection = useMemo(() => paymentHistory.some((r) => r.isProjected), [paymentHistory]);

  const summary = useMemo(() => {
    if (paymentHistory.length === 0 || !selectedAccount) return null;

    const totalInterest = paymentHistory.reduce((sum, row) => sum + row.interest, 0);
    const totalPrincipal = paymentHistory.reduce((sum, row) => sum + row.principal, 0);
    const totalPaymentAmount = paymentHistory.reduce((sum, row) => sum + row.payment, 0);
    const lastRow = paymentHistory[paymentHistory.length - 1];
    const currentBalance = Math.abs(selectedAccount.currentBalance);
    const originalBalance = Math.abs(selectedAccount.openingBalance) || (totalPrincipal + currentBalance);

    return {
      totalPayments: totalPaymentAmount,
      totalPrincipal,
      totalInterest,
      numberOfPayments: historicalCount,
      lastPaymentDate: lastRow.date,
      originalBalance,
      hasProjection,
      projectedPayoffDate: hasProjection ? lastRow.date : null,
    };
  }, [paymentHistory, selectedAccount, historicalCount, hasProjection]);

  const getExportData = (formatted: boolean) => {
    const headers = [t('loanAmortization.colNumber'), t('loanAmortization.colDate'), t('loanAmortization.colPayment'), t('loanAmortization.colPrincipal'), t('loanAmortization.colInterest'), t('loanAmortization.colBalance'), t('loanAmortization.colType')];
    const currency = selectedAccount?.currencyCode;
    const rows = paymentHistory.map((row) => [
      row.paymentNumber,
      format(parseISO(row.date), 'yyyy-MM-dd'),
      formatted ? formatCurrency(row.payment, currency) : row.payment,
      formatted ? formatCurrency(row.principal, currency) : row.principal,
      formatted ? formatCurrency(row.interest, currency) : row.interest,
      formatted ? formatCurrency(row.balance, currency) : row.balance,
      row.isProjected ? t('loanAmortization.typeProjected') : t('loanAmortization.typeActual'),
    ]);
    return { headers, rows };
  };

  const handleExportCsv = () => {
    const { headers, rows } = getExportData(false);
    const accountName = selectedAccount?.name?.replace(/[^a-zA-Z0-9]/g, '-') || 'loan';
    exportToCsv(`amortization-${accountName}`, headers, rows);
  };

  const handleExportPdf = async () => {
    const { exportToPdf } = await import('@/lib/pdf-export');
    const currency = selectedAccount?.currencyCode;
    const { headers, rows } = getExportData(true);
    const accountName = selectedAccount?.name?.replace(/[^a-zA-Z0-9]/g, '-') || 'loan';
    const cards = [];
    if (selectedAccount) {
      cards.push(
        { label: t('loanAmortization.currentBalance'), value: formatCurrency(Math.abs(selectedAccount.currentBalance), currency), color: '#dc2626' },
        { label: t('loanAmortization.originalAmount'), value: formatCurrency(summary?.originalBalance || Math.abs(selectedAccount.openingBalance), currency), color: '#111827' },
        { label: t('loanAmortization.interestRate'), value: selectedAccount.interestRate ? `${selectedAccount.interestRate}%` : t('loanAmortization.notSet'), color: '#111827' },
        { label: summary?.hasProjection ? t('loanAmortization.estTotalInterest') : t('loanAmortization.totalInterestPaid'), value: formatCurrency(summary?.totalInterest || 0, currency), color: '#ea580c' },
        { label: t('loanAmortization.paymentsMade'), value: String(historicalCount), color: '#16a34a' },
      );
      if (summary?.hasProjection && summary.projectedPayoffDate) {
        cards.push({ label: t('loanAmortization.estPayoff'), value: format(parseISO(summary.projectedPayoffDate), 'MMM yyyy'), color: '#9333ea' });
      }
    }
    await exportToPdf({
      title: `${t('loanAmortization.pdfTitlePrefix')}${selectedAccount?.name || t('loanAmortization.typeLoan')}`,
      subtitle: summary ? t('loanAmortization.pdfSubtitlePaymentsSummary', { count: historicalCount, interest: formatCurrency(summary.totalInterest, currency) }) : undefined,
      summaryCards: cards.length > 0 ? cards : undefined,
      tableData: { headers, rows },
      filename: `amortization-${accountName}`,
    });
  };

  const sortedPaymentHistory = useMemo(() => {
    const sorted = [...paymentHistory];
    sorted.sort((a, b) => {
      let comparison = 0;
      switch (sortField) {
        case 'paymentNumber':
          comparison = compareValues(a.paymentNumber, b.paymentNumber);
          break;
        case 'date':
          comparison = compareValues(a.date, b.date);
          break;
        case 'payment':
          comparison = compareValues(a.payment, b.payment);
          break;
        case 'principal':
          comparison = compareValues(a.principal, b.principal);
          break;
        case 'interest':
          comparison = compareValues(a.interest, b.interest);
          break;
        case 'balance':
          comparison = compareValues(a.balance, b.balance);
          break;
      }
      return sortDirection === 'asc' ? comparison : -comparison;
    });
    return sorted;
  }, [paymentHistory, sortField, sortDirection]);

  const displayedRows = showAllRows
    ? sortedPaymentHistory
    : sortedPaymentHistory.slice(0, 24);

  if (error) {
    return <ReportError onRetry={reload} />;
  }

  if (isLoading) {
    return (
      <div className="bg-white dark:bg-gray-800 rounded-lg shadow dark:shadow-gray-700/50 p-6">
        <div className="space-y-4">
          <Skeleton className="h-8 w-1/3" />
          <Skeleton className="h-64 w-full" />
        </div>
      </div>
    );
  }

  if (accounts.length === 0) {
    return (
      <div className="bg-white dark:bg-gray-800 rounded-lg shadow dark:shadow-gray-700/50 p-6">
        <p className="text-gray-500 dark:text-gray-400 text-center py-8">
          {t('loanAmortization.empty')}
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Account Selector */}
      <div className="bg-white dark:bg-gray-800 rounded-lg shadow dark:shadow-gray-700/50 p-4">
        <div className="flex flex-wrap gap-4 items-end">
          <div className="flex-1 min-w-[200px]">
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
              {t('loanAmortization.labelSelectLoan')}
            </label>
            <select
              value={selectedAccountId}
              onChange={(e) => setSelectedAccountId(e.target.value)}
              className="w-full rounded-md border-gray-300 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-100"
            >
              {accounts
                .slice()
                .sort((a, b) => a.name.localeCompare(b.name))
                .map((account) => (
                  <option key={account.id} value={account.id}>
                    {account.name}
                  </option>
                ))}
            </select>
          </div>
          <div className="ml-auto">
            <ExportDropdown onExportCsv={handleExportCsv} onExportPdf={handleExportPdf} />
          </div>
        </div>
      </div>

      {/* Summary Cards */}
      {selectedAccount && (
        <div className={`grid grid-cols-2 ${summary?.hasProjection ? 'md:grid-cols-6' : 'md:grid-cols-5'} gap-4`}>
          <div className="bg-white dark:bg-gray-800 rounded-lg shadow dark:shadow-gray-700/50 p-4">
            <div className="text-sm text-gray-500 dark:text-gray-400">{t('loanAmortization.currentBalance')}</div>
            <div className="text-lg font-bold text-red-600 dark:text-red-400">
              {formatCurrency(Math.abs(selectedAccount.currentBalance))}
            </div>
          </div>
          <div className="bg-white dark:bg-gray-800 rounded-lg shadow dark:shadow-gray-700/50 p-4">
            <div className="text-sm text-gray-500 dark:text-gray-400">{t('loanAmortization.originalAmount')}</div>
            <div className="text-lg font-bold text-gray-900 dark:text-gray-100">
              {formatCurrency(summary?.originalBalance || Math.abs(selectedAccount.openingBalance))}
            </div>
          </div>
          <div className="bg-white dark:bg-gray-800 rounded-lg shadow dark:shadow-gray-700/50 p-4">
            <div className="text-sm text-gray-500 dark:text-gray-400">{t('loanAmortization.interestRate')}</div>
            <div className="text-lg font-bold text-gray-900 dark:text-gray-100">
              {selectedAccount.interestRate ? `${selectedAccount.interestRate}%` : t('loanAmortization.notSet')}
            </div>
          </div>
          <div className="bg-white dark:bg-gray-800 rounded-lg shadow dark:shadow-gray-700/50 p-4">
            <div className="text-sm text-gray-500 dark:text-gray-400">
              {summary?.hasProjection ? t('loanAmortization.estTotalInterest') : t('loanAmortization.totalInterestPaid')}
            </div>
            <div className="text-lg font-bold text-orange-600 dark:text-orange-400">
              {formatCurrency(summary?.totalInterest || 0)}
            </div>
          </div>
          <div className="bg-white dark:bg-gray-800 rounded-lg shadow dark:shadow-gray-700/50 p-4">
            <div className="text-sm text-gray-500 dark:text-gray-400">{t('loanAmortization.paymentsMade')}</div>
            <div className="text-lg font-bold text-green-600 dark:text-green-400">
              {historicalCount}
            </div>
          </div>
          {summary?.hasProjection && summary.projectedPayoffDate && (
            <div className="bg-white dark:bg-gray-800 rounded-lg shadow dark:shadow-gray-700/50 p-4">
              <div className="text-sm text-gray-500 dark:text-gray-400">{t('loanAmortization.estPayoff')}</div>
              <div className="text-lg font-bold text-purple-600 dark:text-purple-400">
                {format(parseISO(summary.projectedPayoffDate), 'MMM yyyy')}
              </div>
            </div>
          )}
        </div>
      )}

      {/* Account Details */}
      {selectedAccount && (
        <div className="bg-white dark:bg-gray-800 rounded-lg shadow dark:shadow-gray-700/50 p-4">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
            <div>
              <span className="text-gray-500 dark:text-gray-400">{t('loanAmortization.accountType')}</span>
              <p className="font-medium text-gray-900 dark:text-gray-100">
                {friendlyAccountType(selectedAccount.accountType)}
              </p>
            </div>
            <div>
              <span className="text-gray-500 dark:text-gray-400">{t('loanAmortization.paymentFrequency')}</span>
              <p className="font-medium text-gray-900 dark:text-gray-100">
                {selectedAccount.paymentFrequency
                  ? selectedAccount.paymentFrequency.charAt(0) + selectedAccount.paymentFrequency.slice(1).toLowerCase().replace('_', '-')
                  : t('loanAmortization.notSet')}
              </p>
            </div>
            <div>
              <span className="text-gray-500 dark:text-gray-400">{t('loanAmortization.paymentAmount')}</span>
              <p className="font-medium text-gray-900 dark:text-gray-100">
                {selectedAccount.paymentAmount ? formatCurrency(selectedAccount.paymentAmount) : t('loanAmortization.notSet')}
              </p>
            </div>
            <div>
              <span className="text-gray-500 dark:text-gray-400">{t('loanAmortization.status')}</span>
              <p className="font-medium text-gray-900 dark:text-gray-100">
                {selectedAccount.isClosed ? t('loanAmortization.statusClosed') : t('loanAmortization.statusActive')}
              </p>
            </div>
          </div>
        </div>
      )}

      {/* Payment History Table */}
      <div className="bg-white dark:bg-gray-800 rounded-lg shadow dark:shadow-gray-700/50 overflow-hidden">
        <div className="px-6 py-4 border-b border-gray-200 dark:border-gray-700">
          <h3 className="text-lg font-semibold text-gray-900 dark:text-gray-100">
            {hasProjection ? t('loanAmortization.paymentHistoryProjection') : t('loanAmortization.paymentHistory')}
          </h3>
          {summary && (
            <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
              {t('loanAmortization.paymentsMadeSummary', { count: historicalCount })}
              {hasProjection && ` ${t('loanAmortization.plusProjected', { count: paymentHistory.length - historicalCount })}`}
              {' '}{t('loanAmortization.totalingSuffix', { amount: formatCurrency(summary.totalPayments) })}
            </p>
          )}
        </div>

        {paymentHistory.length === 0 ? (
          <p className="px-6 py-8 text-gray-500 dark:text-gray-400 text-center">
            {t('loanAmortization.noPayments')}
          </p>
        ) : (
          <>
            <div className="overflow-x-auto">
              <table className="min-w-full divide-y divide-gray-200 dark:divide-gray-700">
                <thead className="bg-gray-50 dark:bg-gray-900/50">
                  <tr>
                    <SortableHeader<AmortizationSortField>
                      field="paymentNumber"
                      sortField={sortField}
                      sortDirection={sortDirection}
                      onSort={handleSort}
                      className="px-4 py-3 text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider"
                    >
                      {t('loanAmortization.colNumber')}
                    </SortableHeader>
                    <SortableHeader<AmortizationSortField>
                      field="date"
                      sortField={sortField}
                      sortDirection={sortDirection}
                      onSort={handleSort}
                      className="px-4 py-3 text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider"
                    >
                      {t('loanAmortization.colDate')}
                    </SortableHeader>
                    <SortableHeader<AmortizationSortField>
                      field="payment"
                      sortField={sortField}
                      sortDirection={sortDirection}
                      onSort={handleSort}
                      align="right"
                      className="px-4 py-3 text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider"
                    >
                      {t('loanAmortization.colPayment')}
                    </SortableHeader>
                    <SortableHeader<AmortizationSortField>
                      field="principal"
                      sortField={sortField}
                      sortDirection={sortDirection}
                      onSort={handleSort}
                      align="right"
                      className="px-4 py-3 text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider"
                    >
                      {t('loanAmortization.colPrincipal')}
                    </SortableHeader>
                    <SortableHeader<AmortizationSortField>
                      field="interest"
                      sortField={sortField}
                      sortDirection={sortDirection}
                      onSort={handleSort}
                      align="right"
                      className="px-4 py-3 text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider"
                    >
                      {t('loanAmortization.colInterest')}
                    </SortableHeader>
                    <SortableHeader<AmortizationSortField>
                      field="balance"
                      sortField={sortField}
                      sortDirection={sortDirection}
                      onSort={handleSort}
                      align="right"
                      className="px-4 py-3 text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider"
                    >
                      {t('loanAmortization.colBalance')}
                    </SortableHeader>
                  </tr>
                </thead>
                <tbody className="bg-white dark:bg-gray-800 divide-y divide-gray-200 dark:divide-gray-700">
                  {displayedRows.map((row, idx) => {
                    // Show a separator row when transitioning from historical to projected
                    const prevRow = idx > 0 ? displayedRows[idx - 1] : null;
                    const showSeparator = row.isProjected && prevRow && !prevRow.isProjected;
                    return (
                      <Fragment key={row.paymentNumber}>
                        {showSeparator && (
                          <tr className="bg-gray-100 dark:bg-gray-700">
                            <td colSpan={6} className="px-4 py-2 text-center text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider">
                              {t('loanAmortization.projectedFuturePayments')}
                            </td>
                          </tr>
                        )}
                        <tr
                          className={`hover:bg-gray-50 dark:hover:bg-gray-700/50 ${
                            row.isProjected ? 'bg-blue-50/50 dark:bg-blue-900/10' : ''
                          }`}
                        >
                          <td className="px-4 py-3 whitespace-nowrap text-sm text-gray-500 dark:text-gray-400">
                            {row.paymentNumber}
                          </td>
                          <td className="px-4 py-3 whitespace-nowrap text-sm text-gray-900 dark:text-gray-100">
                            {format(parseISO(row.date), 'MMM d, yyyy')}
                            {row.isProjected && (
                              <span className="ml-1.5 text-xs text-blue-500 dark:text-blue-400">*</span>
                            )}
                          </td>
                          <td className="px-4 py-3 whitespace-nowrap text-sm text-right text-gray-900 dark:text-gray-100">
                            {formatCurrency(row.payment)}
                          </td>
                          <td className="px-4 py-3 whitespace-nowrap text-sm text-right text-green-600 dark:text-green-400">
                            {formatCurrency(row.principal)}
                          </td>
                          <td className="px-4 py-3 whitespace-nowrap text-sm text-right text-orange-600 dark:text-orange-400">
                            {formatCurrency(row.interest)}
                          </td>
                          <td className="px-4 py-3 whitespace-nowrap text-sm text-right font-medium text-gray-900 dark:text-gray-100">
                            {formatCurrency(row.balance)}
                          </td>
                        </tr>
                      </Fragment>
                    );
                  })}
                </tbody>
              </table>
            </div>

            {paymentHistory.length > 24 && (
              <div className="px-6 py-4 border-t border-gray-200 dark:border-gray-700">
                <button
                  onClick={() => setShowAllRows(!showAllRows)}
                  className="text-blue-600 dark:text-blue-400 text-sm font-medium hover:underline"
                >
                  {showAllRows
                    ? t('loanAmortization.showLess')
                    : t('loanAmortization.showAll', { count: paymentHistory.length })}
                </button>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
