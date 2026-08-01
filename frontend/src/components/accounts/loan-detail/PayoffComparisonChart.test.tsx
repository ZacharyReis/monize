import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, waitFor, act } from '@/test/render';
import {
  PayoffComparisonChart,
  buildPayoffComparisonSeries,
} from './PayoffComparisonChart';
import { generateLoanSchedule } from '@/lib/loan-schedule';
import { LoanPaymentEvent } from '@/lib/loan-history';
import { captureSvgAsImage } from '@/lib/pdf-export-charts';

vi.mock('@/lib/pdf-export-charts', () => ({
  captureSvgAsImage: vi.fn(),
}));

vi.mock('recharts', () => ({
  ResponsiveContainer: ({ children }: { children: React.ReactNode }) => (
    <div data-testid="responsive-container">{children}</div>
  ),
  AreaChart: ({ children }: { children: React.ReactNode }) => (
    <div data-testid="area-chart">{children}</div>
  ),
  Area: ({ name }: { name?: string }) => <div data-testid="area">{name}</div>,
  XAxis: () => null,
  YAxis: () => null,
  CartesianGrid: () => null,
  Tooltip: () => null,
  Legend: () => null,
  ReferenceLine: ({ label }: { label?: { value?: string } }) => (
    <div data-testid="reference-line">{label?.value}</div>
  ),
}));

vi.mock('@/hooks/useNumberFormat', () => ({
  useNumberFormat: () => ({
    formatCurrencyCompact: (amount: number) => `$${amount.toFixed(0)}`,
    formatCurrencyAxis: (amount: number) => `$${amount}`,
  }),
}));

vi.mock('@/hooks/useChartDateFormat', () => ({
  useChartDateFormat: () => (date: string) => date.slice(0, 7),
}));

function makeHistory(): LoanPaymentEvent[] {
  return [
    {
      date: '2026-01-15',
      principal: 450,
      interest: 50,
      balance: 9550,
      cumulativePrincipal: 450,
      cumulativeInterest: 50,
      type: 'REGULAR' as const,
    },
    {
      date: '2026-02-15',
      principal: 450,
      interest: 50,
      balance: 9100,
      cumulativePrincipal: 900,
      cumulativeInterest: 100,
      type: 'REGULAR' as const,
    },
  ];
}

function makeProjection(extra?: number) {
  return generateLoanSchedule({
    startingBalance: 9100,
    annualRate: 6,
    paymentAmount: 500,
    frequency: 'MONTHLY',
    firstPaymentDate: new Date(2026, 2, 15),
    overpayments: extra ? { recurringExtra: { amount: extra } } : undefined,
  });
}

