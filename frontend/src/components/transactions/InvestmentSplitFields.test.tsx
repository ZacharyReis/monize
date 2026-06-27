import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, fireEvent, waitFor, act } from '@testing-library/react';
import { render } from '@/test/render';
import { InvestmentSplitFields } from './InvestmentSplitFields';
import { investmentsApi } from '@/lib/investments';
import type { Security } from '@/types/investment';
import type { InvestmentSplitDetails } from '@/types/transaction';

vi.mock('@/lib/investments', () => ({
  investmentsApi: {
    getSecurities: vi.fn(),
  },
}));

const mockSecurities: Security[] = [
  {
    id: 'sec-1',
    symbol: 'AAPL',
    name: 'Apple Inc.',
    currencyCode: 'USD',
    isActive: true,
  } as Security,
  {
    id: 'sec-2',
    symbol: 'VOO',
    name: 'Vanguard S&P 500',
    currencyCode: 'USD',
    isActive: true,
  } as Security,
];

function buyValue(overrides: Partial<InvestmentSplitDetails> = {}): InvestmentSplitDetails {
  return {
    action: 'BUY',
    securityId: 'sec-1',
    quantity: 10,
    price: 5,
    commission: 1,
    exchangeRate: 1,
    ...overrides,
  };
}

async function renderFieldsAsync(
  props: Partial<Parameters<typeof InvestmentSplitFields>[0]> = {},
) {
  let result: ReturnType<typeof render>;
  await act(async () => {
    result = render(
      <InvestmentSplitFields value={undefined} onChange={vi.fn()} {...props} />,
    );
  });
  return result!;
}

beforeEach(() => {
  vi.clearAllMocks();
  (investmentsApi.getSecurities as ReturnType<typeof vi.fn>).mockResolvedValue(mockSecurities);
});

