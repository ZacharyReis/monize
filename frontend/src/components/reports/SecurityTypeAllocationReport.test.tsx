import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent, act } from '@/test/render';
import { SecurityTypeAllocationReport } from './SecurityTypeAllocationReport';

vi.mock('@/hooks/useNumberFormat', () => ({
  useNumberFormat: () => ({
    formatCurrencyCompact: (n: number) => `$${n.toFixed(0)}`,
    formatCurrency: (n: number) => `$${n.toFixed(2)}`,
  }),
}));

vi.mock('@/hooks/useExchangeRates', () => ({
  useExchangeRates: () => ({
    defaultCurrency: 'CAD',
    convertToDefault: (amount: number) => amount,
  }),
}));

vi.mock('recharts', () => ({
  ResponsiveContainer: ({ children }: any) => <div data-testid="responsive-container">{children}</div>,
  PieChart: ({ children }: any) => <div data-testid="pie-chart">{children}</div>,
  Pie: () => null,
  Cell: () => null,
  Tooltip: () => null,
  Legend: () => null,
}));

const mockGetPortfolioSummary = vi.fn();
const mockGetInvestmentAccounts = vi.fn();

vi.mock('@/lib/investments', () => ({
  investmentsApi: {
    getPortfolioSummary: (...args: any[]) => mockGetPortfolioSummary(...args),
    getInvestmentAccounts: (...args: any[]) => mockGetInvestmentAccounts(...args),
  },
}));

vi.mock('@/lib/logger', () => ({
  createLogger: () => ({
    error: vi.fn(),
    warn: vi.fn(),
    info: vi.fn(),
    debug: vi.fn(),
  }),
}));

const mockHoldings = [
  {
    id: 'h-1',
    accountId: 'acc-1',
    securityId: 's-1',
    symbol: 'AAPL',
    name: 'Apple Inc.',
    securityType: 'STOCK',
    currencyCode: 'USD',
    quantity: 10,
    averageCost: 150,
    costBasis: 1500,
    currentPrice: 180,
    marketValue: 1800,
    gainLoss: 300,
    gainLossPercent: 20,
  },
  {
    id: 'h-2',
    accountId: 'acc-1',
    securityId: 's-2',
    symbol: 'VTI',
    name: 'Vanguard Total Stock',
    securityType: 'ETF',
    currencyCode: 'USD',
    quantity: 20,
    averageCost: 200,
    costBasis: 4000,
    currentPrice: 220,
    marketValue: 4400,
    gainLoss: 400,
    gainLossPercent: 10,
  },
  {
    id: 'h-3',
    accountId: 'acc-1',
    securityId: 's-3',
    symbol: 'MSFT',
    name: 'Microsoft Corp.',
    securityType: 'STOCK',
    currencyCode: 'USD',
    quantity: 5,
    averageCost: 300,
    costBasis: 1500,
    currentPrice: 350,
    marketValue: 1750,
    gainLoss: 250,
    gainLossPercent: 16.67,
  },
];

const mockAccounts = [
  { id: 'acc-1', name: 'TFSA', accountSubType: 'INVESTMENT_BROKERAGE' },
  { id: 'acc-2', name: 'Cash Reserve', accountSubType: 'INVESTMENT_CASH' },
];

