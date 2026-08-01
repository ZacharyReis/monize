import { describe, it, expect, vi, beforeEach } from 'vitest';
import { useRef } from 'react';
import { render, screen, waitFor, fireEvent } from '@/test/render';
import { RecentTransactionsPopover } from './RecentTransactionsPopover';
import { Transaction, TransactionStatus } from '@/types/transaction';

const mockGetRecent = vi.fn();
vi.mock('@/lib/transactions', () => ({
  transactionsApi: {
    getRecent: (...args: any[]) => mockGetRecent(...args),
  },
}));

vi.mock('@/hooks/useDateFormat', () => ({
  useDateFormat: () => ({ formatDate: (d: string) => d, dateFormat: 'browser' }),
}));

vi.mock('@/hooks/useNumberFormat', () => ({
  useNumberFormat: () => ({
    formatCurrency: (amount: number, code?: string) => `${code ?? 'CAD'} ${amount.toFixed(2)}`,
  }),
}));

vi.mock('@/lib/logger', () => ({
  createLogger: () => ({ error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() }),
}));

const mockPreferencesState = { recentTransactionsLimit: 5 as number | undefined };
vi.mock('@/store/preferencesStore', () => ({
  usePreferencesStore: (selector: (s: any) => any) =>
    selector({ preferences: { recentTransactionsLimit: mockPreferencesState.recentTransactionsLimit } }),
}));

function txn(overrides: Partial<Transaction> = {}): Transaction {
  return {
    id: 'tx-1',
    userId: 'user-1',
    accountId: 'acc-1',
    account: null,
    transactionDate: '2026-01-15',
    payeeId: 'payee-1',
    payeeName: 'Grocery Store',
    payee: null,
    categoryId: 'cat-1',
    category: { id: 'cat-1', name: 'Groceries' } as any,
    amount: -42.5,
    currencyCode: 'CAD',
    exchangeRate: 1,
    originalAmount: null,
    originalCurrencyCode: null,
    description: 'Weekly shop',
    referenceNumber: null,
    status: TransactionStatus.UNRECONCILED,
    isCleared: false,
    isReconciled: false,
    isVoid: false,
    reconciledDate: null,
    isSplit: false,
    parentTransactionId: null,
    isTransfer: false,
    linkedTransactionId: null,
    createdAt: '2026-01-15T00:00:00Z',
    updatedAt: '2026-01-15T00:00:00Z',
    ...overrides,
  };
}

function Harness(props: { payeeId?: string; payeeName?: string; onSelect: (t: Transaction) => void; onClose: () => void }) {
  const anchorRef = useRef<HTMLButtonElement>(null);
  return (
    <>
      <button ref={anchorRef}>anchor</button>
      <RecentTransactionsPopover anchorRef={anchorRef} {...props} />
    </>
  );
}

