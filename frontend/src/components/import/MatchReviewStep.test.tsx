import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@/test/render';
import { MatchReviewStep } from './MatchReviewStep';
import { importMatchesApi } from '@/lib/import-matches';
import { ProposedMatch } from '@/types/import';

vi.mock('@/lib/import-matches', () => ({
  importMatchesApi: { merge: vi.fn(), keepBoth: vi.fn(), dismiss: vi.fn() },
}));
vi.mock('react-hot-toast', () => ({ default: { success: vi.fn(), error: vi.fn() } }));

const makeMatch = (candidateId: string): ProposedMatch => ({
  candidateId,
  bankAmount: -11.04,
  bankDate: '2026-07-02',
  bankName: 'GOOGLE',
  candidates: [
    { id: `${candidateId}-t1`, transactionDate: '2026-07-01', amount: -11.04, payeeName: 'Google', description: null },
  ],
});

describe('MatchReviewStep', () => {
  beforeEach(() => vi.clearAllMocks());

  it('renders the match list', () => {
    render(<MatchReviewStep matches={[makeMatch('c1')]} onDone={() => {}} />);
    expect(screen.getByText('GOOGLE')).toBeInTheDocument();
    // showAccount is false -- the account label should not be rendered.
    expect(screen.queryByText('Account:')).not.toBeInTheDocument();
  });

  it('shows "Skip remaining" while matches are unresolved, and calls onDone on click', () => {
    const onDone = vi.fn();
    render(<MatchReviewStep matches={[makeMatch('c1'), makeMatch('c2')]} onDone={onDone} />);

    const button = screen.getByRole('button', { name: /skip remaining/i });
    fireEvent.click(button);
    expect(onDone).toHaveBeenCalledTimes(1);
  });

  it('flips the footer to "Done" once every match has been resolved, and calls onDone on click', async () => {
    (importMatchesApi.dismiss as any).mockResolvedValue(undefined);
    const onDone = vi.fn();
    render(<MatchReviewStep matches={[makeMatch('c1')]} onDone={onDone} />);

    expect(screen.getByRole('button', { name: /skip remaining/i })).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /^dismiss$/i }));

    await waitFor(() => expect(screen.getByRole('button', { name: /^done$/i })).toBeInTheDocument());
    expect(screen.queryByRole('button', { name: /skip remaining/i })).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /^done$/i }));
    expect(onDone).toHaveBeenCalledTimes(1);
  });

  it('shows "Done" immediately when there are no matches', () => {
    render(<MatchReviewStep matches={[]} onDone={() => {}} />);
    expect(screen.getByRole('button', { name: /^done$/i })).toBeInTheDocument();
  });
});