describe('SecurityTypeAllocationReport', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('shows loading state initially', () => {
    mockGetPortfolioSummary.mockReturnValue(new Promise(() => {}));
    mockGetInvestmentAccounts.mockReturnValue(new Promise(() => {}));
    render(<SecurityTypeAllocationReport />);
    expect(document.querySelector('.animate-pulse')).toBeTruthy();
  });

  it('renders empty state when no holdings', async () => {
    mockGetPortfolioSummary.mockResolvedValue({ holdings: [] });
    mockGetInvestmentAccounts.mockResolvedValue([]);
    render(<SecurityTypeAllocationReport />);
    await waitFor(() => {
      expect(screen.getByText(/No investment holdings found/)).toBeInTheDocument();
    });
  });

  it('renders summary cards with data', async () => {
    mockGetPortfolioSummary.mockResolvedValue({ holdings: mockHoldings });
    mockGetInvestmentAccounts.mockResolvedValue(mockAccounts);
    render(<SecurityTypeAllocationReport />);
    await waitFor(() => {
      expect(screen.getByText('Total Portfolio')).toBeInTheDocument();
    });
    expect(screen.getByText('Asset Types')).toBeInTheDocument();
    expect(screen.getByText('Total Holdings')).toBeInTheDocument();
    expect(screen.getByText('Largest Type')).toBeInTheDocument();
  });

  it('renders pie chart', async () => {
    mockGetPortfolioSummary.mockResolvedValue({ holdings: mockHoldings });
    mockGetInvestmentAccounts.mockResolvedValue([]);
    render(<SecurityTypeAllocationReport />);
    await waitFor(() => {
      expect(screen.getByText('Asset Type Allocation')).toBeInTheDocument();
    });
    expect(screen.getByTestId('pie-chart')).toBeInTheDocument();
  });

  it('renders data table with asset type rows', async () => {
    mockGetPortfolioSummary.mockResolvedValue({ holdings: mockHoldings });
    mockGetInvestmentAccounts.mockResolvedValue([]);
    render(<SecurityTypeAllocationReport />);
    await waitFor(() => {
      expect(screen.getByText('Stocks')).toBeInTheDocument();
    });
    expect(screen.getAllByText('ETFs').length).toBeGreaterThanOrEqual(1);
  });

  it('renders table footer with totals', async () => {
    mockGetPortfolioSummary.mockResolvedValue({ holdings: mockHoldings });
    mockGetInvestmentAccounts.mockResolvedValue([]);
    render(<SecurityTypeAllocationReport />);
    await waitFor(() => {
      expect(screen.getByText('Total')).toBeInTheDocument();
    });
    expect(screen.getByText('100%')).toBeInTheDocument();
  });

  it('expands asset type to show holdings when clicked', async () => {
    mockGetPortfolioSummary.mockResolvedValue({ holdings: mockHoldings });
    mockGetInvestmentAccounts.mockResolvedValue([]);
    render(<SecurityTypeAllocationReport />);
    await waitFor(() => {
      expect(screen.getByText('Stocks')).toBeInTheDocument();
    });

    // Click on Stocks row to expand
    fireEvent.click(screen.getByText('Stocks'));

    // Should show individual stock holdings
    await waitFor(() => {
      expect(screen.getByText(/AAPL - Apple Inc./)).toBeInTheDocument();
    });
    expect(screen.getByText(/MSFT - Microsoft Corp./)).toBeInTheDocument();
  });

  it('hides cash accounts from account filter dropdown', async () => {
    mockGetPortfolioSummary.mockResolvedValue({ holdings: mockHoldings });
    mockGetInvestmentAccounts.mockResolvedValue(mockAccounts);
    render(<SecurityTypeAllocationReport />);
    const trigger = await screen.findByRole('button', { name: 'Filter by account' });

    fireEvent.click(trigger);
    expect(screen.getByText('TFSA')).toBeInTheDocument();
    expect(screen.queryByText('Cash Reserve')).not.toBeInTheDocument();
  });

  it('reflects the selected account in the filter trigger', async () => {
    mockGetPortfolioSummary.mockResolvedValue({ holdings: mockHoldings });
    mockGetInvestmentAccounts.mockResolvedValue(mockAccounts);
    render(<SecurityTypeAllocationReport />);
    const trigger = await screen.findByRole('button', { name: 'Filter by account' });

    fireEvent.click(trigger);
    await act(async () => { fireEvent.click(screen.getByText('TFSA')); });

    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Filter by account' })).toHaveTextContent('TFSA');
    });
  });

  it('exercises every sortable column on the allocation table', async () => {
    mockGetPortfolioSummary.mockResolvedValue({
      holdings: [
        { securityId: 's1', symbol: 'AAA', name: 'Alpha', currencyCode: 'CAD', securityType: 'STOCK', marketValue: 5000, quantity: 50, accountId: 'a1' },
        { securityId: 's2', symbol: 'BBB', name: 'Bravo', currencyCode: 'CAD', securityType: 'ETF', marketValue: 3000, quantity: 30, accountId: 'a1' },
        { securityId: 's3', symbol: 'CCC', name: 'Charlie', currencyCode: 'CAD', securityType: 'BOND', marketValue: 2000, quantity: 20, accountId: 'a1' },
      ],
    });
    let container!: HTMLElement;
    await act(async () => {
      ({ container } = render(<SecurityTypeAllocationReport />));
    });
    await waitFor(() => expect(container.querySelector('table')).toBeInTheDocument());
    const __headerCount = container.querySelectorAll('table thead th').length;
    for (let __i = 0; __i < __headerCount; __i += 1) {
      const __ths = container.querySelectorAll('table thead th');
      if (!__ths[__i]) break;
      await act(async () => { fireEvent.click(__ths[__i]); });
    }
    for (let __i = 0; __i < __headerCount; __i += 1) {
      const __ths = container.querySelectorAll('table thead th');
      if (!__ths[__i]) break;
      await act(async () => { fireEvent.click(__ths[__i]); });
    }
  });
});
