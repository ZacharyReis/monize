import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@/test/render';
import PendingReviewsPage from './page';
import { importMatchesApi } from '@/lib/import-matches';
import { usePendingReviewsStore } from '@/store/pendingReviewsStore';
import { PendingMatch } from '@/types/import';

// Mock auth store so ProtectedRoute renders its children immediately.
vi.mock('@/store/authStore', () => ({
  useAuthStore: Object.assign(
    (selector?: any) => {
      const state = {
        user: {
          id: 'test-user-id',
          email: 'test@example.com',
          firstName: 'Test',
          lastName: 'User',
          role: 'user',
          hasPassword: true,
          mustChangePassword: false,
        },
        isAuthenticated: true,
        isLoading: false,
        _hasHydrated: true,
        logout: vi.fn(),
      };
      return selector ? selector(state) : state;
    },
    {
      getState: vi.fn(() => ({
        user: { id: 'test-user-id' },
        isAuthenticated: true,
        _hasHydrated: true,
        logout: vi.fn(),
      })),
    },
  ),
}));

// ProtectedRoute fetches force2fa settings on mount; keep it a resolved no-op.
vi.mock('@/lib/auth', () => ({
  authApi: {
    getAuthMethods: vi.fn().mockResolvedValue({
      local: true,
      oidc: false,
      registration: true,
      smtp: false,
      force2fa: false,
      demo: false,
    }),
  },
}));

const mockList = vi.fn();
vi.mock('@/lib/import-matches', () => ({
  importMatchesApi: {
    list: (...args: any[]) => mockList(...args),
    merge: vi.fn(),
    keepBoth: vi.fn(),
    dismiss: vi.fn(),
  },
}));

const makeMatch = (candidateId: string): PendingMatch => ({
  candidateId,
  bankAmount: -11.04,
  bankDate: '2026-07-02',
  bankName: 'GOOGLE',
  accountId: 'a1',
  accountName: 'TD Checking',
  candidates: [
    { id: `${candidateId}-t1`, transactionDate: '2026-07-01', amount: -11.04, payeeName: 'Google', description: null },
  ],
});

const EMPTY_TEXT = "You're all caught up - no matches to review.";

describe('PendingReviewsPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    usePendingReviewsStore.setState({ count: 0 });
  });

  it('renders the page title', () => {
    mockList.mockResolvedValue([]);
    render(<PendingReviewsPage />);
    expect(screen.getByRole('heading', { name: 'Pending Reviews' })).toBeInTheDocument();
  });

  it('fetches matches on mount and renders them via MatchReviewList with showAccount', async () => {
    mockList.mockResolvedValue([makeMatch('c1')]);
    render(<PendingReviewsPage />);

    await waitFor(() => expect(mockList).toHaveBeenCalled());
    expect(await screen.findByText('GOOGLE')).toBeInTheDocument();
    // showAccount renders the account name label on the card -- this only
    // appears when showAccount is true.
    expect(screen.getByText('TD Checking')).toBeInTheDocument();
  });

  it('refreshes the pending reviews store on mount', async () => {
    mockList.mockResolvedValue([makeMatch('c1'), makeMatch('c2')]);
    render(<PendingReviewsPage />);

    await waitFor(() => expect(usePendingReviewsStore.getState().count).toBe(2));
  });

  it('shows the matchReview.empty string when the list is empty', async () => {
    mockList.mockResolvedValue([]);
    render(<PendingReviewsPage />);

    expect(await screen.findByText(EMPTY_TEXT)).toBeInTheDocument();
  });

  it('re-fetches the list and refreshes the store when a match is resolved', async () => {
    mockList
      .mockResolvedValueOnce([makeMatch('c1')]) // page's direct fetch on mount
      .mockResolvedValueOnce([makeMatch('c1')]) // store refresh on mount
      .mockResolvedValueOnce([]) // page's direct fetch after resolve
      .mockResolvedValueOnce([]); // store refresh after resolve
    (importMatchesApi.dismiss as any).mockResolvedValue(undefined);

    render(<PendingReviewsPage />);
    await screen.findByText('GOOGLE');
    await waitFor(() => expect(mockList).toHaveBeenCalledTimes(2));

    fireEvent.click(screen.getByRole('button', { name: /^dismiss$/i }));

    await waitFor(() => expect(mockList).toHaveBeenCalledTimes(4));
    await waitFor(() => expect(usePendingReviewsStore.getState().count).toBe(0));
  });
});
