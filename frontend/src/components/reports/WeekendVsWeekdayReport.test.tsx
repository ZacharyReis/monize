import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent, act, within } from '@/test/render';
import { WeekendVsWeekdayReport } from './WeekendVsWeekdayReport';

vi.mock('@/hooks/useNumberFormat', () => ({
  useNumberFormat: () => ({
    formatCurrencyCompact: (n: number) => `$${n.toFixed(2)}`,
    formatCurrency: (n: number) => `$${n.toFixed(2)}`,
    formatCurrencyAxis: (n: number) => `$${n}`,
    defaultCurrency: 'CAD',
  }),
}));

vi.mock('@/hooks/useDateRange', () => ({
  useDateRange: () => ({
    dateRange: '3m',
    setDateRange: vi.fn(),
    resolvedRange: { start: '2025-01-01', end: '2025-03-31' },
    isValid: true,
  }),
}));

vi.mock('@/components/ui/DateRangeSelector', () => ({
  DateRangeSelector: () => <div data-testid="date-range-selector" />,
}));

vi.mock('recharts', () => ({
  ResponsiveContainer: ({ children }: any) => <div data-testid="responsive-container">{children}</div>,
  BarChart: ({ children }: any) => <div data-testid="bar-chart">{children}</div>,
  Bar: () => null,
  Cell: () => null,
  XAxis: () => null,
  YAxis: () => null,
  CartesianGrid: () => null,
  // Render the custom tooltip content (when provided as a JSX element) with an
  // active payload so the CustomTooltip branch is exercised during render. The
  // bar-chart Tooltip uses a `formatter` prop instead of `content`, so that
  // variant renders nothing.
  Tooltip: ({ content }: any) => {
    if (content && content.type) {
      const C = content.type;
      const props = content.props || {};
      return (
        <div data-testid="tooltip">
          <C
            {...props}
            active={true}
            label="Mon"
            payload={[{ name: 'Total Spent', value: 300, color: '#3b82f6' }]}
          />
          <C {...props} active={false} payload={[]} />
        </div>
      );
    }
    return null;
  },
  Legend: () => null,
  PieChart: ({ children }: any) => <div data-testid="pie-chart">{children}</div>,
  Pie: () => null,
}));

const mockExportToPdf = vi.fn();
vi.mock('@/lib/pdf-export', () => ({
  exportToPdf: (...args: any[]) => mockExportToPdf(...args),
}));

vi.mock('@/components/ui/ExportDropdown', () => ({
  ExportDropdown: ({ onExportPdf }: any) => (
    <button data-testid="export-pdf" onClick={onExportPdf}>
      PDF
    </button>
  ),
}));

const mockGetWeekendVsWeekday = vi.fn();

