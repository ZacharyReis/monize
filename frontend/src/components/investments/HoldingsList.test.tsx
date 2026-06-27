import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@/test/render';
import { HoldingsList } from './HoldingsList';

vi.mock('@/hooks/useNumberFormat', () => ({
  useNumberFormat: () => ({
    formatCurrency: (n: number) => `$${n.toFixed(2)}`,
    formatCurrencyPrecise: (n: number) => {
      const abs = Math.abs(n);
      let digits = 2;
      if (n !== 0 && abs < 0.005) {
        digits = Math.min(6, Math.max(2, -Math.floor(Math.log10(abs)) + 2));
      }
      return `$${n.toFixed(digits)}`;
    },
    formatSignedPercent: (n: number, decimals = 2) =>
      `${n >= 0 ? '+' : ''}${n.toFixed(decimals)}%`,
    formatQuantity: (n: number) =>
      new Intl.NumberFormat('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 4 }).format(n),
    numberFormat: 'en-US',
  }),
}));

describe('HoldingsList', () => {
  it('renders loading state', () => {
    render(<HoldingsList holdings={[]} isLoading={true} />);
    expect(screen.getByText('Holdings')).toBeInTheDocument();
    expect(document.querySelector('.animate-pulse')).toBeInTheDocument();
  });

  it('renders empty state', () => {
    render(<HoldingsList holdings={[]} isLoading={false} />);
    expect(screen.getByText('No holdings in this portfolio.')).toBeInTheDocument();
  });

  it('renders holdings table with data', () => {
    const holdings = [
      {
        id: 'h1', symbol: 'AAPL', name: 'Apple Inc.', quantity: 10,
        averageCost: 150, currentPrice: 180, marketValue: 1800,
        gainLoss: 300, gainLossPercent: 20, currencyCode: 'CAD',
      },
    ] as any[];

    render(<HoldingsList holdings={holdings} isLoading={false} />);
    expect(screen.getByText('AAPL')).toBeInTheDocument();
    expect(screen.getByText('Apple Inc.')).toBeInTheDocument();
    expect(screen.getByText('$1800.00')).toBeInTheDocument();
  });

  it('renders table headers correctly', () => {
    const holdings = [
      { id: '1', symbol: 'X', name: 'X', quantity: 1, averageCost: 1, currentPrice: 1, marketValue: 1, gainLoss: 0, gainLossPercent: 0, currencyCode: 'CAD' },
    ] as any[];

    render(<HoldingsList holdings={holdings} isLoading={false} />);
    expect(screen.getByText('Symbol')).toBeInTheDocument();
    expect(screen.getByText('Shares')).toBeInTheDocument();
    expect(screen.getByText('Avg Cost')).toBeInTheDocument();
    expect(screen.getByText('Price')).toBeInTheDocument();
    expect(screen.getByText('Market Value')).toBeInTheDocument();
    expect(screen.getByText('Gain/Loss')).toBeInTheDocument();
  });

  it('renders dash for null values (averageCost, currentPrice, marketValue, gainLoss)', () => {
    const holdings = [
      { id: 'h1', symbol: 'XEQT', name: 'iShares', quantity: 10, averageCost: null, currentPrice: null, marketValue: null, gainLoss: null, gainLossPercent: null, currencyCode: 'CAD' },
    ] as any[];
    render(<HoldingsList holdings={holdings} isLoading={false} />);
    expect(screen.getAllByText('-').length).toBeGreaterThan(2);
  });

  it('shows positive gain/loss with green color class', () => {
    const holdings = [
      { id: 'h1', symbol: 'XEQT', name: 'iShares', quantity: 10, averageCost: 40, currentPrice: 50, marketValue: 500, gainLoss: 100, gainLossPercent: 25, currencyCode: 'CAD' },
    ] as any[];
    const { container } = render(<HoldingsList holdings={holdings} isLoading={false} />);
    expect(container.querySelector('.text-green-600')).toBeInTheDocument();
  });

  it('shows negative gain/loss with red color class', () => {
    const holdings = [
      { id: 'h1', symbol: 'XEQT', name: 'iShares', quantity: 10, averageCost: 50, currentPrice: 40, marketValue: 400, gainLoss: -100, gainLossPercent: -20, currencyCode: 'CAD' },
    ] as any[];
    const { container } = render(<HoldingsList holdings={holdings} isLoading={false} />);
    expect(container.querySelector('.text-red-600')).toBeInTheDocument();
  });

  it('shows null gain/loss (treated as 0) with green color', () => {
    const holdings = [
      { id: 'h1', symbol: 'XEQT', name: 'iShares', quantity: 10, averageCost: 40, currentPrice: 50, marketValue: 500, gainLoss: null, gainLossPercent: null, currencyCode: 'CAD' },
    ] as any[];
    const { container } = render(<HoldingsList holdings={holdings} isLoading={false} />);
    expect(container.querySelector('.text-green-600')).toBeInTheDocument();
  });

  it('shows negative percent without plus sign', () => {
    const holdings = [
      { id: 'h1', symbol: 'XEQT', name: 'iShares', quantity: 10, averageCost: 50, currentPrice: 40, marketValue: 400, gainLoss: -100, gainLossPercent: -20, currencyCode: 'CAD' },
    ] as any[];
    render(<HoldingsList holdings={holdings} isLoading={false} />);
    expect(screen.getByText('-20.00%')).toBeInTheDocument();
  });

  it('shows positive percent with plus sign', () => {
    const holdings = [
      { id: 'h1', symbol: 'XEQT', name: 'iShares', quantity: 10, averageCost: 40, currentPrice: 50, marketValue: 500, gainLoss: 100, gainLossPercent: 25, currencyCode: 'CAD' },
    ] as any[];
    render(<HoldingsList holdings={holdings} isLoading={false} />);
    expect(screen.getByText('+25.00%')).toBeInTheDocument();
  });

  it('renders the holding name and quantity for a row', () => {
    const holdings = [
      { id: 'h1', symbol: 'AAPL', name: 'Apple Inc.', quantity: 12.5, averageCost: 100, currentPrice: 120, marketValue: 1500, gainLoss: 250, gainLossPercent: 20, currencyCode: 'CAD' },
    ] as any[];
    render(<HoldingsList holdings={holdings} isLoading={false} />);
    // formatQuantity output for 12.5
    expect(screen.getByText('12.5')).toBeInTheDocument();
    // formatPrice output for averageCost and currentPrice
    expect(screen.getByText('$100.00')).toBeInTheDocument();
    expect(screen.getByText('$120.00')).toBeInTheDocument();
  });

  it('expands precision for a sub-penny price', () => {
    const holdings = [
      { id: 'h1', symbol: 'PENNY', name: 'Penny Stock', quantity: 1000, averageCost: 0.0012, currentPrice: 0.0034, marketValue: 3.4, gainLoss: 2.2, gainLossPercent: 183.33, currencyCode: 'GBP' },
    ] as any[];
    render(<HoldingsList holdings={holdings} isLoading={false} />);
    // formatCurrencyPrecise expands decimals for sub-penny values
    expect(screen.getByText('$0.00120')).toBeInTheDocument();
    expect(screen.getByText('$0.00340')).toBeInTheDocument();
  });

  it('renders multiple holdings rows', () => {
    const holdings = [
      { id: 'h1', symbol: 'AAA', name: 'Alpha', quantity: 1, averageCost: 10, currentPrice: 11, marketValue: 11, gainLoss: 1, gainLossPercent: 10, currencyCode: 'CAD' },
      { id: 'h2', symbol: 'BBB', name: 'Beta', quantity: 2, averageCost: 20, currentPrice: 18, marketValue: 36, gainLoss: -4, gainLossPercent: -10, currencyCode: 'CAD' },
    ] as any[];
    const { container } = render(<HoldingsList holdings={holdings} isLoading={false} />);
    expect(container.querySelectorAll('tbody tr')).toHaveLength(2);
    expect(screen.getByText('AAA')).toBeInTheDocument();
    expect(screen.getByText('BBB')).toBeInTheDocument();
  });

  it('renders the four skeleton placeholder rows while loading', () => {
    const { container } = render(<HoldingsList holdings={[]} isLoading={true} />);
    expect(container.querySelectorAll('.animate-pulse').length).toBeGreaterThanOrEqual(4);
  });
});
