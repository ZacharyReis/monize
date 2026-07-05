'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { MatchReviewList } from './MatchReviewList';
import { usePendingReviewsStore } from '@/store/pendingReviewsStore';
import { Button } from '@/components/ui/Button';
import { ProposedMatch, PendingMatch } from '@/types/import';

interface MatchReviewStepProps {
  matches: ProposedMatch[];
  onDone: () => void;
}

/**
 * Post-import review screen for a single-file import that produced possible
 * duplicate matches. Reuses `MatchReviewList` (account-agnostic, since a
 * single-file import already targets one known account) and tracks how many
 * of the proposed matches have been resolved locally so the footer can flip
 * from "Skip remaining" to "Done" once the queue is clear.
 */
export function MatchReviewStep({ matches, onDone }: MatchReviewStepProps) {
  const t = useTranslations('import');
  const [resolvedCount, setResolvedCount] = useState(0);

  // MatchReviewList/Card require PendingMatch (adds accountId/accountName) so
  // they can render a per-row account label -- irrelevant here since we pass
  // showAccount={false}, so the fields are filled with harmless placeholders.
  const pendingMatches: PendingMatch[] = matches.map((match) => ({
    ...match,
    accountId: '',
    accountName: '',
  }));

  const allResolved = resolvedCount >= matches.length;

  const handleResolved = () => {
    setResolvedCount((count) => count + 1);
    usePendingReviewsStore.getState().refresh();
  };

  return (
    <div className="max-w-2xl mx-auto space-y-6">
      <MatchReviewList matches={pendingMatches} showAccount={false} onResolved={handleResolved} />
      <div className="flex justify-end">
        <Button variant="primary" onClick={onDone}>
          {allResolved ? t('matchReview.done') : `${t('matchReview.skipRemaining')} →`}
        </Button>
      </div>
    </div>
  );
}
