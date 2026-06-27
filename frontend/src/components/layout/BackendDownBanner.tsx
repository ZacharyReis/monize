'use client';

import { useEffect, useRef, useSyncExternalStore } from 'react';
import { useTranslations } from 'next-intl';
import { useConnectionStore } from '@/store/connectionStore';

const POLL_INTERVAL_MS = 5000;
const subscribe = () => () => {};
const getIsHttp = () => window.location.protocol === 'http:';
const getServerSnapshot = () => false;

interface BackendDownBannerProps {
  httpsHeadersActive?: boolean;
}

export function BackendDownBanner({ httpsHeadersActive = false }: BackendDownBannerProps) {
  const t = useTranslations('layout');
  const isBackendDown = useConnectionStore((s) => s.isBackendDown);
  const isHttp = useSyncExternalStore(subscribe, getIsHttp, getServerSnapshot);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    if (!isBackendDown) {
      return;
    }

    async function pollHealth() {
      try {
        const res = await fetch('/api/v1/health/live', { cache: 'no-store' });
        if (res.ok) {
          // Backend is back -- full reload to refetch all data and auth state
          window.location.reload();
        }
      } catch {
        // Still unreachable
      }
    }

    timerRef.current = setInterval(pollHealth, POLL_INTERVAL_MS);

    return () => {
      if (timerRef.current) {
        clearInterval(timerRef.current);
        timerRef.current = null;
      }
    };
  }, [isBackendDown]);

  if (!isBackendDown) return null;

  const isHttpsMismatch = httpsHeadersActive && isHttp;

  return (
    <div className="bg-red-50 dark:bg-red-900/30 border-b border-red-200 dark:border-red-800 px-4 py-2 text-center text-sm text-red-800 dark:text-red-200">
      {isHttpsMismatch ? (
        <>
          <span className="font-semibold">{t('backendDownBanner.connectionBlockedLabel')}</span>
          {' \u2014 '}
          {t('backendDownBanner.connectionBlockedDetail')}
          {' '}
          {t.rich('backendDownBanner.httpsHint', {
            code: (chunks) => (
              <code className="bg-red-100 dark:bg-red-800/50 px-1 rounded text-xs">{chunks}</code>
            ),
          })}
        </>
      ) : (
        <>
          <span className="font-semibold">{t('backendDownBanner.connectionLostLabel')}</span>
          {' \u2014 '}
          {t('backendDownBanner.connectionLostDetail')}
        </>
      )}
    </div>
  );
}
