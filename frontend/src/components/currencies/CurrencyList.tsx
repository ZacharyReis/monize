'use client';

import { useState, useMemo, useCallback, memo } from 'react';
import { useTranslations } from 'next-intl';
import { CurrencyInfo, CurrencyUsage } from '@/lib/exchange-rates';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { exchangeRatesApi } from '@/lib/exchange-rates';
import toast from 'react-hot-toast';
import { createLogger } from '@/lib/logger';
import { getErrorMessage } from '@/lib/errors';

import { DensityLevel, nextDensity } from '@/hooks/useTableDensity';
import { SortIcon } from '@/components/ui/SortIcon';
import { useLongPress, type LongPressRowHandlers } from '@/hooks/useLongPress';
import { RowActions } from '@/components/ui/row-actions/RowActions';
import { RowActionSheet } from '@/components/ui/row-actions/RowActionSheet';
import type { RowAction } from '@/components/ui/row-actions/rowAction';

export type CurrencySortField = 'code' | 'name' | 'symbol' | 'decimals' | 'rate';
export type SortDirection = 'asc' | 'desc';

const logger = createLogger('CurrencyList');

interface CurrencyActionLabels {
  edit: string;
  activate: string;
  deactivate: string;
  delete: string;
}

interface CurrencyActionHandlers {
  onEdit: (currency: CurrencyInfo) => void;
  onToggleActive: (currency: CurrencyInfo) => void;
  onDelete: (currency: CurrencyInfo) => void;
}

/**
 * Builds the standard row actions for a currency. Shared by the desktop
 * `RowActions` cell and the mobile `RowActionSheet`. Delete is desktop-omitted
 * (only the sheet surfaces it) via `includeDelete`.
 */
function buildCurrencyActions(
  currency: CurrencyInfo,
  totalUsage: number,
  isDefault: boolean,
  labels: CurrencyActionLabels,
  handlers: CurrencyActionHandlers,
  opts: { includeDelete: boolean },
): RowAction[] {
  const canToggleOrDelete = !isDefault && totalUsage === 0;
  return [
    {
      key: 'edit',
      label: labels.edit,
      icon: 'edit',
      tone: 'primary',
      onClick: () => handlers.onEdit(currency),
      hidden: currency.isSystem,
    },
    currency.isActive
      ? {
          key: 'toggle',
          label: labels.deactivate,
          icon: 'deactivate',
          tone: 'warning',
          onClick: () => handlers.onToggleActive(currency),
          hidden: !canToggleOrDelete,
        }
      : {
          key: 'toggle',
          label: labels.activate,
          icon: 'activate',
          tone: 'success',
          onClick: () => handlers.onToggleActive(currency),
          hidden: !canToggleOrDelete,
        },
    {
      key: 'delete',
      label: labels.delete,
      icon: 'delete',
      tone: 'delete',
      destructive: true,
      onClick: () => handlers.onDelete(currency),
      hidden: !opts.includeDelete || currency.isSystem || !canToggleOrDelete,
    },
  ];
}

interface CurrencyListProps {
  currencies: CurrencyInfo[];
  usage: CurrencyUsage;
  defaultCurrency: string;
  getRate: (fromCurrency: string, toCurrency?: string) => number | null;
  onEdit: (currency: CurrencyInfo) => void;
  onToggleActive: (currency: CurrencyInfo) => void;
  onRefresh: () => void;
  density?: DensityLevel;
  onDensityChange?: (density: DensityLevel) => void;
  sortField?: CurrencySortField;
  sortDirection?: SortDirection;
  onSort?: (field: CurrencySortField) => void;
}

interface CurrencyRowProps {
  currency: CurrencyInfo;
  usage: { accounts: number; securities: number } | undefined;
  defaultCurrency: string;
  exchangeRate: number | null;
  density: DensityLevel;
  cellPadding: string;
  onEdit: (currency: CurrencyInfo) => void;
  onToggleActive: (currency: CurrencyInfo) => void;
  onDelete: (currency: CurrencyInfo) => void;
  getRowHandlers: (currency: CurrencyInfo) => LongPressRowHandlers;
  index: number;
}

