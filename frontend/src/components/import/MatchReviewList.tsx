'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import toast from 'react-hot-toast';
import { MatchReviewCard } from './MatchReviewCard';
import { importMatchesApi } from '@/lib/import-matches';
import { PendingMatch } from '@/types/import';

interface MatchReviewListProps {
  matches: PendingMatch[];
  onResolved?: (candidateId: string) => void;
  onRefresh?: () => void;
  showAccount?: boolean;
}

/**
 * The backend returns a structured `{ code: "already_resolved" }` body when a candidate
 * was already resolved by another request (e.g. a double-click, or a concurrent session) --
 * that's a benign race, not a real failure.
 */
function isAlreadyResolved(err: unknown): boolean {
  return (
    (err as { response?: { data?: { code?: string } } } | null | undefined)?.response?.data?.code ===
    'already_resolved'
  );
}

/**
 * Notify any other open views (this window's Transactions/Accounts pages, and
 * other browser tabs) that a match resolution just changed the transaction
 * set, so they can refetch. `BroadcastChannel` is guarded because it is not
 * universally available (older browsers, some SSR/test environments) --
 * construction must never throw at call time.
 */
function broadcastTransactionsChanged(): void {
  window.dispatchEvent(new CustomEvent('monize:transactions-changed'));
  if (typeof BroadcastChannel !== 'undefined') {
    new BroadcastChannel('monize').postMessage('transactions-changed');
  }
}

export function MatchReviewList({ matches, onResolved, onRefresh, showAccount = false }: MatchReviewListProps) {
  const t = useTranslations('import');
  const [resolvedIds, setResolvedIds] = useState<Set<string>>(new Set());
  const [resolvingIds, setResolvingIds] = useState<Set<string>>(new Set());

  const setResolving = (candidateId: string, value: boolean) => {
    setResolvingIds((prev) => {
      const next = new Set(prev);
      if (value) {
        next.add(candidateId);
      } else {
        next.delete(candidateId);
      }
      return next;
    });
  };

  const markResolved = (candidateId: string) => {
    setResolvedIds((prev) => new Set(prev).add(candidateId));
    onResolved?.(candidateId);
    broadcastTransactionsChanged();
  };

  const resolve = async (candidateId: string, action: () => Promise<unknown>) => {
    setResolving(candidateId, true);
    try {
      await action();
      markResolved(candidateId);
    } catch (err) {
      if (isAlreadyResolved(err)) {
        // Benign race: the server already resolved it. No error toast, and the card
        // resolves exactly as if this request had won the race.
        markResolved(candidateId);
      } else {
        // A real conflict (e.g. target_ineligible) -- surface it and let the caller
        // refresh the list with server truth. Do NOT mark the card resolved here: it's
        // about to be replaced by a fresh fetch (or, in the wizard, simply falls to the
        // queue for a later pass).
        toast.error(t('matchReview.resolveError'));
        onRefresh?.();
      }
    } finally {
      setResolving(candidateId, false);
    }
  };

  const handleMerge = (candidateId: string, transactionId: string) =>
    resolve(candidateId, () => importMatchesApi.merge(candidateId, transactionId));

  const handleKeepBoth = (candidateId: string) => resolve(candidateId, () => importMatchesApi.keepBoth(candidateId));

  const handleDismiss = (candidateId: string) => resolve(candidateId, () => importMatchesApi.dismiss(candidateId));

  const visibleMatches = matches.filter((match) => !resolvedIds.has(match.candidateId));

  if (visibleMatches.length === 0) {
    return <p>{t('matchReview.empty')}</p>;
  }

  return (
    <div className="space-y-4">
      {visibleMatches.map((match) => (
        <MatchReviewCard
          key={match.candidateId}
          match={match}
          onMerge={handleMerge}
          onKeepBoth={handleKeepBoth}
          onDismiss={handleDismiss}
          resolving={resolvingIds.has(match.candidateId)}
          showAccount={showAccount}
        />
      ))}
    </div>
  );
}
