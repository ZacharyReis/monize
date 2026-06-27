import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, act } from '@/test/render';
import toast from 'react-hot-toast';
import { SecurityShareAdjustmentForm } from './SecurityShareAdjustmentForm';
import { investmentsApi } from '@/lib/investments';

vi.mock('@/lib/investments', () => ({
  investmentsApi: {
    createTransaction: vi.fn().mockResolvedValue({}),
  },
}));

vi.mock('react-hot-toast', () => ({
  default: { success: vi.fn(), error: vi.fn() },
}));

vi.mock('@/lib/errors', () => ({
  getErrorMessage: (_e: unknown, fallback: string) => fallback,
}));

describe('SecurityShareAdjustmentForm', () => {
  const accounts = [
    { accountId: 'a1', accountName: 'Brokerage A', isClosed: false, currentQuantity: 0.0003 },
    { accountId: 'a2', accountName: 'Old Brokerage', isClosed: true, currentQuantity: 50 },
  ];

  const onSubmitted = vi.fn();
  const onCancel = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders account options including a closed account', () => {
    render(
      <SecurityShareAdjustmentForm
        securityId="sec-1"
        accounts={accounts}
        onSubmitted={onSubmitted}
        onCancel={onCancel}
      />,
    );
    expect(screen.getByText('Old Brokerage (closed)')).toBeInTheDocument();
  });

  it('blocks submission without a quantity', async () => {
    render(
      <SecurityShareAdjustmentForm
        securityId="sec-1"
        accounts={accounts}
        defaultAccountId="a1"
        onSubmitted={onSubmitted}
        onCancel={onCancel}
      />,
    );
    await act(async () => {
      fireEvent.click(screen.getByText('Record adjustment'));
    });
    await act(async () => {});
    expect(investmentsApi.createTransaction).not.toHaveBeenCalled();
    expect(toast.error).toHaveBeenCalled();
  });

  it('submits a REMOVE_SHARES adjustment with the chosen account and quantity', async () => {
    render(
      <SecurityShareAdjustmentForm
        securityId="sec-1"
        accounts={accounts}
        defaultAccountId="a2"
        onSubmitted={onSubmitted}
        onCancel={onCancel}
      />,
    );
    await act(async () => {
      fireEvent.change(screen.getByLabelText('Quantity (Shares)'), {
        target: { value: '50' },
      });
    });
    await act(async () => {
      fireEvent.click(screen.getByText('Record adjustment'));
    });
    await waitFor(() => {
      expect(investmentsApi.createTransaction).toHaveBeenCalled();
    });
    const payload = vi.mocked(investmentsApi.createTransaction).mock.calls[0][0];
    expect(payload).toMatchObject({
      accountId: 'a2',
      securityId: 'sec-1',
      action: 'REMOVE_SHARES',
      quantity: 50,
    });
    expect(onSubmitted).toHaveBeenCalled();
  });

  it('surfaces an error toast when the API rejects', async () => {
    vi.mocked(investmentsApi.createTransaction).mockRejectedValueOnce(new Error('nope'));
    render(
      <SecurityShareAdjustmentForm
        securityId="sec-1"
        accounts={accounts}
        defaultAccountId="a1"
        onSubmitted={onSubmitted}
        onCancel={onCancel}
      />,
    );
    await act(async () => {
      fireEvent.change(screen.getByLabelText('Quantity (Shares)'), {
        target: { value: '0.0003' },
      });
    });
    await act(async () => {
      fireEvent.click(screen.getByText('Record adjustment'));
    });
    await act(async () => {});
    await waitFor(() => {
      expect(toast.error).toHaveBeenCalled();
    });
    expect(onSubmitted).not.toHaveBeenCalled();
  });
});
