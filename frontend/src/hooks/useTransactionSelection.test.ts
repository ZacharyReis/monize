import { describe, it, expect } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useTransactionSelection } from './useTransactionSelection';
import { Transaction, TransactionStatus, BulkUpdateFilters } from '@/types/transaction';

function createTransaction(id: string): Transaction {
  return {
    id,
    userId: 'user-1',
    accountId: 'acc-1',
    account: null,
    transactionDate: '2024-01-15',
    payeeId: null,
    payeeName: null,
    payee: null,
    categoryId: null,
    category: null,
    amount: -50,
    currencyCode: 'CAD',
    exchangeRate: 1,
    originalAmount: null,
    originalCurrencyCode: null,
    description: null,
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
    createdAt: '2024-01-15T00:00:00Z',
    updatedAt: '2024-01-15T00:00:00Z',
  };
}

const emptyFilters: BulkUpdateFilters = {};

describe('useTransactionSelection', () => {
  const transactions = [
    createTransaction('tx-1'),
    createTransaction('tx-2'),
    createTransaction('tx-3'),
  ];

  it('starts with no selection', () => {
    const { result } = renderHook(() =>
      useTransactionSelection(transactions, 100, emptyFilters)
    );

    expect(result.current.selectedIds.size).toBe(0);
    expect(result.current.selectAllMatching).toBe(false);
    expect(result.current.hasSelection).toBe(false);
    expect(result.current.selectionCount).toBe(0);
    expect(result.current.isAllOnPageSelected).toBe(false);
  });

  it('toggleTransaction selects and deselects individual transactions', () => {
    const { result } = renderHook(() =>
      useTransactionSelection(transactions, 100, emptyFilters)
    );

    act(() => result.current.toggleTransaction('tx-1'));
    expect(result.current.selectedIds.has('tx-1')).toBe(true);
    expect(result.current.selectionCount).toBe(1);
    expect(result.current.hasSelection).toBe(true);

    act(() => result.current.toggleTransaction('tx-1'));
    expect(result.current.selectedIds.has('tx-1')).toBe(false);
    expect(result.current.selectionCount).toBe(0);
  });

  it('toggleAllOnPage selects all transactions on the current page', () => {
    const { result } = renderHook(() =>
      useTransactionSelection(transactions, 100, emptyFilters)
    );

    act(() => result.current.toggleAllOnPage());
    expect(result.current.selectedIds.size).toBe(3);
    expect(result.current.isAllOnPageSelected).toBe(true);
  });

  it('toggleAllOnPage deselects all when all are selected', () => {
    const { result } = renderHook(() =>
      useTransactionSelection(transactions, 100, emptyFilters)
    );

    act(() => result.current.toggleAllOnPage());
    expect(result.current.isAllOnPageSelected).toBe(true);

    act(() => result.current.toggleAllOnPage());
    expect(result.current.selectedIds.size).toBe(0);
    expect(result.current.isAllOnPageSelected).toBe(false);
  });

  it('selectAllMatchingTransactions enables filter-based selection', () => {
    const { result } = renderHook(() =>
      useTransactionSelection(transactions, 100, emptyFilters)
    );

    act(() => result.current.selectAllMatchingTransactions());
    expect(result.current.selectAllMatching).toBe(true);
    expect(result.current.selectionCount).toBe(100);
    // All on page should also be selected for visual consistency
    expect(result.current.isAllOnPageSelected).toBe(true);
  });

  it('clearSelection resets everything', () => {
    const { result } = renderHook(() =>
      useTransactionSelection(transactions, 100, emptyFilters)
    );

    act(() => result.current.selectAllMatchingTransactions());
    expect(result.current.selectionCount).toBe(100);

    act(() => result.current.clearSelection());
    expect(result.current.selectedIds.size).toBe(0);
    expect(result.current.selectAllMatching).toBe(false);
    expect(result.current.hasSelection).toBe(false);
  });

  it('toggleTransaction excludes a single id while keeping selectAllMatching active', () => {
    const { result } = renderHook(() =>
      useTransactionSelection(transactions, 100, emptyFilters)
    );

    act(() => result.current.selectAllMatchingTransactions());
    expect(result.current.selectAllMatching).toBe(true);

    // Toggling one off should add it to excludedIds, not exit all-matching
    act(() => result.current.toggleTransaction('tx-2'));
    expect(result.current.selectAllMatching).toBe(true);
    expect(result.current.excludedIds.has('tx-2')).toBe(true);
    expect(result.current.isTransactionSelected('tx-1')).toBe(true);
    expect(result.current.isTransactionSelected('tx-2')).toBe(false);
    expect(result.current.isTransactionSelected('tx-3')).toBe(true);
    expect(result.current.selectionCount).toBe(99);

    // Toggling again re-includes it
    act(() => result.current.toggleTransaction('tx-2'));
    expect(result.current.excludedIds.has('tx-2')).toBe(false);
    expect(result.current.selectionCount).toBe(100);
  });

  it('keeps isAllOnPageSelected true after page change while selectAllMatching', () => {
    const page1 = [createTransaction('tx-1'), createTransaction('tx-2')];
    const page2 = [createTransaction('tx-3'), createTransaction('tx-4')];

    const { result, rerender } = renderHook(
      ({ txs }) => useTransactionSelection(txs, 100, emptyFilters),
      { initialProps: { txs: page1 } }
    );

    act(() => result.current.selectAllMatchingTransactions());
    expect(result.current.isAllOnPageSelected).toBe(true);

    rerender({ txs: page2 });
    expect(result.current.selectAllMatching).toBe(true);
    expect(result.current.isAllOnPageSelected).toBe(true);
    expect(result.current.isTransactionSelected('tx-3')).toBe(true);
    expect(result.current.isTransactionSelected('tx-4')).toBe(true);
  });

  it('preserves exclusions across page navigation in selectAllMatching mode', () => {
    const page1 = [createTransaction('tx-1'), createTransaction('tx-2')];
    const page2 = [createTransaction('tx-3'), createTransaction('tx-4')];

    const { result, rerender } = renderHook(
      ({ txs }) => useTransactionSelection(txs, 100, emptyFilters),
      { initialProps: { txs: page1 } }
    );

    act(() => result.current.selectAllMatchingTransactions());
    act(() => result.current.toggleTransaction('tx-1'));
    expect(result.current.isTransactionSelected('tx-1')).toBe(false);
    expect(result.current.isTransactionSelected('tx-2')).toBe(true);

    rerender({ txs: page2 });
    // Page 2 transactions remain selected
    expect(result.current.isTransactionSelected('tx-3')).toBe(true);
    expect(result.current.isTransactionSelected('tx-4')).toBe(true);

    rerender({ txs: page1 });
    // Returning to page 1: tx-1 still excluded, tx-2 still included
    expect(result.current.isTransactionSelected('tx-1')).toBe(false);
    expect(result.current.isTransactionSelected('tx-2')).toBe(true);
  });

  it('toggleAllOnPage excludes all current page ids in selectAllMatching mode', () => {
    const { result } = renderHook(() =>
      useTransactionSelection(transactions, 100, emptyFilters)
    );

    act(() => result.current.selectAllMatchingTransactions());
    expect(result.current.selectionCount).toBe(100);

    act(() => result.current.toggleAllOnPage());
    expect(result.current.selectAllMatching).toBe(true);
    expect(result.current.excludedIds.size).toBe(3);
    expect(result.current.isAllOnPageSelected).toBe(false);
    expect(result.current.selectionCount).toBe(97);

    // Clicking again re-includes the page
    act(() => result.current.toggleAllOnPage());
    expect(result.current.excludedIds.size).toBe(0);
    expect(result.current.isAllOnPageSelected).toBe(true);
    expect(result.current.selectionCount).toBe(100);
  });

  it('clearSelection clears excludedIds too', () => {
    const { result } = renderHook(() =>
      useTransactionSelection(transactions, 100, emptyFilters)
    );

    act(() => result.current.selectAllMatchingTransactions());
    act(() => result.current.toggleTransaction('tx-1'));
    expect(result.current.excludedIds.size).toBe(1);

    act(() => result.current.clearSelection());
    expect(result.current.excludedIds.size).toBe(0);
    expect(result.current.selectAllMatching).toBe(false);
  });

  it('clears selection when filters change', () => {
    const filters1: BulkUpdateFilters = { search: 'foo' };
    const filters2: BulkUpdateFilters = { search: 'bar' };

    const { result, rerender } = renderHook(
      ({ filters }) => useTransactionSelection(transactions, 100, filters),
      { initialProps: { filters: filters1 } }
    );

    act(() => result.current.toggleTransaction('tx-1'));
    expect(result.current.selectionCount).toBe(1);

    rerender({ filters: filters2 });
    expect(result.current.selectedIds.size).toBe(0);
    expect(result.current.selectAllMatching).toBe(false);
  });

  describe('buildSelectionPayload', () => {
    it('returns ids mode when using individual selection', () => {
      const { result } = renderHook(() =>
        useTransactionSelection(transactions, 100, emptyFilters)
      );

      act(() => result.current.toggleTransaction('tx-1'));
      act(() => result.current.toggleTransaction('tx-3'));

      const payload = result.current.buildSelectionPayload();
      expect(payload.mode).toBe('ids');
      expect(payload.transactionIds).toEqual(expect.arrayContaining(['tx-1', 'tx-3']));
      expect(payload.transactionIds).toHaveLength(2);
      expect(payload.filters).toBeUndefined();
    });

    it('returns filter mode when selectAllMatching is active', () => {
      const filters: BulkUpdateFilters = { accountIds: ['acc-1'], search: 'test' };
      const { result } = renderHook(() =>
        useTransactionSelection(transactions, 100, filters)
      );

      act(() => result.current.selectAllMatchingTransactions());

      const payload = result.current.buildSelectionPayload();
      expect(payload.mode).toBe('filter');
      expect(payload.filters).toEqual(filters);
      expect(payload.transactionIds).toBeUndefined();
      expect(payload.excludedIds).toBeUndefined();
    });

    it('includes excludedIds in filter-mode payload', () => {
      const filters: BulkUpdateFilters = { accountIds: ['acc-1'] };
      const { result } = renderHook(() =>
        useTransactionSelection(transactions, 100, filters)
      );

      act(() => result.current.selectAllMatchingTransactions());
      act(() => result.current.toggleTransaction('tx-1'));
      act(() => result.current.toggleTransaction('tx-3'));

      const payload = result.current.buildSelectionPayload();
      expect(payload.mode).toBe('filter');
      expect(payload.filters).toEqual(filters);
      expect(payload.excludedIds).toEqual(expect.arrayContaining(['tx-1', 'tx-3']));
      expect(payload.excludedIds).toHaveLength(2);
    });
  });
});