describe('buildPayoffComparisonSeries', () => {
  it('accumulates real overpayments onto their month for the tooltip flag', () => {
    const history: LoanPaymentEvent[] = [
      {
        date: '2022-07-05',
        principal: 300,
        interest: 40,
        balance: 190000,
        cumulativePrincipal: 300,
        cumulativeInterest: 40,
        type: 'REGULAR' as const,
      },
      {
        date: '2022-07-20',
        principal: 1650,
        interest: 0,
        balance: 188350,
        cumulativePrincipal: 1950,
        cumulativeInterest: 40,
        type: 'OVERPAYMENT' as const,
      },
    ];
    const { points } = buildPayoffComparisonSeries(history, null, null);
    const july = points.find((p) => p.monthKey === '2022-07');
    expect(july?.overpayment).toBe(1650);
  });

  it('merges history and projections into monthly points', () => {
    const baseline = makeProjection();
    const { points, projectionStartKey } = buildPayoffComparisonSeries(
      makeHistory(),
      baseline,
      null,
    );

    expect(points[0]).toMatchObject({ monthKey: '2026-01', historicalBalance: 9550 });
    expect(projectionStartKey).toBe('2026-03');
    const march = points.find((p) => p.monthKey === '2026-03');
    expect(march?.baselineBalance).toBeDefined();
    expect(march?.historicalBalance).toBeUndefined();
  });

  it('carries the actual balance forward across a payment-holiday gap', () => {
    // History has no payment in February; the continuous contractual curve
    // still creates that month. The gap month must carry January's balance so
    // the curve stays continuous and the tooltip shows a real value there --
    // but months after the last actual payment stay empty (a projection, not
    // a carried balance).
    const history: LoanPaymentEvent[] = [
      {
        date: '2026-01-15',
        principal: 450,
        interest: 50,
        balance: 9550,
        cumulativePrincipal: 450,
        cumulativeInterest: 50,
        type: 'REGULAR',
      },
      {
        date: '2026-03-15',
        principal: 450,
        interest: 50,
        balance: 9100,
        cumulativePrincipal: 900,
        cumulativeInterest: 100,
        type: 'REGULAR',
      },
    ];
    const original = generateLoanSchedule({
      startingBalance: 10000,
      annualRate: 6,
      paymentAmount: 500,
      frequency: 'MONTHLY',
      firstPaymentDate: new Date(2026, 0, 15),
    });

    const { points } = buildPayoffComparisonSeries(history, null, null, original);

    expect(points.find((p) => p.monthKey === '2026-02')?.historicalBalance).toBe(9550);
    expect(points.find((p) => p.monthKey === '2026-03')?.historicalBalance).toBe(9100);
    // A month past the last actual payment is a projection gap, not carried.
    expect(points.find((p) => p.monthKey === '2026-04')?.historicalBalance).toBeUndefined();
  });

  it('stitches projections onto the last historical point', () => {
    const baseline = makeProjection();
    const scenario = makeProjection(200);
    const { points } = buildPayoffComparisonSeries(makeHistory(), baseline, scenario);

    const lastHistorical = points.find((p) => p.monthKey === '2026-02');
    expect(lastHistorical?.baselineBalance).toBe(9100);
    expect(lastHistorical?.scenarioBalance).toBe(9100);
  });

  it('keeps the scenario series shorter than the baseline', () => {
    const baseline = makeProjection();
    const scenario = makeProjection(300);
    const { points } = buildPayoffComparisonSeries(makeHistory(), baseline, scenario);

    const baselineMonths = points.filter((p) => p.baselineBalance !== undefined).length;
    const scenarioMonths = points.filter((p) => p.scenarioBalance !== undefined).length;
    expect(scenarioMonths).toBeLessThan(baselineMonths);
  });

  it('uses the last balance when multiple payments land in one month', () => {
    const history: LoanPaymentEvent[] = [
      { date: '2026-01-05', principal: 100, interest: 10, balance: 900, cumulativePrincipal: 100, cumulativeInterest: 10, type: 'REGULAR' },
      { date: '2026-01-20', principal: 100, interest: 10, balance: 800, cumulativePrincipal: 200, cumulativeInterest: 20, type: 'REGULAR' },
    ];
    const { points } = buildPayoffComparisonSeries(history, null, null);
    expect(points).toHaveLength(1);
    expect(points[0].historicalBalance).toBe(800);
  });

  it('samples long series down to at most 61 points keeping the last', () => {
    const projection = generateLoanSchedule({
      startingBalance: 500000,
      annualRate: 5,
      paymentAmount: 3000,
      frequency: 'MONTHLY',
      firstPaymentDate: new Date(2026, 0, 15),
    });
    const { points } = buildPayoffComparisonSeries([], projection, null);

    expect(points.length).toBeLessThanOrEqual(61);
    const lastRow = projection.rows[projection.rows.length - 1];
    expect(points[points.length - 1].monthKey).toBe(lastRow.date.slice(0, 7));
  });

  it('keeps the history/projection transition after sampling a long series', () => {
    // ~90 months of history plus a long projection, so sampling kicks in and
    // could otherwise drop the "today" transition, leaving a visual gap.
    const history: LoanPaymentEvent[] = Array.from({ length: 90 }, (_, i) => {
      const year = 2019 + Math.floor(i / 12);
      const month = String((i % 12) + 1).padStart(2, '0');
      return {
        date: `${year}-${month}-15`,
        principal: 100,
        interest: 10,
        balance: 200000 - i * 100,
        cumulativePrincipal: (i + 1) * 100,
        cumulativeInterest: (i + 1) * 10,
        type: 'REGULAR' as const,
      };
    });
    const lastHistMonth = history[history.length - 1].date.slice(0, 7); // 2026-06
    const projection = generateLoanSchedule({
      startingBalance: 191000,
      annualRate: 5,
      paymentAmount: 1100,
      frequency: 'MONTHLY',
      firstPaymentDate: new Date(2026, 6, 15),
    });

    const { points, projectionStartKey } = buildPayoffComparisonSeries(history, projection, null);

    // The last historical month keeps its balance, and the first projected
    // month is present -- the transition is not dropped.
    const lastHist = points.find((p) => p.monthKey === lastHistMonth);
    expect(lastHist?.historicalBalance).toBeDefined();
    expect(points.some((p) => p.monthKey === projectionStartKey)).toBe(true);
  });

  it('adds the original contractual series from the fourth argument', () => {
    const original = makeProjection();
    const { points } = buildPayoffComparisonSeries(makeHistory(), null, null, original);
    expect(points.some((p) => p.originalBalance !== undefined)).toBe(true);
  });

  it('returns no projection start without projections', () => {
    const { projectionStartKey } = buildPayoffComparisonSeries(makeHistory(), null, null);
    expect(projectionStartKey).toBeNull();
  });
});

