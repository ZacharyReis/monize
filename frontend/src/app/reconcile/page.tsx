'use client';

import { useState, useEffect, useMemo } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { format } from 'date-fns';
import toast from 'react-hot-toast';
import { useTranslations } from 'next-intl';
import { ProtectedRoute } from '@/components/auth/ProtectedRoute';
import { PageLayout } from '@/components/layout/PageLayout';
import { PageHeader } from '@/components/layout/PageHeader';
import { Button } from '@/components/ui/Button';
import { DateInput } from '@/components/ui/DateInput';
import { CurrencyInput } from '@/components/ui/CurrencyInput';
import { Select } from '@/components/ui/Select';
import { transactionsApi } from '@/lib/transactions';
import { scheduledTransactionsApi } from '@/lib/scheduled-transactions';
import { getLocalDateString } from '@/lib/utils';
import { accountsApi } from '@/lib/accounts';
import { Account } from '@/types/account';
import { ScheduledTransaction } from '@/types/scheduled-transaction';
import { ReconciliationData, TransactionStatus } from '@/types/transaction';
import { useNumberFormat } from '@/hooks/useNumberFormat';
import { getCurrencySymbol } from '@/lib/format';
import { getErrorMessage } from '@/lib/errors';

const LIABILITY_TYPES = new Set(['CREDIT_CARD', 'LOAN', 'MORTGAGE', 'LINE_OF_CREDIT']);

// Revolving-credit accounts whose balance changes each statement, so the
// payment that pays them off should track the reconciled balance. Loans and
// mortgages have fixed payments and are intentionally excluded.
const PAYMENT_PROMPT_TYPES = new Set(['CREDIT_CARD', 'LINE_OF_CREDIT']);

type ReconcileStep = 'setup' | 'reconcile' | 'complete';

export default function ReconcilePage() {
  return (
    <ProtectedRoute>
      <ReconcileContent />
    </ProtectedRoute>
  );
}

