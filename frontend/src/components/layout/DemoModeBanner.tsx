'use client';

import { useTranslations } from 'next-intl';
import { useDemoMode } from '@/hooks/useDemoMode';

export function DemoModeBanner() {
  const t = useTranslations('layout');
  const isDemoMode = useDemoMode();

  if (!isDemoMode) return null;

  return (
    <div className="bg-amber-50 dark:bg-amber-900/30 border-b border-amber-200 dark:border-amber-800 px-4 py-2 text-center text-sm text-amber-800 dark:text-amber-200">
      <span className="font-semibold">{t('demoBanner.label')}</span>
      {' \u2014 '}
      {t('demoBanner.message')}
    </div>
  );
}
