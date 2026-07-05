import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, within } from '@/test/render';
import { MatchReviewCard } from './MatchReviewCard';
import { PendingMatch } from '@/types/import';

const single: PendingMatch = {
  candidateId: 'c1',
  bankAmount: -11.04,
  bankDate: '2026-07-02',
  bankName: 'GOOGLE',
  accountId: 'a1',
  accountName: 'TD Checking',
  candidates: [
    { id: 't1', transactionDate: '2026-07-01', amount: -11.04, payeeName: 'Google', description: null },
  ],
};
const handlers = () => ({ onMerge: vi.fn(), onKeepBoth: vi.fn(), onDismiss: vi.fn() });

describe('MatchReviewCard', () => {
  beforeEach(() => vi.clearAllMocks());

  it('merge opens a confirm dialog and fires onMerge once on confirm', () => {
    const h = handlers();
    render(<MatchReviewCard match={single} {...h} />);
    fireEvent.click(screen.getByRole('button', { name: /^merge$/i })); // trigger
    expect(h.onMerge).not.toHaveBeenCalled(); // gated by confirm
    const dialog = screen.getByRole('dialog');
    fireEvent.click(within(dialog).getByRole('button', { name: /^merge$/i })); // confirm
    expect(h.onMerge).toHaveBeenCalledTimes(1);
    expect(h.onMerge).toHaveBeenCalledWith('c1', 't1');
  });

  it('cancel in the confirm dialog does not fire onMerge and closes the dialog', () => {
    const h = handlers();
    render(<MatchReviewCard match={single} {...h} />);
    fireEvent.click(screen.getByRole('button', { name: /^merge$/i }));
    const dialog = screen.getByRole('dialog');
    fireEvent.click(within(dialog).getByRole('button', { name: /cancel/i }));
    expect(h.onMerge).not.toHaveBeenCalled();
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('keep-both and dismiss are one-click (no confirm)', () => {
    const h = handlers();
    render(<MatchReviewCard match={single} {...h} />);
    fireEvent.click(screen.getByRole('button', { name: /keep both/i }));
    fireEvent.click(screen.getByRole('button', { name: /dismiss/i }));
    expect(h.onKeepBoth).toHaveBeenCalledWith('c1');
    expect(h.onDismiss).toHaveBeenCalledWith('c1');
  });

  it('multi-candidate disables merge until a row is selected', () => {
    const multi = { ...single, candidates: [single.candidates[0], { ...single.candidates[0], id: 't2' }] };
    render(<MatchReviewCard match={multi} {...handlers()} />);
    expect(screen.getByRole('button', { name: /^merge$/i })).toBeDisabled();
    fireEvent.click(screen.getAllByRole('radio')[1]);
    expect(screen.getByRole('button', { name: /^merge$/i })).not.toBeDisabled();
  });

  it('zero-live disables merge, keeps dismiss/keep-both', () => {
    render(<MatchReviewCard match={{ ...single, candidates: [] }} {...handlers()} />);
    expect(screen.getByRole('button', { name: /^merge$/i })).toBeDisabled();
    expect(screen.getByRole('button', { name: /dismiss/i })).toBeEnabled();
  });

  it('showAccount renders the account name', () => {
    render(<MatchReviewCard match={single} {...handlers()} showAccount />);
    expect(screen.getByText('TD Checking')).toBeInTheDocument();
  });

  it('resolving disables merge, keep-both, and dismiss', () => {
    render(<MatchReviewCard match={single} {...handlers()} resolving />);
    expect(screen.getByRole('button', { name: /^merge$/i })).toBeDisabled();
    expect(screen.getByRole('button', { name: /keep both/i })).toBeDisabled();
    expect(screen.getByRole('button', { name: /dismiss/i })).toBeDisabled();
  });
});
