'use client';

import { useState, useEffect, useCallback } from 'react';
import { useTranslations } from 'next-intl';
import toast from 'react-hot-toast';
import { Button } from '@/components/ui/Button';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { LoadingSpinner } from '@/components/ui/LoadingSpinner';
import { Security, SecurityPrice, CreateSecurityPriceData } from '@/types/investment';
import { investmentsApi } from '@/lib/investments';
import { useDateFormat } from '@/hooks/useDateFormat';
import { getErrorMessage } from '@/lib/errors';
import { SecurityPriceForm } from './SecurityPriceForm';

interface SecurityPriceHistoryProps {
  security: Security;
  onClose: () => void;
}

function getSourceLabel(source: string | null): string {
  if (!source) return 'Unknown';
  switch (source) {
    case 'yahoo_finance': return 'Yahoo';
    case 'msn_finance': return 'MSN';
    case 'manual': return 'Manual';
    case 'buy': return 'Buy';
    case 'sell': return 'Sell';
    case 'reinvest': return 'Reinvest';
    case 'transfer_in': return 'Transfer In';
    case 'transfer_out': return 'Transfer Out';
    default: return source;
  }
}

function getSourceColor(source: string | null): string {
  if (!source) return 'bg-gray-100 text-gray-600 dark:bg-gray-700 dark:text-gray-300';
  switch (source) {
    case 'yahoo_finance':
      return 'bg-blue-100 text-blue-700 dark:bg-blue-900 dark:text-blue-300';
    case 'msn_finance':
      return 'bg-purple-100 text-purple-700 dark:bg-purple-900 dark:text-purple-300';
    case 'manual':
      return 'bg-green-100 text-green-700 dark:bg-green-900 dark:text-green-300';
    default:
      return 'bg-gray-100 text-gray-600 dark:bg-gray-700 dark:text-gray-300';
  }
}

function formatPrice(value: number | null): string {
  if (value === null || value === undefined) return '-';
  return Number(value).toLocaleString(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 6,
  });
}

