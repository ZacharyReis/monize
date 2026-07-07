'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { transactionsApi } from '@/lib/transactions';
import type { SpendingTrendOutlier } from '@/types/built-in-reports';
import { formatCurrency } from '@/lib/format';

interface OneTimeExclusionsListProps {
  outliers: SpendingTrendOutlier[];
  currencyCode: string;
  onChanged: () => void;
}

export function OneTimeExclusionsList({
  outliers,
  currencyCode,
  onChanged,
}: OneTimeExclusionsListProps) {
  const t = useTranslations('bills');
  const [pendingId, setPendingId] = useState<string | null>(null);

  if (outliers.length === 0) return null;

  // Flagging is parent-level; collapse split rows that share a parent id so
  // React keys and test ids stay unique (Wren #8).
  const rows = Array.from(
    new Map(outliers.map((o) => [o.transactionId, o])).values(),
  );

  const apply = async (transactionId: string, value: boolean) => {
    setPendingId(transactionId);
    try {
      await transactionsApi.update(transactionId, {
        excludeFromProjection: value,
      });
      onChanged();
    } finally {
      setPendingId(null);
    }
  };

  return (
    <div className="mt-4 rounded-lg border border-gray-200 dark:border-gray-700 p-4">
      <h3 className="text-sm font-semibold text-gray-900 dark:text-gray-100">
        {t('forecast.exclusions.title')}
      </h3>
      <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
        {t('forecast.exclusions.subtitle')}
      </p>
      <ul className="mt-3 divide-y divide-gray-100 dark:divide-gray-800">
        {rows.map((o) => (
          <li
            key={o.transactionId}
            className="flex items-center justify-between py-2 text-sm"
          >
            <span className="text-gray-800 dark:text-gray-200">
              <span>{o.payeeName || o.categoryName}</span>
              <span className="mx-1 text-gray-400 dark:text-gray-500">·</span>
              <span>{formatCurrency(o.amount, currencyCode)}</span>
            </span>
            <span className="flex gap-2">
              <button
                type="button"
                data-testid={`confirm-${o.transactionId}`}
                disabled={pendingId === o.transactionId}
                onClick={() => apply(o.transactionId, true)}
                className="rounded border border-gray-300 dark:border-gray-600 px-2 py-1 text-xs"
              >
                {t('forecast.exclusions.confirm')}
              </button>
              <button
                type="button"
                data-testid={`rescue-${o.transactionId}`}
                disabled={pendingId === o.transactionId}
                onClick={() => apply(o.transactionId, false)}
                className="rounded border border-blue-500 px-2 py-1 text-xs text-blue-600 dark:text-blue-400"
              >
                {t('forecast.exclusions.rescue')}
              </button>
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}
