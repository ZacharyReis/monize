import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, within, act, waitFor } from '@/test/render';
import { MatchReviewList } from './MatchReviewList';
import { importMatchesApi } from '@/lib/import-matches';
import toast from 'react-hot-toast';
import { PendingMatch } from '@/types/import';

vi.mock('@/lib/import-matches', () => ({
  importMatchesApi: { merge: vi.fn(), keepBoth: vi.fn(), dismiss: vi.fn() },
}));
vi.mock('react-hot-toast', () => ({ default: { success: vi.fn(), error: vi.fn() } }));

const makeMatch = (candidateId: string): PendingMatch => ({
  candidateId,
  bankAmount: -11.04,
  bankDate: '2026-07-02',
  bankName: 'GOOGLE',
  accountId: 'a1',
  accountName: 'TD Checking',
  candidates: [
    {
      id: `${candidateId}-t1`,
      transactionDate: '2026-07-01',
      amount: -11.04,
      payeeName: 'Google',
      description: null,
    },
  ],
});

// Single-candidate card: clicking "Merge" opens the confirm dialog; confirming inside
// the dialog fires the actual resolution call. Mirrors MatchReviewCard.test.tsx.
async function confirmMerge() {
  fireEvent.click(screen.getByRole('button', { name: /^merge$/i }));
  const dialog = screen.getByRole('dialog');
  await act(async () => {
    fireEvent.click(within(dialog).getByRole('button', { name: /^merge$/i }));
  });
}

const EMPTY_TEXT = "You're all caught up - no matches to review.";
const RESOLVE_ERROR_TEXT = 'Could not resolve this match - it has been refreshed.';

describe('MatchReviewList', () => {
  beforeEach(() => vi.clearAllMocks());

  it('renders the empty state when there are no matches', () => {
    render(<MatchReviewList matches={[]} />);
    expect(screen.getByText(EMPTY_TEXT)).toBeInTheDocument();
  });

  it('merge success removes the card and calls onResolved', async () => {
    (importMatchesApi.merge as any).mockResolvedValue(undefined);
    const onResolved = vi.fn();
    const match = makeMatch('c1');
    render(<MatchReviewList matches={[match]} onResolved={onResolved} />);

    await confirmMerge();

    await waitFor(() => expect(onResolved).toHaveBeenCalledWith('c1'));
    expect(importMatchesApi.merge).toHaveBeenCalledWith('c1', 'c1-t1');
    expect(screen.getByText(EMPTY_TEXT)).toBeInTheDocument();
    expect(toast.error).not.toHaveBeenCalled();
  });

  it('already_resolved rejection is benign: no error toast, card resolved, onResolved fires, no refresh', async () => {
    (importMatchesApi.merge as any).mockRejectedValue({
      response: { data: { code: 'already_resolved' } },
    });
    const onResolved = vi.fn();
    const onRefresh = vi.fn();
    const match = makeMatch('c1');
    render(<MatchReviewList matches={[match]} onResolved={onResolved} onRefresh={onRefresh} />);

    await confirmMerge();

    await waitFor(() => expect(onResolved).toHaveBeenCalledWith('c1'));
    expect(toast.error).not.toHaveBeenCalled();
    expect(onRefresh).not.toHaveBeenCalled();
    expect(screen.getByText(EMPTY_TEXT)).toBeInTheDocument();
  });

  it('target_ineligible rejection shows an error toast, calls onRefresh, and keeps the card', async () => {
    (importMatchesApi.merge as any).mockRejectedValue({
      response: { data: { code: 'target_ineligible' } },
    });
    const onResolved = vi.fn();
    const onRefresh = vi.fn();
    const match = makeMatch('c1');
    render(<MatchReviewList matches={[match]} onResolved={onResolved} onRefresh={onRefresh} />);

    await confirmMerge();

    await waitFor(() => expect(toast.error).toHaveBeenCalledWith(RESOLVE_ERROR_TEXT));
    expect(onRefresh).toHaveBeenCalledTimes(1);
    expect(onResolved).not.toHaveBeenCalled();
    // Card stays -- not marked resolved, since the list is about to be refreshed with
    // server truth.
    expect(screen.getByRole('button', { name: /^merge$/i })).toBeInTheDocument();
    expect(screen.queryByText(EMPTY_TEXT)).not.toBeInTheDocument();
  });

  it('disables the resolving card while a merge is in flight, then removes it on success', async () => {
    let resolveMerge: () => void = () => {};
    (importMatchesApi.merge as any).mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          resolveMerge = resolve;
        })
    );
    const match = makeMatch('c1');
    render(<MatchReviewList matches={[match]} />);

    fireEvent.click(screen.getByRole('button', { name: /^merge$/i }));
    const dialog = screen.getByRole('dialog');
    fireEvent.click(within(dialog).getByRole('button', { name: /^merge$/i }));

    await waitFor(() => expect(screen.getByRole('button', { name: /keep both/i })).toBeDisabled());
    expect(screen.getByRole('button', { name: /dismiss/i })).toBeDisabled();

    await act(async () => {
      resolveMerge();
    });

    await waitFor(() => expect(screen.getByText(EMPTY_TEXT)).toBeInTheDocument());
  });

  it('keepBoth success removes only the resolved card, leaving the other match visible', async () => {
    (importMatchesApi.keepBoth as any).mockResolvedValue({ id: 'new-t' });
    const onResolved = vi.fn();
    const matches = [makeMatch('c1'), makeMatch('c2')];
    render(<MatchReviewList matches={matches} onResolved={onResolved} />);

    const keepBothButtons = screen.getAllByRole('button', { name: /keep both/i });
    expect(keepBothButtons).toHaveLength(2);
    await act(async () => fireEvent.click(keepBothButtons[0]));

    await waitFor(() => expect(onResolved).toHaveBeenCalledWith('c1'));
    expect(importMatchesApi.keepBoth).toHaveBeenCalledWith('c1');
    expect(screen.getAllByRole('button', { name: /keep both/i })).toHaveLength(1);
  });

  it('dismiss routes through the same conflict handling (target_ineligible keeps the card + refreshes)', async () => {
    (importMatchesApi.dismiss as any).mockRejectedValue({
      response: { data: { code: 'target_ineligible' } },
    });
    const onRefresh = vi.fn();
    const match = makeMatch('c1');
    render(<MatchReviewList matches={[match]} onRefresh={onRefresh} />);

    await act(async () => fireEvent.click(screen.getByRole('button', { name: /dismiss/i })));

    await waitFor(() => expect(toast.error).toHaveBeenCalledWith(RESOLVE_ERROR_TEXT));
    expect(importMatchesApi.dismiss).toHaveBeenCalledWith('c1');
    expect(onRefresh).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('button', { name: /dismiss/i })).toBeInTheDocument();
  });

  it('passes showAccount through to each card', () => {
    render(<MatchReviewList matches={[makeMatch('c1')]} showAccount />);
    expect(screen.getByText('TD Checking')).toBeInTheDocument();
  });
});