const CurrencyRow = memo(function CurrencyRow({
  currency,
  usage,
  defaultCurrency,
  exchangeRate,
  density,
  cellPadding,
  onEdit,
  onToggleActive,
  onDelete,
  getRowHandlers,
  index,
}: CurrencyRowProps) {
  const t = useTranslations('currencies');
  const tc = useTranslations('common');

  const totalUsage = (usage?.accounts || 0) + (usage?.securities || 0);
  const isDefault = currency.code === defaultCurrency;

  const actions = buildCurrencyActions(
    currency,
    totalUsage,
    isDefault,
    { edit: tc('actions.edit'), activate: t('list.actions.activate'), deactivate: t('list.actions.deactivate'), delete: tc('actions.delete') },
    { onEdit, onToggleActive, onDelete },
    { includeDelete: false },
  );

  return (
    <tr
      className={`hover:bg-gray-100 dark:hover:bg-gray-800 select-none ${density !== 'normal' && index % 2 === 1 ? 'bg-gray-50 dark:bg-table-stripe-dark' : 'bg-white dark:bg-gray-900'}`}
      {...getRowHandlers(currency)}
    >
      {/* Code */}
      <td className={`${cellPadding} whitespace-nowrap`}>
        <span className="text-sm font-mono font-semibold text-gray-900 dark:text-gray-100">
          {currency.code}
        </span>
        {isDefault && (
          <span className="ml-2 inline-flex text-xs leading-5 font-semibold rounded-full px-1.5 py-0.5 bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200">
            {t('list.defaultBadge')}
          </span>
        )}
      </td>
      {/* Name - hidden on mobile */}
      <td className={`${cellPadding} whitespace-nowrap text-sm text-gray-700 dark:text-gray-300 hidden sm:table-cell`}>
        {currency.name}
      </td>
      {/* Symbol */}
      <td className={`${cellPadding} whitespace-nowrap text-sm text-gray-600 dark:text-gray-400 text-center`}>
        {currency.symbol}
      </td>
      {/* Decimals - hidden in compact/dense */}
      {density === 'normal' && (
        <td className={`${cellPadding} whitespace-nowrap text-sm text-gray-500 dark:text-gray-400 text-center hidden lg:table-cell`}>
          {currency.decimalPlaces}
        </td>
      )}
      {/* Usage */}
      <td className={`${cellPadding} whitespace-nowrap text-sm text-gray-600 dark:text-gray-400 hidden sm:table-cell`}>
        {totalUsage > 0 ? (
          <span title={t('list.usageTooltip', { accounts: usage?.accounts || 0, securities: usage?.securities || 0 })}>
            {usage?.accounts ? t('list.usageAccounts', { count: usage.accounts }) : ''}
            {usage?.accounts && usage?.securities ? ', ' : ''}
            {usage?.securities ? t('list.usageSecurities', { count: usage.securities }) : ''}
          </span>
        ) : (
          <span className="text-gray-400 dark:text-gray-500">-</span>
        )}
      </td>
      {/* Exchange Rate */}
      <td className={`${cellPadding} whitespace-nowrap text-sm text-gray-600 dark:text-gray-400 text-right`}>
        {isDefault ? (
          <span className="text-gray-400 dark:text-gray-500">-</span>
        ) : exchangeRate ? (
          <span title={`1 ${currency.code} = ${exchangeRate.toFixed(4)} ${defaultCurrency}`}>
            {exchangeRate.toFixed(4)}
          </span>
        ) : (
          <span className="text-gray-400 dark:text-gray-500">N/A</span>
        )}
      </td>
      {/* Status */}
      <td className={`${cellPadding} whitespace-nowrap hidden sm:table-cell`}>
        <span
          className={`inline-flex text-xs leading-5 font-semibold rounded-full ${
            density === 'dense' ? 'px-1.5 py-0.5' : 'px-2 py-1'
          } ${
            currency.isActive
              ? 'bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200'
              : 'bg-gray-100 text-gray-600 dark:bg-gray-700 dark:text-gray-400'
          }`}
        >
          {density === 'dense'
            ? currency.isActive ? t('list.statusBadge.activeShort') : t('list.statusBadge.inactiveShort')
            : currency.isActive ? t('list.statusBadge.active') : t('list.statusBadge.inactive')}
        </span>
      </td>
      {/* Actions - hidden on mobile */}
      <td className={`${cellPadding} whitespace-nowrap text-right text-sm font-medium hidden sm:table-cell`}>
        <RowActions actions={actions} density={density} />
      </td>
    </tr>
  );
});