describe('RecentTransactionsPopover', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockPreferencesState.recentTransactionsLimit = 5;
  });

  it('uses the limit from preferences when fetching', async () => {
    mockPreferencesState.recentTransactionsLimit = 12;
    mockGetRecent.mockResolvedValue([]);
    render(<Harness onSelect={vi.fn()} onClose={vi.fn()} />);
    await waitFor(() => expect(mockGetRecent).toHaveBeenCalled());
    expect(mockGetRecent).toHaveBeenCalledWith({
      limit: 12,
      payeeId: undefined,
      payeeName: undefined,
    });
  });

  it('falls back to a limit of 5 when no preference is set', async () => {
    mockPreferencesState.recentTransactionsLimit = undefined;
    mockGetRecent.mockResolvedValue([]);
    render(<Harness onSelect={vi.fn()} onClose={vi.fn()} />);
    await waitFor(() => expect(mockGetRecent).toHaveBeenCalled());
    expect(mockGetRecent).toHaveBeenCalledWith({
      limit: 5,
      payeeId: undefined,
      payeeName: undefined,
    });
  });

  it('fetches global recents (no payee) when no filter is provided', async () => {
    mockGetRecent.mockResolvedValue([txn()]);
    render(<Harness onSelect={vi.fn()} onClose={vi.fn()} />);
    await waitFor(() => expect(mockGetRecent).toHaveBeenCalled());
    expect(mockGetRecent).toHaveBeenCalledWith({
      limit: 5,
      payeeId: undefined,
      payeeName: undefined,
    });
  });

  it('passes payeeId when provided and ignores payeeName', async () => {
    mockGetRecent.mockResolvedValue([]);
    render(<Harness payeeId="p1" payeeName="ignored" onSelect={vi.fn()} onClose={vi.fn()} />);
    await waitFor(() => expect(mockGetRecent).toHaveBeenCalled());
    expect(mockGetRecent).toHaveBeenCalledWith({
      limit: 5,
      payeeId: 'p1',
      payeeName: undefined,
    });
  });

  it('passes payeeName when payeeId is missing (free-text payee)', async () => {
    mockGetRecent.mockResolvedValue([]);
    render(<Harness payeeName="Free-text" onSelect={vi.fn()} onClose={vi.fn()} />);
    await waitFor(() => expect(mockGetRecent).toHaveBeenCalled());
    expect(mockGetRecent).toHaveBeenCalledWith({
      limit: 5,
      payeeId: undefined,
      payeeName: 'Free-text',
    });
  });

  it('renders rows for fetched transactions and calls onSelect when one is clicked', async () => {
    const t = txn();
    mockGetRecent.mockResolvedValue([t]);
    const onSelect = vi.fn();
    render(<Harness onSelect={onSelect} onClose={vi.fn()} />);

    await waitFor(() => {
      expect(screen.getByText('Grocery Store')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByText('Grocery Store'));
    expect(onSelect).toHaveBeenCalledWith(t);
  });

  it('shows an empty state when no recents are returned', async () => {
    mockGetRecent.mockResolvedValue([]);
    render(<Harness onSelect={vi.fn()} onClose={vi.fn()} />);
    await waitFor(() => {
      expect(screen.getByText(/No recent transactions/)).toBeInTheDocument();
    });
  });

  it('shows an error state when the fetch fails', async () => {
    mockGetRecent.mockRejectedValue(new Error('boom'));
    render(<Harness onSelect={vi.fn()} onClose={vi.fn()} />);
    await waitFor(() => {
      expect(screen.getByText(/Could not load/)).toBeInTheDocument();
    });
  });

  it('renders a Split row label with split categories', async () => {
    const splitTxn: Transaction = txn({
      id: 'split-1',
      isSplit: true,
      category: null,
      categoryId: null,
      splits: [
        { id: 'sp-1', transactionId: 'split-1', categoryId: 'c1', category: { id: 'c1', name: 'Groceries' } as any, transferAccountId: null, transferAccount: null, linkedTransactionId: null, amount: -30, memo: null, createdAt: '2026-01-15T00:00:00Z' },
        { id: 'sp-2', transactionId: 'split-1', categoryId: 'c2', category: { id: 'c2', name: 'Household' } as any, transferAccountId: null, transferAccount: null, linkedTransactionId: null, amount: -20, memo: null, createdAt: '2026-01-15T00:00:00Z' },
      ],
    });
    mockGetRecent.mockResolvedValue([splitTxn]);

    render(<Harness onSelect={vi.fn()} onClose={vi.fn()} />);

    await waitFor(() => {
      expect(screen.getByText(/Split: Groceries, Household/)).toBeInTheDocument();
    });
  });

  it('closes when Escape is pressed', async () => {
    mockGetRecent.mockResolvedValue([]);
    const onClose = vi.fn();
    render(<Harness onSelect={vi.fn()} onClose={onClose} />);
    await waitFor(() => expect(mockGetRecent).toHaveBeenCalled());
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(onClose).toHaveBeenCalled();
  });
});