function ReconcileContent() {
  const router = useRouter();
  const t = useTranslations('reconcile');
  const tc = useTranslations('common');
  const searchParams = useSearchParams();
  const preselectedAccountId = searchParams.get('accountId');
  const { formatCurrency: formatCurrencyBase, defaultCurrency } = useNumberFormat();

  const [step, setStep] = useState<ReconcileStep>('setup');
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [selectedAccountId, setSelectedAccountId] = useState<string>(preselectedAccountId || '');
  const [statementDate, setStatementDate] = useState<string>(
    getLocalDateString()
  );
  const [statementBalance, setStatementBalance] = useState<number | undefined>(undefined);
  const [reconciliationData, setReconciliationData] = useState<ReconciliationData | null>(null);
  const [selectedTransactionIds, setSelectedTransactionIds] = useState<Set<string>>(new Set());
  const [isLoading, setIsLoading] = useState(false);
  const [isReconciling, setIsReconciling] = useState(false);
  // Post-reconciliation liability-payment prompt: the scheduled bill (if any)
  // that pays down the reconciled liability account.
  const [paymentBill, setPaymentBill] = useState<ScheduledTransaction | null>(null);

  // Load accounts
  useEffect(() => {
    const loadAccounts = async () => {
      try {
        const data = await accountsApi.getAll();
        // Filter out investment brokerage accounts
        const filteredAccounts = data.filter(
          (a) => a.accountSubType !== 'INVESTMENT_BROKERAGE' && !a.isClosed
        );
        setAccounts(filteredAccounts);
      } catch (error) {
        toast.error(getErrorMessage(error, t('toasts.loadAccountsFailed')));
      }
    };
    loadAccounts();
  }, [t]);

  const selectedAccount = useMemo(
    () => accounts.find((a) => a.id === selectedAccountId),
    [accounts, selectedAccountId]
  );

  const isLiability = selectedAccount ? LIABILITY_TYPES.has(selectedAccount.accountType) : false;

  // Only revolving-credit accounts get the post-reconciliation payment prompt.
  const offersPaymentPrompt = selectedAccount
    ? PAYMENT_PROMPT_TYPES.has(selectedAccount.accountType)
    : false;

  // For liability accounts, auto-negate positive entries. If the user explicitly
  // flips the sign (same absolute value), respect their choice -- mirrors the
  // sign-handling pattern in TransactionForm.
  const handleStatementBalanceChange = (value: number | undefined) => {
    if (value === undefined || value === 0 || !isLiability) {
      setStatementBalance(value);
      return;
    }

    const currentAbs = statementBalance !== undefined ? Math.abs(statementBalance) : 0;
    const newAbs = Math.abs(value);
    const isJustSignChange = currentAbs === newAbs && currentAbs !== 0;

    if (isJustSignChange) {
      setStatementBalance(value);
      return;
    }

    setStatementBalance(value > 0 ? -value : value);
  };

  const handleStartReconciliation = async () => {
    if (!selectedAccountId || !statementDate || statementBalance === undefined) {
      toast.error(t('toasts.fillAllFields'));
      return;
    }

    setIsLoading(true);
    try {
      const data = await transactionsApi.getReconciliationData(
        selectedAccountId,
        statementDate,
        statementBalance
      );
      setReconciliationData(data);

      // Pre-select all cleared transactions
      const clearedIds = new Set(
        data.transactions
          .filter((t) => t.status === TransactionStatus.CLEARED)
          .map((t) => t.id)
      );
      setSelectedTransactionIds(clearedIds);

      setStep('reconcile');
    } catch (error) {
      toast.error(getErrorMessage(error, t('toasts.loadDataFailed')));
    } finally {
      setIsLoading(false);
    }
  };

  const handleToggleTransaction = (transactionId: string) => {
    setSelectedTransactionIds((prev) => {
      const newSet = new Set(prev);
      if (newSet.has(transactionId)) {
        newSet.delete(transactionId);
      } else {
        newSet.add(transactionId);
      }
      return newSet;
    });
  };

  const handleSelectAll = () => {
    if (reconciliationData) {
      setSelectedTransactionIds(new Set(reconciliationData.transactions.map((t) => t.id)));
    }
  };

  const handleSelectNone = () => {
    setSelectedTransactionIds(new Set());
  };

  // Calculate the current difference based on selected transactions
  // Use rounding to avoid floating-point precision drift from summing many decimals
  const calculatedDifference = useMemo(() => {
    if (!reconciliationData) return 0;

    const selectedSum = reconciliationData.transactions
      .filter((t) => selectedTransactionIds.has(t.id))
      .reduce((sum, t) => sum + Number(t.amount), 0);

    const newBalance = Number(reconciliationData.reconciledBalance) + selectedSum;
    return Math.round(((statementBalance ?? 0) - newBalance) * 100) / 100;
  }, [reconciliationData, selectedTransactionIds, statementBalance]);

  const handleFinishReconciliation = async () => {
    if (Math.abs(calculatedDifference) > 0.01) {
      toast.error(t('toasts.differenceRequired', { amount: formatCurrency(0) }));
      return;
    }

    if (selectedTransactionIds.size === 0) {
      toast.error(t('toasts.noneSelected'));
      return;
    }

    setIsReconciling(true);
    try {
      const result = await transactionsApi.bulkReconcile(
        selectedAccountId,
        Array.from(selectedTransactionIds),
        statementDate
      );
      toast.success(t('toasts.success', { count: result.reconciled }));

      // For revolving-credit accounts, look for an existing scheduled bill that
      // pays down this account so we can offer to update its next instance.
      if (offersPaymentPrompt) {
        try {
          const scheduled = await scheduledTransactionsApi.getAll();
          const match = scheduled.find(
            (st) =>
              (st.isTransfer && st.transferAccountId === selectedAccountId) ||
              (st.splits?.some((s) => s.transferAccountId === selectedAccountId) ?? false)
          );
          setPaymentBill(match ?? null);
        } catch {
          setPaymentBill(null);
        }
      }

      setStep('complete');
    } catch (error) {
      toast.error(getErrorMessage(error, t('toasts.reconcileFailed')));
    } finally {
      setIsReconciling(false);
    }
  };

  const handleCancel = () => {
    setStep('setup');
    setReconciliationData(null);
    setSelectedTransactionIds(new Set());
  };

  // The amount to apply to the liability payment: the reconciled balance owed,
  // as a positive figure (liability balances are stored negative).
  const reconciledPaymentAmount = Math.round(Math.abs(statementBalance ?? 0) * 100) / 100;

  const handleUpdatePayment = () => {
    if (!paymentBill) return;
    router.push(
      `/bills?reconcileEditId=${paymentBill.id}&reconcileAmount=${reconciledPaymentAmount}`
    );
  };

  const handleCreatePayment = () => {
    router.push(
      `/bills?reconcileCreate=1&reconcileTransferAccountId=${selectedAccountId}` +
        `&reconcileAmount=${reconciledPaymentAmount}`
    );
  };

  const formatCurrency = (amount: number | string | null | undefined) => {
    const numericAmount = Number(amount) || 0;
    const currency = selectedAccount?.currencyCode || defaultCurrency;
    const formatted = formatCurrencyBase(numericAmount, currency);

    // Only show currency code if it differs from user's default currency
    if (currency !== defaultCurrency) {
      return `${formatted} ${currency}`;
    }
    return formatted;
  };

  const renderSetupStep = () => (
    <div className="max-w-xl mx-auto">
      <div className="bg-white dark:bg-gray-800 rounded-lg shadow p-6">
        <h2 className="text-xl font-semibold text-gray-900 dark:text-gray-100 mb-4">
          {t('setup.title')}
        </h2>
        <p className="text-gray-600 dark:text-gray-400 mb-6">
          {t('setup.intro')}
        </p>

        <div className="space-y-4">
          <Select
            label={t('setup.accountLabel')}
            options={[
              { value: '', label: t('setup.accountPlaceholder') },
              ...accounts.map((a) => ({
                value: a.id,
                label: `${a.name} (${formatCurrency(a.currentBalance)})`,
              })),
            ]}
            value={selectedAccountId}
            onChange={(e) => setSelectedAccountId(e.target.value)}
          />

          <DateInput
            label={t('setup.statementDateLabel')}
            value={statementDate}
            onDateChange={(date) => setStatementDate(date)}
            onChange={() => {}}
          />

          <CurrencyInput
            label={t('setup.statementBalanceLabel')}
            prefix={getCurrencySymbol(selectedAccount?.currencyCode || defaultCurrency)}
            placeholder={isLiability ? '-0.00' : '0.00'}
            value={statementBalance}
            onChange={handleStatementBalanceChange}
          />
        </div>

        <div className="flex justify-between mt-6">
          <Button variant="outline" onClick={() => router.push('/accounts')}>
            {tc('cancel')}
          </Button>
          <Button
            onClick={handleStartReconciliation}
            isLoading={isLoading}
            disabled={!selectedAccountId || !statementDate || statementBalance === undefined}
          >
            {t('setup.start')}
          </Button>
        </div>
      </div>
    </div>
  );

  const renderReconcileStep = () => {
    if (!reconciliationData) return null;

    const selectedCount = selectedTransactionIds.size;
    const totalCount = reconciliationData.transactions.length;

    return (
      <div className="px-4 sm:px-6 lg:px-12">
        {/* Summary Bar */}
        <div className="bg-white dark:bg-gray-800 rounded-lg shadow p-4 mb-6">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <div>
              <p className="text-xs text-gray-500 dark:text-gray-400 uppercase">{t('summary.statementBalance')}</p>
              <p className="text-lg font-semibold text-gray-900 dark:text-gray-100">
                {formatCurrency(statementBalance ?? 0)}
              </p>
            </div>
            <div>
              <p className="text-xs text-gray-500 dark:text-gray-400 uppercase">{t('summary.reconciledBalance')}</p>
              <p className="text-lg font-semibold text-gray-900 dark:text-gray-100">
                {formatCurrency(reconciliationData.reconciledBalance)}
              </p>
            </div>
            <div>
              <p className="text-xs text-gray-500 dark:text-gray-400 uppercase">{t('summary.selected', { count: selectedCount })}</p>
              <p className="text-lg font-semibold text-gray-900 dark:text-gray-100">
                {formatCurrency(
                  reconciliationData.transactions
                    .filter((t) => selectedTransactionIds.has(t.id))
                    .reduce((sum, t) => sum + Number(t.amount), 0)
                )}
              </p>
            </div>
            <div>
              <p className="text-xs text-gray-500 dark:text-gray-400 uppercase">{t('summary.difference')}</p>
              <p
                className={`text-lg font-semibold ${
                  Math.abs(calculatedDifference) < 0.01
                    ? 'text-green-600 dark:text-green-400'
                    : 'text-red-600 dark:text-red-400'
                }`}
              >
                {formatCurrency(calculatedDifference)}
              </p>
            </div>
          </div>
        </div>

        {/* Transaction List */}
        <div className="bg-white dark:bg-gray-800 rounded-lg shadow overflow-hidden">
          <div className="p-4 border-b border-gray-200 dark:border-gray-700 flex justify-between items-center">
            <h3 className="text-lg font-semibold text-gray-900 dark:text-gray-100">
              {t('list.heading', { count: totalCount })}
            </h3>
            <div className="flex gap-2">
              <Button variant="outline" size="sm" onClick={handleSelectAll}>
                {t('list.selectAll')}
              </Button>
              <Button variant="outline" size="sm" onClick={handleSelectNone}>
                {t('list.selectNone')}
              </Button>
            </div>
          </div>

          {totalCount === 0 ? (
            <div className="p-6 text-center text-gray-500 dark:text-gray-400">
              {t('list.empty')}
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="min-w-full divide-y divide-gray-200 dark:divide-gray-700">
                <thead className="bg-gray-50 dark:bg-gray-700/50">
                  <tr>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase w-10">
                      <span className="sr-only">{t('list.colSelect')}</span>
                    </th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">
                      {t('list.colDate')}
                    </th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">
                      {t('list.colPayee')}
                    </th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">
                      {t('list.colCategory')}
                    </th>
                    <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">
                      {t('list.colAmount')}
                    </th>
                    <th className="px-4 py-3 text-center text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">
                      {t('list.colStatus')}
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-200 dark:divide-gray-700">
                  {reconciliationData.transactions.map((transaction) => (
                    <tr
                      key={transaction.id}
                      className={`cursor-pointer transition-colors ${
                        selectedTransactionIds.has(transaction.id)
                          ? 'bg-blue-50 dark:bg-blue-900/20'
                          : 'hover:bg-gray-50 dark:hover:bg-gray-700/30'
                      }`}
                      onClick={() => handleToggleTransaction(transaction.id)}
                    >
                      <td className="px-4 py-3">
                        <input
                          type="checkbox"
                          checked={selectedTransactionIds.has(transaction.id)}
                          onChange={() => handleToggleTransaction(transaction.id)}
                          onClick={(e) => e.stopPropagation()}
                          className="h-4 w-4 text-blue-600 border-gray-300 rounded focus:ring-blue-500 dark:border-gray-600 dark:bg-gray-800"
                        />
                      </td>
                      <td className="px-4 py-3 text-sm text-gray-900 dark:text-gray-100 whitespace-nowrap">
                        {format(new Date(transaction.transactionDate), 'MMM d, yyyy')}
                      </td>
                      <td className="px-4 py-3 text-sm text-gray-900 dark:text-gray-100">
                        {transaction.payee?.name || transaction.payeeName || '-'}
                      </td>
                      <td className="px-4 py-3 text-sm text-gray-500 dark:text-gray-400">
                        {transaction.category?.name || '-'}
                      </td>
                      <td
                        className={`px-4 py-3 text-sm text-right whitespace-nowrap font-medium ${
                          Number(transaction.amount) >= 0
                            ? 'text-green-600 dark:text-green-400'
                            : 'text-red-600 dark:text-red-400'
                        }`}
                      >
                        {formatCurrency(Number(transaction.amount))}
                      </td>
                      <td className="px-4 py-3 text-center">
                        {transaction.status === TransactionStatus.CLEARED ? (
                          <span className="text-blue-600 dark:text-blue-400" title={t('status.cleared')}>C</span>
                        ) : transaction.status === TransactionStatus.UNRECONCILED ? (
                          <span className="text-gray-400" title={t('status.unreconciled')}>-</span>
                        ) : transaction.status === TransactionStatus.VOID ? (
                          <span className="text-gray-400 line-through" title={t('status.void')}>V</span>
                        ) : (
                          <span className="text-green-600 dark:text-green-400" title={t('status.reconciled')}>R</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          <div className="p-4 border-t border-gray-200 dark:border-gray-700 flex justify-between">
            <Button variant="outline" onClick={handleCancel}>
              {tc('cancel')}
            </Button>
            <Button
              onClick={handleFinishReconciliation}
              isLoading={isReconciling}
              disabled={Math.abs(calculatedDifference) > 0.01 || selectedTransactionIds.size === 0}
            >
              {t('list.finish')}
            </Button>
          </div>
        </div>
      </div>
    );
  };

  const renderCompleteStep = () => (
    <div className="max-w-xl mx-auto">
      <div className="bg-white dark:bg-gray-800 rounded-lg shadow p-6 text-center">
        <div className="mx-auto flex items-center justify-center h-12 w-12 rounded-full bg-green-100 dark:bg-green-900 mb-4">
          <svg
            className="h-6 w-6 text-green-600 dark:text-green-400"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M5 13l4 4L19 7"
            />
          </svg>
        </div>
        <h2 className="text-xl font-semibold text-gray-900 dark:text-gray-100 mb-2">
          {t('complete.title')}
        </h2>
        <p className="text-gray-600 dark:text-gray-400 mb-6">
          {t('complete.message', { date: format(new Date(statementDate), 'MMMM d, yyyy') })}
        </p>

        {/* Revolving-credit payment prompt: offer to update or create the
            scheduled bill that pays down this account, using the reconciled
            balance. */}
        {offersPaymentPrompt && (
          <div className="mb-6 rounded-lg border border-blue-200 dark:border-blue-800 bg-blue-50 dark:bg-blue-900/20 p-4 text-left">
            {paymentBill ? (
              <>
                <p className="text-sm text-gray-700 dark:text-gray-300">
                  {t.rich('complete.existingPayment', {
                    name: paymentBill.name,
                    amount: formatCurrency(reconciledPaymentAmount),
                    b: (chunks) => <span className="font-medium">{chunks}</span>,
                  })}
                </p>
                <div className="mt-3 flex justify-center">
                  <Button onClick={handleUpdatePayment}>
                    {t('complete.updatePayment')}
                  </Button>
                </div>
              </>
            ) : (
              <>
                <p className="text-sm text-gray-700 dark:text-gray-300">
                  {t.rich('complete.noPayment', {
                    amount: formatCurrency(reconciledPaymentAmount),
                    b: (chunks) => <span className="font-medium">{chunks}</span>,
                  })}
                </p>
                <div className="mt-3 flex justify-center">
                  <Button onClick={handleCreatePayment}>
                    {t('complete.createPayment')}
                  </Button>
                </div>
              </>
            )}
          </div>
        )}

        <div className="flex justify-center space-x-4">
          <Button variant="outline" onClick={() => router.push('/accounts')}>
            {t('complete.backToAccounts')}
          </Button>
          <Button
            onClick={() => {
              setStep('setup');
              setReconciliationData(null);
              setSelectedTransactionIds(new Set());
              setStatementBalance(undefined);
              setPaymentBill(null);
            }}
          >
            {t('complete.reconcileAnother')}
          </Button>
        </div>
      </div>
    </div>
  );

  return (
    <PageLayout>

      <main className="px-4 sm:px-6 lg:px-12 pt-6 pb-8">
        <PageHeader
          title={t('title')}
          subtitle={selectedAccount
            ? t('subtitleActive', { name: selectedAccount.name })
            : t('subtitle')}
        />
        {step === 'setup' && renderSetupStep()}
        {step === 'reconcile' && renderReconcileStep()}
        {step === 'complete' && renderCompleteStep()}
      </main>
    </PageLayout>
  );
}