export function SecurityPriceHistory({ security, onClose }: SecurityPriceHistoryProps) {
  const t = useTranslations('securities');
  const { formatDate } = useDateFormat();
  const [prices, setPrices] = useState<SecurityPrice[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [showAddForm, setShowAddForm] = useState(false);
  const [editingPrice, setEditingPrice] = useState<SecurityPrice | undefined>();
  const [deletingPrice, setDeletingPrice] = useState<SecurityPrice | undefined>();
  const [isUpdating, setIsUpdating] = useState(false);

  const loadPrices = useCallback(async () => {
    setIsLoading(true);
    try {
      const data = await investmentsApi.getSecurityPrices(security.id, 9999);
      setPrices(data);
    } catch (error) {
      toast.error(getErrorMessage(error, t('priceHistory.toasts.loadFailed')));
    } finally {
      setIsLoading(false);
    }
  }, [security.id, t]);

  useEffect(() => {
    loadPrices();
  }, [loadPrices]);

  const handleAdd = useCallback(async (data: CreateSecurityPriceData) => {
    try {
      await investmentsApi.createSecurityPrice(security.id, data);
      toast.success(t('priceHistory.toasts.added'));
      setShowAddForm(false);
      loadPrices();
    } catch (error) {
      toast.error(getErrorMessage(error, t('priceHistory.toasts.addFailed')));
      throw error;
    }
  }, [security.id, loadPrices, t]);

  const handleEdit = useCallback(async (data: CreateSecurityPriceData) => {
    if (!editingPrice) return;
    try {
      await investmentsApi.updateSecurityPrice(security.id, editingPrice.id, data);
      toast.success(t('priceHistory.toasts.updated'));
      setEditingPrice(undefined);
      loadPrices();
    } catch (error) {
      toast.error(getErrorMessage(error, t('priceHistory.toasts.updateFailed')));
      throw error;
    }
  }, [security.id, editingPrice, loadPrices, t]);

  const handleDelete = useCallback(async () => {
    if (!deletingPrice) return;
    try {
      await investmentsApi.deleteSecurityPrice(security.id, deletingPrice.id);
      toast.success(t('priceHistory.toasts.deleted'));
      setDeletingPrice(undefined);
      loadPrices();
    } catch (error) {
      toast.error(getErrorMessage(error, t('priceHistory.toasts.deleteFailed')));
    }
  }, [security.id, deletingPrice, loadPrices, t]);

  const handleForceUpdate = useCallback(async () => {
    setIsUpdating(true);
    try {
      const result = await investmentsApi.backfillSecurityPrices(security.id);
      if (result.success) {
        toast.success(
          result.pricesLoaded
            ? t('priceHistory.toasts.updatedCount', { count: result.pricesLoaded, symbol: result.symbol })
            : t('priceHistory.toasts.noPricesFound', { symbol: result.symbol }),
        );
        await loadPrices();
      } else {
        toast.error(result.error || t('priceHistory.toasts.updatePricesFailed', { symbol: result.symbol }));
      }
    } catch (error) {
      toast.error(getErrorMessage(error, t('priceHistory.toasts.updateFetchFailed')));
    } finally {
      setIsUpdating(false);
    }
  }, [security.id, loadPrices, t]);

  const isFormOpen = showAddForm || !!editingPrice;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-xl font-bold text-gray-900 dark:text-gray-100">
          {t('priceHistory.title', { symbol: security.symbol })}
        </h2>
        <div className="flex gap-2">
          {!isFormOpen && (
            <>
              <Button
                variant="outline"
                onClick={handleForceUpdate}
                size="sm"
                isLoading={isUpdating}
                title={t('priceHistory.forceUpdateTitle')}
              >
                {t('priceHistory.forceUpdateButton')}
              </Button>
              <Button onClick={() => setShowAddForm(true)} size="sm" disabled={isUpdating}>
                {t('priceHistory.addPriceButton')}
              </Button>
            </>
          )}
          <Button variant="outline" onClick={onClose} size="sm">
{t('priceHistory.closeButton')}
          </Button>
        </div>
      </div>

      {/* Add/Edit Form */}
      {showAddForm && (
        <div className="border border-gray-200 dark:border-gray-700 rounded-lg p-4">
          <h3 className="text-lg font-semibold text-gray-900 dark:text-gray-100 mb-3">{t('priceHistory.addPriceSection')}</h3>
          <SecurityPriceForm
            onSubmit={handleAdd}
            onCancel={() => setShowAddForm(false)}
          />
        </div>
      )}

      {editingPrice && (
        <div className="border border-gray-200 dark:border-gray-700 rounded-lg p-4">
          <h3 className="text-lg font-semibold text-gray-900 dark:text-gray-100 mb-3">{t('priceHistory.editPriceSection')}</h3>
          <SecurityPriceForm
            price={editingPrice}
            onSubmit={handleEdit}
            onCancel={() => setEditingPrice(undefined)}
          />
        </div>
      )}

      {/* Price Table */}
      {isLoading ? (
        <LoadingSpinner text={t('priceHistory.loading')} />
      ) : prices.length === 0 ? (
        <p className="text-gray-500 dark:text-gray-400 text-center py-8">
          {t('priceHistory.empty')}
        </p>
      ) : (
        <div className="overflow-x-auto max-h-[60vh] overflow-y-auto">
          <table className="min-w-full divide-y divide-gray-200 dark:divide-gray-700">
            <thead className="bg-gray-50 dark:bg-gray-900 sticky top-0">
              <tr>
                <th className="px-3 py-2 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">{t('priceHistory.columns.date')}</th>
                <th className="px-3 py-2 text-right text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">{t('priceHistory.columns.close')}</th>
                <th className="px-3 py-2 text-right text-xs font-medium text-gray-500 dark:text-gray-400 uppercase hidden sm:table-cell">{t('priceHistory.columns.open')}</th>
                <th className="px-3 py-2 text-right text-xs font-medium text-gray-500 dark:text-gray-400 uppercase hidden sm:table-cell">{t('priceHistory.columns.high')}</th>
                <th className="px-3 py-2 text-right text-xs font-medium text-gray-500 dark:text-gray-400 uppercase hidden sm:table-cell">{t('priceHistory.columns.low')}</th>
                <th className="px-3 py-2 text-right text-xs font-medium text-gray-500 dark:text-gray-400 uppercase hidden md:table-cell">{t('priceHistory.columns.volume')}</th>
                <th className="px-3 py-2 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">{t('priceHistory.columns.source')}</th>
                <th className="px-3 py-2 text-right text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">{t('priceHistory.columns.actions')}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-200 dark:divide-gray-700">
              {prices.map((price) => (
                <tr key={price.id} className="hover:bg-gray-50 dark:hover:bg-gray-700">
                  <td className="px-3 py-2 text-sm text-gray-900 dark:text-gray-100 whitespace-nowrap">
                    {formatDate(price.priceDate)}
                  </td>
                  <td className="px-3 py-2 text-sm text-gray-900 dark:text-gray-100 text-right">
                    {formatPrice(price.closePrice)}
                  </td>
                  <td className="px-3 py-2 text-sm text-gray-500 dark:text-gray-400 text-right hidden sm:table-cell">
                    {formatPrice(price.openPrice)}
                  </td>
                  <td className="px-3 py-2 text-sm text-gray-500 dark:text-gray-400 text-right hidden sm:table-cell">
                    {formatPrice(price.highPrice)}
                  </td>
                  <td className="px-3 py-2 text-sm text-gray-500 dark:text-gray-400 text-right hidden sm:table-cell">
                    {formatPrice(price.lowPrice)}
                  </td>
                  <td className="px-3 py-2 text-sm text-gray-500 dark:text-gray-400 text-right hidden md:table-cell">
                    {price.volume !== null ? Number(price.volume).toLocaleString() : '-'}
                  </td>
                  <td className="px-3 py-2 whitespace-nowrap">
                    <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${getSourceColor(price.source)}`}>
                      {getSourceLabel(price.source)}
                    </span>
                  </td>
                  <td className="px-3 py-2 text-right whitespace-nowrap">
                    <div className="flex gap-2 justify-end">
                      <button
                        onClick={() => { setShowAddForm(false); setEditingPrice(price); }}
                        className="text-blue-600 hover:text-blue-800 dark:text-blue-400 dark:hover:text-blue-300 text-xs"
                      >
                        {t('list.actions.edit')}
                      </button>
                      <button
                        onClick={() => setDeletingPrice(price)}
                        className="text-red-600 hover:text-red-800 dark:text-red-400 dark:hover:text-red-300 text-xs"
                      >
                        {t('list.actions.delete')}
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <ConfirmDialog
        isOpen={!!deletingPrice}
        title={t('priceHistory.deleteConfirm.title')}
        message={`Delete price entry for ${deletingPrice ? formatDate(deletingPrice.priceDate) : ''}?`}
        confirmLabel={t('priceHistory.deleteConfirm.confirmLabel')}
        onConfirm={handleDelete}
        onCancel={() => setDeletingPrice(undefined)}
      />
    </div>
  );
}