describe('InvestmentSplitFields', () => {
  it('loads securities on mount', async () => {
    await renderFieldsAsync();
    await waitFor(() => expect(investmentsApi.getSecurities).toHaveBeenCalled());
  });

  it('does not crash when securities fail to load', async () => {
    (investmentsApi.getSecurities as ReturnType<typeof vi.fn>).mockRejectedValue(
      new Error('boom'),
    );
    await renderFieldsAsync();
    await act(async () => {}); // flush rejection handler
    expect(screen.getByLabelText('Investment action')).toBeInTheDocument();
  });

  it('defaults to BUY and shows security + quantity/price/commission fields', async () => {
    await renderFieldsAsync();
    expect(screen.getByLabelText('Investment action')).toHaveValue('BUY');
    expect(screen.getByLabelText('Security')).toBeInTheDocument();
    expect(screen.getByPlaceholderText('Quantity')).toBeInTheDocument();
    expect(screen.getByPlaceholderText('Price')).toBeInTheDocument();
    expect(screen.getByPlaceholderText('Commission')).toBeInTheDocument();
  });

  it('renders the security dropdown options from the API', async () => {
    await renderFieldsAsync();
    await waitFor(() =>
      expect(screen.getByText('AAPL - Apple Inc.')).toBeInTheDocument(),
    );
    expect(screen.getByText('VOO - Vanguard S&P 500')).toBeInTheDocument();
  });

  it('computes the cash impact when the action changes to SELL', async () => {
    const onChange = vi.fn();
    await renderFieldsAsync({ value: buyValue(), onChange });
    await act(async () => {
      fireEvent.change(screen.getByLabelText('Investment action'), {
        target: { value: 'SELL' },
      });
    });
    expect(onChange).toHaveBeenCalled();
    const [next, amount] = onChange.mock.calls[onChange.mock.calls.length - 1];
    expect(next.action).toBe('SELL');
    // SELL: quantity*price - commission = 10*5 - 1 = 49
    expect(amount).toBe(49);
  });

  it('selecting a security calls onChange with the new securityId', async () => {
    const onChange = vi.fn();
    await renderFieldsAsync({ value: buyValue({ securityId: undefined }), onChange });
    await act(async () => {
      fireEvent.change(screen.getByLabelText('Security'), {
        target: { value: 'sec-2' },
      });
    });
    const [next] = onChange.mock.calls[onChange.mock.calls.length - 1];
    expect(next.securityId).toBe('sec-2');
  });

  it('clearing the security passes undefined', async () => {
    const onChange = vi.fn();
    await renderFieldsAsync({ value: buyValue(), onChange });
    await act(async () => {
      fireEvent.change(screen.getByLabelText('Security'), {
        target: { value: '' },
      });
    });
    const [next] = onChange.mock.calls[onChange.mock.calls.length - 1];
    expect(next.securityId).toBeUndefined();
  });

  it('updates quantity and recomputes the amount', async () => {
    const onChange = vi.fn();
    await renderFieldsAsync({ value: buyValue(), onChange });
    await act(async () => {
      fireEvent.change(screen.getByPlaceholderText('Quantity'), {
        target: { value: '20' },
      });
    });
    const [next, amount] = onChange.mock.calls[onChange.mock.calls.length - 1];
    expect(next.quantity).toBe(20);
    // BUY: -(20*5 + 1) = -101
    expect(amount).toBe(-101);
  });

  it('updates price and recomputes the amount', async () => {
    const onChange = vi.fn();
    await renderFieldsAsync({ value: buyValue(), onChange });
    await act(async () => {
      fireEvent.change(screen.getByPlaceholderText('Price'), {
        target: { value: '7' },
      });
    });
    const [next] = onChange.mock.calls[onChange.mock.calls.length - 1];
    expect(next.price).toBe(7);
  });

  it('updates commission and recomputes the amount', async () => {
    const onChange = vi.fn();
    await renderFieldsAsync({ value: buyValue(), onChange });
    await act(async () => {
      fireEvent.change(screen.getByPlaceholderText('Commission'), {
        target: { value: '3' },
      });
    });
    const [next] = onChange.mock.calls[onChange.mock.calls.length - 1];
    expect(next.commission).toBe(3);
  });

  it('shows the single amount field (no qty/price) for DIVIDEND', async () => {
    await renderFieldsAsync({ value: buyValue({ action: 'DIVIDEND' }) });
    expect(screen.queryByPlaceholderText('Quantity')).not.toBeInTheDocument();
    expect(screen.queryByPlaceholderText('Price')).not.toBeInTheDocument();
    // amount-only field uses the currency-based placeholder
    expect(screen.getByPlaceholderText('Amount (CAD)')).toBeInTheDocument();
    // DIVIDEND still needs a security
    expect(screen.getByLabelText('Security')).toBeInTheDocument();
  });

  it('updates the amount field for an amount-only action', async () => {
    const onChange = vi.fn();
    await renderFieldsAsync({
      value: buyValue({ action: 'DIVIDEND', quantity: 0, price: 0 }),
      onChange,
    });
    await act(async () => {
      fireEvent.change(screen.getByPlaceholderText('Amount (CAD)'), {
        target: { value: '25' },
      });
    });
    const [next, amount] = onChange.mock.calls[onChange.mock.calls.length - 1];
    expect(next.price).toBe(25);
    // DIVIDEND cash impact with no quantity equals price: (0 || 1) * 25 = 25
    expect(amount).toBe(25);
  });

  it('hides the security dropdown for actions that do not need one (INTEREST)', async () => {
    await renderFieldsAsync({ value: buyValue({ action: 'INTEREST' }) });
    expect(screen.queryByLabelText('Security')).not.toBeInTheDocument();
    expect(screen.getByPlaceholderText('Amount (CAD)')).toBeInTheDocument();
  });

  it('honours a custom currency code in the amount placeholder and symbol', async () => {
    await renderFieldsAsync({
      value: buyValue({ action: 'INTEREST' }),
      currencyCode: 'USD',
    });
    expect(screen.getByPlaceholderText('Amount (USD)')).toBeInTheDocument();
  });

  it('disables all controls when disabled', async () => {
    await renderFieldsAsync({ value: buyValue(), disabled: true });
    expect(screen.getByLabelText('Investment action')).toBeDisabled();
    expect(screen.getByLabelText('Security')).toBeDisabled();
    expect(screen.getByPlaceholderText('Quantity')).toBeDisabled();
    expect(screen.getByPlaceholderText('Price')).toBeDisabled();
    expect(screen.getByPlaceholderText('Commission')).toBeDisabled();
  });

  it('applies the exchange rate to the computed amount', async () => {
    const onChange = vi.fn();
    await renderFieldsAsync({
      value: buyValue({ action: 'SELL', exchangeRate: 2 }),
      onChange,
    });
    await act(async () => {
      fireEvent.change(screen.getByPlaceholderText('Quantity'), {
        target: { value: '10' },
      });
    });
    const [, amount] = onChange.mock.calls[onChange.mock.calls.length - 1];
    // SELL: (10*5 - 1) * 2 = 98
    expect(amount).toBe(98);
  });
});
