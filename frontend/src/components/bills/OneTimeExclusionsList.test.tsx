import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@/test/render';
import { OneTimeExclusionsList } from './OneTimeExclusionsList';
import { transactionsApi } from '@/lib/transactions';

vi.mock('@/lib/transactions', () => ({
  transactionsApi: { update: vi.fn().mockResolvedValue({}) },
}));

const outlier = {
  date: '2026-03-20',
  categoryId: null,
  categoryName: 'Uncategorized',
  amount: 4200,
  payeeName: 'DebtSettlementCo',
  reason: 'single_payee_occurrence',
  transactionId: 'txn-1',
};

describe('OneTimeExclusionsList', () => {
  it('renders excluded outliers', () => {
    render(
      <OneTimeExclusionsList
        outliers={[outlier]}
        currencyCode="USD"
        onChanged={vi.fn()}
      />,
    );
    expect(screen.getByText('DebtSettlementCo')).toBeInTheDocument();
  });

  it('rescues an outlier (sets excludeFromProjection false) and refetches', async () => {
    const onChanged = vi.fn();
    render(
      <OneTimeExclusionsList
        outliers={[outlier]}
        currencyCode="USD"
        onChanged={onChanged}
      />,
    );
    fireEvent.click(screen.getByTestId('rescue-txn-1'));
    await waitFor(() =>
      expect(transactionsApi.update).toHaveBeenCalledWith('txn-1', {
        excludeFromProjection: false,
      }),
    );
    expect(onChanged).toHaveBeenCalled();
  });

  it('renders nothing when there are no outliers', () => {
    const { container } = render(
      <OneTimeExclusionsList outliers={[]} currencyCode="USD" onChanged={vi.fn()} />,
    );
    expect(container).toBeEmptyDOMElement();
  });
});
