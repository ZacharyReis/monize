'use client';

import { useTranslations } from 'next-intl';

interface ReportErrorProps {
  /** Optional override message; defaults to a generic load-failure note. */
  message?: string;
  /** When provided, renders a "Try again" button that re-runs the fetch. */
  onRetry?: () => void;
}

/**
 * Shared error panel for report components. Reports previously swallowed fetch
 * errors and rendered an empty state, leaving the user unsure whether there was
 * genuinely no data or the request had failed. Paired with `useReportData`, this
 * gives every adopting report a visible, retryable error state.
 */
export function ReportError({ message, onRetry }: ReportErrorProps) {
  const t = useTranslations('reports');
  return (
    <div className="bg-white dark:bg-gray-800 rounded-lg shadow dark:shadow-gray-700/50 p-6 text-center">
      <p className="text-sm text-red-600 dark:text-red-400">
        {message || t('error.defaultMessage')}
      </p>
      {onRetry && (
        <button
          type="button"
          onClick={onRetry}
          className="mt-3 inline-flex items-center rounded-md bg-blue-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500"
        >
          {t('error.retry')}
        </button>
      )}
    </div>
  );
}
