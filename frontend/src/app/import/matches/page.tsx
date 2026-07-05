'use client';

import { useCallback, useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { ProtectedRoute } from '@/components/auth/ProtectedRoute';
import { PageLayout } from '@/components/layout/PageLayout';
import { PageHeader } from '@/components/layout/PageHeader';
import { MatchReviewList } from '@/components/import/MatchReviewList';
import { importMatchesApi } from '@/lib/import-matches';
import { usePendingReviewsStore } from '@/store/pendingReviewsStore';
import { PendingMatch } from '@/types/import';

export default function PendingReviewsPage() {
  return (
    <ProtectedRoute>
      <PendingReviewsContent />
    </ProtectedRoute>
  );
}

function PendingReviewsContent() {
  const t = useTranslations('navigation');
  const [matches, setMatches] = useState<PendingMatch[]>([]);

  // Re-fetches server truth for the list and refreshes the nav badge count.
  // Used both on mount and after a card resolves, so a conflict (e.g. another
  // session already resolved it) or a stale count is corrected from the
  // server rather than relying solely on MatchReviewList's local optimistic
  // removal.
  const reloadListAndStore = useCallback(() => {
    importMatchesApi.list().then(setMatches);
    usePendingReviewsStore.getState().refresh();
  }, []);

  useEffect(() => {
    reloadListAndStore();
  }, [reloadListAndStore]);

  return (
    <PageLayout>
      <main className="px-4 sm:px-6 lg:px-12 pt-6 pb-8">
        <PageHeader title={t('pendingReviews')} />
        <MatchReviewList matches={matches} showAccount onResolved={reloadListAndStore} />
      </main>
    </PageLayout>
  );
}