export function CurrencyList({
  currencies,
  usage,
  defaultCurrency,
  getRate,
  onEdit,
  onToggleActive,
  onRefresh,
  density: propDensity,
  onDensityChange,
  sortField: propSortField,
  sortDirection: propSortDirection,
  onSort,
}: CurrencyListProps) {
  const t = useTranslations('currencies');
  const [deleteCurrency, setDeleteCurrency] = useState<CurrencyInfo | null>(null);
  const [localDensity, setLocalDensity] = useState<DensityLevel>('normal');
  const [localSortField, setLocalSortField] = useState<CurrencySortField>('code');
  const [localSortDirection, setLocalSortDirection] = useState<SortDirection>('asc');

  // Use prop sort state if provided (controlled), otherwise use local state
  const sortField = propSortField ?? localSortField;
  const sortDirection = propSortDirection ?? localSortDirection;

  const density = propDensity ?? localDensity;

  const handleSort = useCallback((field: CurrencySortField) => {
    if (onSort) {
      onSort(field);
    } else {
      if (localSortField === field) {
        setLocalSortDirection((prev) => (prev === 'asc' ? 'desc' : 'asc'));
      } else {
        setLocalSortField(field);
        setLocalSortDirection('asc');
      }
    }
  }, [onSort, localSortField]);

  // Long-press opens a per-row action sheet on mobile (and via right-click).
  const [contextCurrency, setContextCurrency] = useState<CurrencyInfo | null>(null);

  const { getRowHandlers } = useLongPress<CurrencyInfo>({
    onLongPress: setContextCurrency,
  });

  const cellPadding = useMemo(() => {
    switch (density) {
      case 'dense': return 'px-3 py-1';
      case 'compact': return 'px-4 py-2';
      default: return 'px-6 py-4';
    }
  }, [density]);

  const headerPadding = useMemo(() => {
    switch (density) {
      case 'dense': return 'px-3 py-2';
      case 'compact': return 'px-4 py-2';
      default: return 'px-6 py-3';
    }
  }, [density]);

  const cycleDensity = useCallback(() => {
    const next = nextDensity(density);
    if (onDensityChange) {
      onDensityChange(next);
    } else {
      setLocalDensity(next);
    }
  }, [density, onDensityChange]);

  const handleConfirmDelete = async () => {
    if (!deleteCurrency) return;
    try {
      await exchangeRatesApi.deleteCurrency(deleteCurrency.code);
      toast.success(t('list.toasts.deleted'));
      onRefresh();
    } catch (error) {
      toast.error(getErrorMessage(error, t('list.toasts.deleteFailed')));
      logger.error(error);
    } finally {
      setDeleteCurrency(null);
    }
  };

  if (currencies.length === 0) {
    return (
      <div className="text-center py-12">
        <svg
          className="mx-auto h-12 w-12 text-gray-400 dark:text-gray-500"
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={2}
            d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
          />
        </svg>
        <h3 className="mt-2 text-sm font-medium text-gray-900 dark:text-gray-100">{t('list.empty.title')}</h3>
        <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">{t('list.empty.subtitle')}</p>
      </div>
    );
  }

  return (
    <div>
      {/* Density toggle */}
      <div className="flex justify-end p-2 border-b border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800">
        <button
          onClick={cycleDensity}
          className="inline-flex items-center px-2 py-1 text-xs font-medium text-gray-600 dark:text-gray-300 hover:text-gray-900 dark:hover:text-gray-100 hover:bg-gray-100 dark:hover:bg-gray-700 rounded"
          title={t('list.density.toggle')}
        >
          <svg className="w-4 h-4 mr-1" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
          </svg>
          {density === 'normal' ? t('list.density.normal') : density === 'compact' ? t('list.density.compact') : t('list.density.dense')}
        </button>
      </div>
      <div className="overflow-x-auto">
        <table className="min-w-full divide-y divide-gray-200 dark:divide-gray-700">
          <thead className="bg-gray-50 dark:bg-gray-800">
            <tr>
              <th
                className={`${headerPadding} text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider cursor-pointer hover:text-gray-700 dark:hover:text-gray-200`}
                onClick={() => handleSort('code')}
              >
                {t('list.columns.code')}<SortIcon field="code" sortField={sortField} sortDirection={sortDirection} />
              </th>
              <th
                className={`${headerPadding} text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider cursor-pointer hover:text-gray-700 dark:hover:text-gray-200 hidden sm:table-cell`}
                onClick={() => handleSort('name')}
              >
                {t('list.columns.name')}<SortIcon field="name" sortField={sortField} sortDirection={sortDirection} />
              </th>
              <th
                className={`${headerPadding} text-center text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider cursor-pointer hover:text-gray-700 dark:hover:text-gray-200`}
                onClick={() => handleSort('symbol')}
              >
                {t('list.columns.symbol')}<SortIcon field="symbol" sortField={sortField} sortDirection={sortDirection} />
              </th>
              {density === 'normal' && (
                <th
                  className={`${headerPadding} text-center text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider cursor-pointer hover:text-gray-700 dark:hover:text-gray-200 hidden lg:table-cell`}
                  onClick={() => handleSort('decimals')}
                >
                  {t('list.columns.decimals')}<SortIcon field="decimals" sortField={sortField} sortDirection={sortDirection} />
                </th>
              )}
              <th className={`${headerPadding} text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider hidden sm:table-cell`}>
                {t('list.columns.usage')}
              </th>
              <th
                className={`${headerPadding} text-right text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider cursor-pointer hover:text-gray-700 dark:hover:text-gray-200`}
                onClick={() => handleSort('rate')}
              >
                {t('list.columns.rate', { currency: defaultCurrency })}<SortIcon field="rate" sortField={sortField} sortDirection={sortDirection} />
              </th>
              <th className={`${headerPadding} text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider hidden sm:table-cell`}>
                {t('list.columns.status')}
              </th>
              <th className={`${headerPadding} text-right text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider hidden sm:table-cell`}>
                {t('list.columns.actions')}
              </th>
            </tr>
          </thead>
          <tbody className="bg-white dark:bg-gray-900 divide-y divide-gray-200 dark:divide-gray-700">
            {currencies.map((currency, index) => (
              <CurrencyRow
                key={currency.code}
                currency={currency}
                usage={usage[currency.code]}
                defaultCurrency={defaultCurrency}
                exchangeRate={getRate(currency.code)}
                density={density}
                cellPadding={cellPadding}
                onEdit={onEdit}
                onToggleActive={onToggleActive}
                onDelete={setDeleteCurrency}
                getRowHandlers={getRowHandlers}
                index={index}
              />
            ))}
          </tbody>
        </table>
      </div>

      {/* Long-press Context Menu */}
      <RowActionSheet
        isOpen={!!contextCurrency}
        title={contextCurrency?.code ?? ''}
        subtitle={contextCurrency?.name}
        actions={contextCurrency
          ? buildCurrencyActions(
              contextCurrency,
              (usage[contextCurrency.code]?.accounts || 0) + (usage[contextCurrency.code]?.securities || 0),
              contextCurrency.code === defaultCurrency,
              { edit: t('list.contextMenu.editCurrency'), activate: t('list.contextMenu.activate'), deactivate: t('list.contextMenu.deactivate'), delete: t('list.contextMenu.deleteCurrency') },
              { onEdit, onToggleActive, onDelete: setDeleteCurrency },
              { includeDelete: true },
            )
          : []}
        onClose={() => setContextCurrency(null)}
      />

      <ConfirmDialog
        isOpen={deleteCurrency !== null}
        title={t('list.deleteConfirm.title', { code: deleteCurrency?.code ?? '' })}
        message={t('list.deleteConfirm.message')}
        confirmLabel={t('list.deleteConfirm.confirmLabel')}
        cancelLabel={t('list.deleteConfirm.cancelLabel')}
        variant="danger"
        onConfirm={handleConfirmDelete}
        onCancel={() => setDeleteCurrency(null)}
      />
    </div>
  );
}
