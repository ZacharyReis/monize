'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { Button } from '@/components/ui/Button';
import { useNumberFormat } from '@/hooks/useNumberFormat';
import { useDateFormat } from '@/hooks/useDateFormat';
import { PendingMatch } from '@/types/import';

interface MatchReviewCardProps {
  match: PendingMatch;
  onMerge: (candidateId: string, transactionId: string) => void;
  onKeepBoth: (candidateId: string) => void;
  onDismiss: (candidateId: string) => void;
  resolving?: boolean;
  showAccount?: boolean;
}

export function MatchReviewCard({
  match,
  onMerge,
  onKeepBoth,
  onDismiss,
  resolving = false,
  showAccount = false,
}: MatchReviewCardProps) {
  const t = useTranslations('import');
  const { formatCurrency } = useNumberFormat();
  const { formatDate } = useDateFormat();

  const isSingleCandidate = match.candidates.length === 1;
  const [selectedId, setSelectedId] = useState<string | undefined>(
    isSingleCandidate ? match.candidates[0].id : undefined
  );
  const [confirmOpen, setConfirmOpen] = useState(false);

  const canMerge = !!selectedId && !resolving;

  const handleConfirm = () => {
    // Close-then-async: dismiss the dialog before invoking the (potentially
    // async, upstream-owned) merge handler so the UI never shows a stale
    // confirm dialog while the request is in flight.
    setConfirmOpen(false);
    if (selectedId) {
      onMerge(match.candidateId, selectedId);
    }
  };

  return (
    <div className="border border-gray-200 dark:border-gray-700 rounded-lg p-4 space-y-4">
      {showAccount && (
        <div className="text-xs font-medium text-gray-500 dark:text-gray-400">
          {t('matchReview.account')}:{' '}
          <span className="font-semibold text-gray-700 dark:text-gray-300">{match.accountName}</span>
        </div>
      )}

      {/* Bank record row */}
      <div className="flex items-center justify-between gap-3 rounded-md bg-gray-50 dark:bg-gray-800 p-3">
        <span className="text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400 whitespace-nowrap">
          {t('matchReview.bankRow')}
        </span>
        <div className="flex-1 text-sm text-gray-900 dark:text-gray-100 text-right">
          {match.bankName && <span className="mr-2">{match.bankName}</span>}
          <span>{formatDate(match.bankDate)}</span>
          <span className="ml-2 font-medium">{formatCurrency(match.bankAmount)}</span>
        </div>
      </div>

      {/* Candidate transaction row(s) */}
      {match.candidates.length === 0 ? (
        <p className="text-sm text-gray-500 dark:text-gray-400">{t('matchReview.empty')}</p>
      ) : (
        <div className="space-y-2">
          {match.candidates.map((candidate) => (
            <label
              key={candidate.id}
              className="flex items-center gap-3 rounded-md border border-gray-200 dark:border-gray-700 p-3 cursor-pointer"
            >
              {!isSingleCandidate && (
                <input
                  type="radio"
                  name={`candidate-${match.candidateId}`}
                  checked={selectedId === candidate.id}
                  onChange={() => setSelectedId(candidate.id)}
                  disabled={resolving}
                  className="h-4 w-4 text-blue-600 focus:ring-blue-500 border-gray-300 dark:border-gray-600"
                  aria-label={t('matchReview.yourRow')}
                />
              )}
              <span className="text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400 whitespace-nowrap">
                {t('matchReview.yourRow')}
              </span>
              <div className="flex-1 text-sm text-gray-900 dark:text-gray-100 text-right">
                {candidate.payeeName && <span className="mr-2">{candidate.payeeName}</span>}
                <span>{formatDate(candidate.transactionDate)}</span>
                <span className="ml-2 font-medium">{formatCurrency(candidate.amount)}</span>
              </div>
            </label>
          ))}
        </div>
      )}

      <div className="flex justify-end gap-2">
        <Button variant="outline" onClick={() => onDismiss(match.candidateId)} disabled={resolving}>
          {t('matchReview.dismiss')}
        </Button>
        <Button variant="secondary" onClick={() => onKeepBoth(match.candidateId)} disabled={resolving}>
          {t('matchReview.keepBoth')}
        </Button>
        <Button variant="primary" onClick={() => setConfirmOpen(true)} disabled={!canMerge}>
          {t('matchReview.merge')}
        </Button>
      </div>

      <ConfirmDialog
        isOpen={confirmOpen}
        title={t('matchReview.confirmMergeTitle')}
        message={t('matchReview.confirmMergeMessage')}
        confirmLabel={t('matchReview.merge')}
        variant="warning"
        onConfirm={handleConfirm}
        onCancel={() => setConfirmOpen(false)}
      />
    </div>
  );
}
