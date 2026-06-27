'use client';

import { useTranslations } from 'next-intl';
import { Button } from '@/components/ui/Button';
import { usePriceRefresh } from '@/hooks/usePriceRefresh';

interface RefreshPricesButtonProps {
  /**
   * Called after a successful refresh so the host report can reload its data
   * (prices are written to the DB, so the report must re-fetch to reflect them).
   */
  onRefreshComplete?: (lastUpdated?: string) => void | Promise<void>;
  className?: string;
}

export function RefreshPricesButton({
  onRefreshComplete,
  className,
}: RefreshPricesButtonProps) {
  const t = useTranslations('reports');
  const { isRefreshing, triggerManualRefresh } = usePriceRefresh({
    onRefreshComplete,
  });

  return (
    <Button
      variant="outline"
      size="sm"
      onClick={() => triggerManualRefresh()}
      disabled={isRefreshing}
      className={className}
      title={t('refreshPricesButton.titleRefresh')}
    >
      {isRefreshing ? (
        <>
          <svg
            className="animate-spin -ml-0.5 mr-1.5 h-4 w-4"
            xmlns="http://www.w3.org/2000/svg"
            fill="none"
            viewBox="0 0 24 24"
            aria-hidden="true"
          >
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
          </svg>
          {t('refreshPricesButton.updating')}
        </>
      ) : (
        <>
          <svg
            className="-ml-0.5 mr-1.5 h-4 w-4"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
            aria-hidden="true"
          >
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
          </svg>
          {t('refreshPricesButton.refresh')}
        </>
      )}
    </Button>
  );
}