vi.mock('@/lib/built-in-reports', () => ({
  builtInReportsApi: {
    getWeekendVsWeekday: (...args: any[]) => mockGetWeekendVsWeekday(...args),
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

describe('WeekendVsWeekdayReport', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('shows loading state initially', () => {
    mockGetWeekendVsWeekday.mockReturnValue(new Promise(() => {}));
    render(<WeekendVsWeekdayReport />);
    expect(document.querySelector('.animate-pulse')).toBeTruthy();
  });

  it('renders empty state when no spending', async () => {
    mockGetWeekendVsWeekday.mockResolvedValue({
      summary: { weekendTotal: 0, weekdayTotal: 0, weekendCount: 0, weekdayCount: 0 },
      byDay: [],
      byCategory: [],
    });
    render(<WeekendVsWeekdayReport />);
    await waitFor(() => {
      expect(screen.getByText('No expense transactions found for this period.')).toBeInTheDocument();
    });
  });

  it('renders summary cards with spending data', async () => {
    mockGetWeekendVsWeekday.mockResolvedValue({
      summary: { weekendTotal: 500, weekdayTotal: 1500, weekendCount: 10, weekdayCount: 30 },
      byDay: [
        { dayOfWeek: 0, total: 200, count: 5 },
        { dayOfWeek: 1, total: 300, count: 7 },
      ],
      byCategory: [],
    });
    render(<WeekendVsWeekdayReport />);
    await waitFor(() => {
      expect(screen.getByText('Weekend Spending')).toBeInTheDocument();
    });
    expect(screen.getByText('Weekday Spending')).toBeInTheDocument();
    expect(screen.getByText('10 transactions')).toBeInTheDocument();
    expect(screen.getByText('30 transactions')).toBeInTheDocument();
  });

  it('renders view toggle buttons', async () => {
    mockGetWeekendVsWeekday.mockResolvedValue({
      summary: { weekendTotal: 100, weekdayTotal: 200, weekendCount: 2, weekdayCount: 5 },
      byDay: [],
      byCategory: [],
    });
    render(<WeekendVsWeekdayReport />);
    await waitFor(() => {
      expect(screen.getByText('Overview')).toBeInTheDocument();
    });
    expect(screen.getByText('By Day')).toBeInTheDocument();
    expect(screen.getByText('By Category')).toBeInTheDocument();
  });

  it('switches to By Day view when button is clicked', async () => {
    mockGetWeekendVsWeekday.mockResolvedValue({
      summary: { weekendTotal: 500, weekdayTotal: 1500, weekendCount: 10, weekdayCount: 30 },
      byDay: [
        { dayOfWeek: 0, total: 200, count: 5 },
        { dayOfWeek: 1, total: 300, count: 7 },
        { dayOfWeek: 6, total: 300, count: 5 },
      ],
      byCategory: [],
    });
    render(<WeekendVsWeekdayReport />);
    await waitFor(() => {
      expect(screen.getByText('By Day')).toBeInTheDocument();
    });
    fireEvent.click(screen.getByText('By Day'));
    await waitFor(() => {
      expect(screen.getByText('Spending by Day of Week')).toBeInTheDocument();
    });
  });

  it('switches to By Category view when button is clicked', async () => {
    mockGetWeekendVsWeekday.mockResolvedValue({
      summary: { weekendTotal: 500, weekdayTotal: 1500, weekendCount: 10, weekdayCount: 30 },
      byDay: [],
      byCategory: [
        { categoryId: 'cat-1', categoryName: 'Food', weekendTotal: 200, weekdayTotal: 500 },
        { categoryId: 'cat-2', categoryName: 'Transport', weekendTotal: 100, weekdayTotal: 300 },
      ],
    });
    render(<WeekendVsWeekdayReport />);
    await waitFor(() => {
      expect(screen.getByText('By Category')).toBeInTheDocument();
    });
    fireEvent.click(screen.getByText('By Category'));
    await waitFor(() => {
      expect(screen.getByText('Category Comparison')).toBeInTheDocument();
    });
  });

  it('renders comparison view with pie chart and spending details', async () => {
    mockGetWeekendVsWeekday.mockResolvedValue({
      summary: { weekendTotal: 500, weekdayTotal: 1500, weekendCount: 10, weekdayCount: 30 },
      byDay: [],
      byCategory: [],
    });
    render(<WeekendVsWeekdayReport />);
    await waitFor(() => {
      expect(screen.getByText('Weekend vs Weekday Split')).toBeInTheDocument();
    });
    expect(screen.getByText(/Weekend \(Sat-Sun\)/)).toBeInTheDocument();
    expect(screen.getByText(/Weekday \(Mon-Fri\)/)).toBeInTheDocument();
    expect(screen.getByText(/more per transaction on weekdays/)).toBeInTheDocument();
  });

  it('shows weekend spending more message when weekend avg is higher', async () => {
    mockGetWeekendVsWeekday.mockResolvedValue({
      summary: { weekendTotal: 1000, weekdayTotal: 500, weekendCount: 5, weekdayCount: 25 },
      byDay: [],
      byCategory: [],
    });
    render(<WeekendVsWeekdayReport />);
    await waitFor(() => {
      expect(screen.getByText(/more per transaction on weekends/)).toBeInTheDocument();
    });
  });

  it('surfaces a retryable error state when the API fails', async () => {
    mockGetWeekendVsWeekday.mockRejectedValue(new Error('Network error'));
    render(<WeekendVsWeekdayReport />);
    await waitFor(() => {
      expect(screen.getByText(/failed to load report data/i)).toBeInTheDocument();
    });
    expect(screen.getByRole('button', { name: /try again/i })).toBeInTheDocument();
  });

  it('renders the custom tooltip content in the By Day view', async () => {
    mockGetWeekendVsWeekday.mockResolvedValue({
      summary: { weekendTotal: 500, weekdayTotal: 1500, weekendCount: 10, weekdayCount: 30 },
      byDay: [
        { dayOfWeek: 1, total: 300, count: 7 },
        { dayOfWeek: 6, total: 200, count: 5 },
      ],
      byCategory: [],
    });
    render(<WeekendVsWeekdayReport />);
    await waitFor(() => {
      expect(screen.getByText('By Day')).toBeInTheDocument();
    });
    fireEvent.click(screen.getByText('By Day'));
    await waitFor(() => {
      expect(screen.getByTestId('tooltip')).toBeInTheDocument();
    });
    // CustomTooltip renders the label and the formatted payload entry. The day
    // label "Mon" also appears in the grid below the chart, so scope the
    // assertion to the tooltip element itself.
    const tooltip = screen.getByTestId('tooltip');
    expect(within(tooltip).getByText('Mon')).toBeInTheDocument();
    expect(within(tooltip).getByText(/Total Spent: \$300\.00/)).toBeInTheDocument();
  });

  it('exports a PDF when the export button is clicked', async () => {
    mockGetWeekendVsWeekday.mockResolvedValue({
      summary: { weekendTotal: 1000, weekdayTotal: 500, weekendCount: 5, weekdayCount: 25 },
      byDay: [],
      byCategory: [],
    });
    render(<WeekendVsWeekdayReport />);
    await waitFor(() => {
      expect(screen.getByTestId('export-pdf')).toBeInTheDocument();
    });
    await act(async () => {
      fireEvent.click(screen.getByTestId('export-pdf'));
    });
    await waitFor(() => {
      expect(mockExportToPdf).toHaveBeenCalledTimes(1);
    });
    expect(mockExportToPdf).toHaveBeenCalledWith(
      expect.objectContaining({
        title: 'Weekend vs Weekday Spending',
        filename: 'weekend-vs-weekday',
        summaryCards: expect.any(Array),
        chartLegend: expect.any(Array),
      }),
    );
  });
});
