'use client';

import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { useTranslations } from 'next-intl';
import toast from 'react-hot-toast';
import { Button } from '@/components/ui/Button';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { LoadingSpinner } from '@/components/ui/LoadingSpinner';
import {
  Security,
  SecurityPrice,
  CreateSecurityPriceData,
  SecurityHistoryTransaction,
} from '@/types/investment';
import { investmentsApi } from '@/lib/investments';
import { useDateFormat } from '@/hooks/useDateFormat';
import { useLongPress } from '@/hooks/useLongPress';
import { RowActionSheet, type RowAction } from '@/components/ui/row-actions';
import { getErrorMessage } from '@/lib/errors';
import { SecurityPriceForm } from './SecurityPriceForm';
import {
  BalanceHistoryChart,
  type ChartMarker,
} from '@/components/transactions/BalanceHistoryChart';
import { useNumberFormat } from '@/hooks/useNumberFormat';

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

/** Rows rendered before the user scrolls. */
const INITIAL_PAGE_SIZE = 10;
/** Rows appended each time the end of the list scrolls into view. */
const SCROLL_PAGE_SIZE = 50;
/** Start fetching the next batch this far before the list actually ends. */
const PREFETCH_MARGIN = '200px';

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
  // Trades, only for the chart's markers. A failed lookup costs the markers,
  // never the price list the modal is actually for.
  const [trades, setTrades] = useState<SecurityHistoryTransaction[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [showAddForm, setShowAddForm] = useState(false);
  const [editingPrice, setEditingPrice] = useState<SecurityPrice | undefined>();
  const [deletingPrice, setDeletingPrice] = useState<SecurityPrice | undefined>();
  const [isUpdating, setIsUpdating] = useState(false);
  // Mobile has no per-row action buttons -- a long-press (or right-click on a
  // desktop pointer) opens the shared action sheet instead.
  const [contextPrice, setContextPrice] = useState<SecurityPrice | undefined>();

  const { formatQuantity } = useNumberFormat();

  // The full series is still fetched -- the chart plots every point -- but the
  // table renders a page at a time so a security with years of history does not
  // mount thousands of rows.
  const [visibleCount, setVisibleCount] = useState(INITIAL_PAGE_SIZE);
  const sentinelRef = useRef<HTMLDivElement | null>(null);

  const loadPrices = useCallback(async () => {
    setIsLoading(true);
    try {
      const data = await investmentsApi.getSecurityPrices(security.id, 9999);
      setPrices(data);
      setVisibleCount(INITIAL_PAGE_SIZE);
    } catch (error) {
      toast.error(getErrorMessage(error, t('priceHistory.toasts.loadFailed')));
    } finally {
      setIsLoading(false);
    }
  }, [security.id, t]);

  useEffect(() => {
    loadPrices();
  }, [loadPrices]);

  useEffect(() => {
    let cancelled = false;
    investmentsApi
      .getSecurityTransactionHistory(security.id)
      .then((history) => {
        if (!cancelled) setTrades(history.transactions);
      })
      // Markers are a nicety: without them the chart still reads, so a failed
      // lookup stays silent rather than raising a toast over the price list.
      .catch(() => {
        if (!cancelled) setTrades([]);
      });
    return () => {
      cancelled = true;
    };
  }, [security.id]);

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

  const startEdit = useCallback((price: SecurityPrice) => {
    setShowAddForm(false);
    setEditingPrice(price);
  }, []);

  const { getRowHandlers } = useLongPress<SecurityPrice>({
    onLongPress: setContextPrice,
  });

  const contextActions = useMemo<RowAction[]>(() => {
    if (!contextPrice) return [];
    return [
      {
        key: 'edit',
        label: t('list.actions.edit'),
        icon: 'edit',
        tone: 'primary',
        onClick: () => startEdit(contextPrice),
      },
      {
        key: 'delete',
        label: t('list.actions.delete'),
        icon: 'delete',
        tone: 'delete',
        destructive: true,
        onClick: () => setDeletingPrice(contextPrice),
      },
    ];
  }, [contextPrice, startEdit, t]);

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

  // The same shape the account balance chart takes, so the price history can
  // reuse it: oldest first (the API returns newest first) and the close price as
  // the series value.
  const chartData = useMemo(
    () =>
      prices
        .map((price) => ({
          date: price.priceDate.slice(0, 10),
          balance: Number(price.closePrice),
        }))
        .sort((a, b) => a.date.localeCompare(b.date)),
    [prices],
  );

  // Which way each action moved the position. Actions with no share movement
  // (dividends, interest, capital gains) carry no quantity and are left off the
  // chart -- a dot with nothing to say is noise.
  const chartMarkers = useMemo<ChartMarker[]>(() => {
    const direction: Partial<Record<SecurityHistoryTransaction['action'], 'in' | 'out'>> = {
      BUY: 'in',
      REINVEST: 'in',
      TRANSFER_IN: 'in',
      ADD_SHARES: 'in',
      SELL: 'out',
      TRANSFER_OUT: 'out',
      REMOVE_SHARES: 'out',
    };
    return trades.flatMap((trade) => {
      const way = direction[trade.action];
      if (!way || trade.quantity === null) return [];
      const quantity = formatQuantity(Math.abs(Number(trade.quantity)));
      return [
        {
          date: trade.transactionDate.slice(0, 10),
          direction: way,
          label: t(
            way === 'in'
              ? 'priceHistory.markers.bought'
              : 'priceHistory.markers.sold',
            { quantity, account: trade.accountName },
          ),
        },
      ];
    });
  }, [trades, formatQuantity, t]);

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
  const visiblePrices = prices.slice(0, visibleCount);
  const remainingCount = prices.length - visiblePrices.length;

  // Reveal the next batch as the end of the list comes into view. Re-observed
  // on every visibleCount change: a batch that still does not reach past the
  // sentinel leaves it intersecting, and an observer already reporting
  // "intersecting" will not fire again on its own.
  useEffect(() => {
    const sentinel = sentinelRef.current;
    if (!sentinel || typeof IntersectionObserver === 'undefined') return;

    const observer = new IntersectionObserver(
      (entries) => {
        if (!entries.some((entry) => entry.isIntersecting)) return;
        setVisibleCount((count) =>
          Math.min(count + SCROLL_PAGE_SIZE, prices.length),
        );
      },
      { rootMargin: PREFETCH_MARGIN },
    );
    observer.observe(sentinel);
    return () => observer.disconnect();
  }, [prices.length, visibleCount]);

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

      {/* Price chart. Deliberately the account balance-history chart: same
          shape of data, so the two screens read the same way -- title and
          neutral colouring are the only differences (a price has no good or
          bad sign). */}
      {!isLoading && chartData.length > 1 && (
        <BalanceHistoryChart
          data={chartData}
          isLoading={false}
          currencyCode={security.currencyCode}
          accountName={security.symbol}
          title={t('priceHistory.chartTitle')}
          neutralValues
          precise
          markers={chartMarkers}
        />
      )}

      {/* Price Table */}
      {isLoading ? (
        <LoadingSpinner text={t('priceHistory.loading')} />
      ) : prices.length === 0 ? (
        <p className="text-gray-500 dark:text-gray-400 text-center py-8">
          {t('priceHistory.empty')}
        </p>
      ) : (
        // Only the modal panel scrolls vertically. A capped inner scroller here
        // put a second scrollbar inside the first, whose track ran past the
        // panel's edge; paging the rows keeps this block short enough not to
        // need one.
        <div className="overflow-x-auto">
          <table className="min-w-full divide-y divide-gray-200 dark:divide-gray-700">
            <thead className="bg-gray-50 dark:bg-gray-900">
              <tr>
                <th className="px-3 py-2 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">{t('priceHistory.columns.date')}</th>
                <th className="px-3 py-2 text-right text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">{t('priceHistory.columns.close')}</th>
                <th className="px-3 py-2 text-right text-xs font-medium text-gray-500 dark:text-gray-400 uppercase hidden sm:table-cell">{t('priceHistory.columns.open')}</th>
                <th className="px-3 py-2 text-right text-xs font-medium text-gray-500 dark:text-gray-400 uppercase hidden sm:table-cell">{t('priceHistory.columns.high')}</th>
                <th className="px-3 py-2 text-right text-xs font-medium text-gray-500 dark:text-gray-400 uppercase hidden sm:table-cell">{t('priceHistory.columns.low')}</th>
                <th className="px-3 py-2 text-right text-xs font-medium text-gray-500 dark:text-gray-400 uppercase hidden md:table-cell">{t('priceHistory.columns.volume')}</th>
                <th className="px-3 py-2 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">{t('priceHistory.columns.source')}</th>
                {/* Actions - hidden on mobile, where long-press opens the sheet */}
                <th className="px-3 py-2 text-right text-xs font-medium text-gray-500 dark:text-gray-400 uppercase hidden sm:table-cell">{t('priceHistory.columns.actions')}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-200 dark:divide-gray-700">
              {visiblePrices.map((price) => (
                <tr
                  key={price.id}
                  className="hover:bg-gray-50 dark:hover:bg-gray-700 select-none"
                  {...getRowHandlers(price)}
                >
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
                  <td className="px-3 py-2 text-right whitespace-nowrap hidden sm:table-cell">
                    <div className="flex gap-2 justify-end">
                      <button
                        onClick={() => startEdit(price)}
                        onMouseDown={(e) => e.stopPropagation()}
                        className="text-blue-600 hover:text-blue-800 dark:text-blue-400 dark:hover:text-blue-300 text-xs"
                      >
                        {t('list.actions.edit')}
                      </button>
                      <button
                        onClick={() => setDeletingPrice(price)}
                        onMouseDown={(e) => e.stopPropagation()}
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
          {/* Both the "more is coming" caption and the trigger that fetches it:
              scrolling this into view reveals the next batch. */}
          {remainingCount > 0 && (
            <div
              ref={sentinelRef}
              data-testid="price-history-sentinel"
              className="flex items-center justify-center pt-3 text-xs text-gray-500 dark:text-gray-400"
            >
              {t('priceHistory.showingCount', {
                shown: visiblePrices.length,
                total: prices.length,
              })}
            </div>
          )}
        </div>
      )}

      {/* Long-press action sheet -- the mobile stand-in for the actions column */}
      <RowActionSheet
        isOpen={!!contextPrice}
        title={contextPrice ? formatDate(contextPrice.priceDate) : ''}
        subtitle={contextPrice ? formatPrice(contextPrice.closePrice) : undefined}
        actions={contextActions}
        onClose={() => setContextPrice(undefined)}
      />

      <ConfirmDialog
        isOpen={!!deletingPrice}
        title={t('priceHistory.deleteConfirm.title')}
        message={t('priceHistory.deleteConfirm.message', {
          date: deletingPrice ? formatDate(deletingPrice.priceDate) : '',
        })}
        confirmLabel={t('priceHistory.deleteConfirm.confirmLabel')}
        onConfirm={handleDelete}
        onCancel={() => setDeletingPrice(undefined)}
      />
    </div>
  );
}