describe('PayoffComparisonChart', () => {
  it('renders historical and baseline series with a today marker', () => {
    render(
      <PayoffComparisonChart
        historyEvents={makeHistory()}
        baseline={makeProjection()}
        scenario={null}
      />,
    );

    expect(screen.getByText('Payoff Timeline')).toBeInTheDocument();
    expect(screen.getByText('Actual Balance')).toBeInTheDocument();
    expect(screen.getByText('Current Projection')).toBeInTheDocument();
    expect(screen.queryByText('With Simulated Overpayments')).not.toBeInTheDocument();
    expect(screen.getByTestId('reference-line')).toHaveTextContent('Today');
  });

  it('downloads the chart as a PNG from the export button', async () => {
    vi.mocked(captureSvgAsImage).mockResolvedValue({
      dataUrl: 'data:image/png;base64,abc',
      width: 800,
      height: 320,
    });
    render(
      <PayoffComparisonChart
        historyEvents={makeHistory()}
        baseline={makeProjection()}
        scenario={null}
      />,
    );

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Download Payoff Timeline as PNG' }));
    });

    await waitFor(() => expect(captureSvgAsImage).toHaveBeenCalledTimes(1));
  });

  it('renders the original contractual series when provided', () => {
    render(
      <PayoffComparisonChart
        historyEvents={makeHistory()}
        baseline={makeProjection()}
        scenario={null}
        original={makeProjection()}
      />,
    );

    expect(screen.getByText('Original Schedule')).toBeInTheDocument();
  });

  it('adds the scenario series and note when a simulation is active', () => {
    render(
      <PayoffComparisonChart
        historyEvents={makeHistory()}
        baseline={makeProjection()}
        scenario={makeProjection(200)}
      />,
    );

    expect(screen.getByText('With Simulated Overpayments')).toBeInTheDocument();
    expect(screen.getByText(/does not change your scheduled payments/)).toBeInTheDocument();
  });

  it('shows an empty state without any data', () => {
    render(<PayoffComparisonChart historyEvents={[]} baseline={null} scenario={null} />);
    expect(screen.getByText('No payment history or projection available.')).toBeInTheDocument();
  });
});
