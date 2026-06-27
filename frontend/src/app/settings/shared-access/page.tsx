'use client';

import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { PageLayout } from '@/components/layout/PageLayout';
import { PageHeader } from '@/components/layout/PageHeader';
import { ProtectedRoute } from '@/components/auth/ProtectedRoute';
import { SharedAccessSection } from '@/components/settings/SharedAccessSection';
import { useDemoMode } from '@/hooks/useDemoMode';

export default function SharedAccessPage() {
  return (
    <ProtectedRoute>
      <SharedAccessContent />
    </ProtectedRoute>
  );
}

function SharedAccessContent() {
  const t = useTranslations('settings.sharedAccessPage');
  const isDemoMode = useDemoMode();

  return (
    <PageLayout>
      <main className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-12 pt-6 pb-8">
        <div className="mb-4">
          <Link
            href="/settings"
            className="text-sm text-blue-600 dark:text-blue-400 hover:underline"
          >
            &larr; {t('backLink')}
          </Link>
        </div>

        <PageHeader
          title={t('title')}
          subtitle={t('subtitle')}
        />

        {isDemoMode ? (
          <div className="bg-amber-50 dark:bg-amber-900/30 border border-amber-200 dark:border-amber-800 rounded-lg p-6 mb-6">
            <h2 className="text-lg font-semibold text-amber-800 dark:text-amber-200 mb-2">
              {t('demoRestricted.heading')}
            </h2>
            <p className="text-sm text-amber-700 dark:text-amber-300">
              {t('demoRestricted.body')}
            </p>
          </div>
        ) : (
          <SharedAccessSection />
        )}
      </main>
    </PageLayout>
  );
}
