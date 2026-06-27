import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@/test/render';
import { AssetsVsLiabilities } from './AssetsVsLiabilities';
import { MonthlyNetWorth } from '@/types/net-worth';

const mockPush = vi.fn();
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: mockPush }),
}));

vi.mock('recharts', () => ({
  ResponsiveContainer: ({ children }: any) => <div data-testid="responsive-container">{children}</div>,
  PieChart: ({ children }: any) => <div data-testid="pie-chart">{children}</div>,
  Pie: ({ children }: any) => <div data-testid="pie">{children}</div>,
  Cell: () => <div data-testid="cell" />,
  Tooltip: () => null,
}));

vi.mock('@/hooks/useNumberFormat', () => ({
  useNumberFormat: () => ({
    formatCurrencyCompact: (n: number) => `$${n.toFixed(0)}`,
  }),
}));

const months: MonthlyNetWorth[] = [
  { month: '2026-04-01', assets: 90000, liabilities: 40000, netWorth: 50000 },
  { month: '2026-05-01', assets: 120000, liabilities: 30000, netWorth: 90000 },
];

describe('AssetsVsLiabilities', () => {
  beforeEach(() => {
    mockPush.mockClear();
  });

  it('renders loading skeleton with title', () => {
    render(<AssetsVsLiabilities data={[]} isLoading={true} />);
    expect(screen.getByText('Assets vs Liabilities')).toBeInTheDocument();
    expect(document.querySelector('.animate-pulse')).toBeInTheDocument();
  });

  it('renders empty state when there is no data', () => {
    render(<AssetsVsLiabilities data={[]} isLoading={false} />);
    expect(screen.getByText('No net worth data available yet.')).toBeInTheDocument();
  });

  it('uses the latest month for the assets/liabilities split and net worth', () => {
    render(<AssetsVsLiabilities data={months} isLoading={false} />);
    // Latest month (May): assets 120000, liabilities 30000, net 90000
    expect(screen.getByText('$120000')).toBeInTheDocument();
    expect(screen.getByText('$30000')).toBeInTheDocument();
    expect(screen.getByText('$90000')).toBeInTheDocument();
    expect(screen.getByText('Assets')).toBeInTheDocument();
    expect(screen.getByText('Liabilities')).toBeInTheDocument();
    // One Cell per non-zero slice.
    expect(screen.getAllByTestId('cell')).toHaveLength(2);
  });

  it('omits a zero-valued slice (no liabilities)', () => {
    render(
      <AssetsVsLiabilities
        data={[{ month: '2026-05-01', assets: 100000, liabilities: 0, netWorth: 100000 }]}
        isLoading={false}
      />,
    );
    expect(screen.getAllByTestId('cell')).toHaveLength(1);
    expect(screen.getByText('Assets')).toBeInTheDocument();
    expect(screen.queryByText('Liabilities')).not.toBeInTheDocument();
  });

  it('renders negative net worth in red', () => {
    render(
      <AssetsVsLiabilities
        data={[{ month: '2026-05-01', assets: 10000, liabilities: 25000, netWorth: -15000 }]}
        isLoading={false}
      />,
    );
    const netEl = screen.getByText('$-15000');
    expect(netEl.className).toContain('text-red');
  });

  it('navigates to the net worth report on title click', () => {
    render(<AssetsVsLiabilities data={months} isLoading={false} />);
    fireEvent.click(screen.getByText('Assets vs Liabilities'));
    expect(mockPush).toHaveBeenCalledWith('/reports/net-worth');
  });
});
