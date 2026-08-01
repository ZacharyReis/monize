import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, act } from '@/test/render';
import { useLoanRateEditing } from './useLoanRateEditing';
import { RateHistorySidebar } from './RateHistorySidebar';
import { Account } from '@/types/account';
import { LoanRateChange } from '@/types/loan-rate-change';
import { loanRateChangesApi } from '@/lib/loan-rate-changes';
import { exportToCsv } from '@/lib/csv-export';

vi.mock('@/lib/loan-rate-changes', () => ({
  loanRateChangesApi: {
    create: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
    applyScheduledPayment: vi.fn(),
    detect: vi.fn(),
  },
}));

vi.mock('@/lib/csv-export', () => ({
  exportToCsv: vi.fn(),
}));

const account = {
  id: 'loan-1',
  accountType: 'MORTGAGE',
  currencyCode: 'CAD',
} as Account;

const rateChanges: LoanRateChange[] = [
  {
    id: 'rc-1',
    accountId: 'loan-1',
    effectiveDate: '2022-05-13',
    annualRate: 1.75,
    newPaymentAmount: 3200,
    source: 'initial',
    note: null,
  } as LoanRateChange,
  {
    id: 'rc-2',
    accountId: 'loan-1',
    effectiveDate: '2022-08-05',
    annualRate: 3.25,
    newPaymentAmount: null,
    source: 'inferred',
    note: null,
  } as LoanRateChange,
];

function Harness({ rows, onChanged }: { rows: LoanRateChange[]; onChanged: () => void }) {
  const editing = useLoanRateEditing(account, onChanged);
  return <RateHistorySidebar account={account} rateChanges={rows} editing={editing} />;
}

describe('RateHistorySidebar', () => {
  beforeEach(() => vi.clearAllMocks());

  it('lists each recorded rate change with its rate, source badge, and payment', () => {
    render(<Harness rows={rateChanges} onChanged={() => {}} />);

    expect(screen.getByText('Rate History')).toBeInTheDocument();
    expect(screen.getByText('1.75%')).toBeInTheDocument();
    expect(screen.getByText('3.25%')).toBeInTheDocument();
    expect(screen.getByText('Initial')).toBeInTheDocument();
    expect(screen.getByText('Inferred')).toBeInTheDocument();
    // A row with no recorded payment shows "unchanged".
    expect(screen.getByText(/unchanged/)).toBeInTheDocument();
  });

  it('collapses and expands when the header bar is clicked', () => {
    render(<Harness rows={rateChanges} onChanged={() => {}} />);

    expect(screen.getByText('1.75%')).toBeInTheDocument();
    // The header (title) is the collapse toggle.
    fireEvent.click(screen.getByText('Rate History'));
    expect(screen.queryByText('1.75%')).not.toBeInTheDocument();
    fireEvent.click(screen.getByText('Rate History'));
    expect(screen.getByText('1.75%')).toBeInTheDocument();
  });

  it('keeps the Add and Detect actions available even with no rate changes', () => {
    render(<Harness rows={[]} onChanged={() => {}} />);
    expect(screen.getByText(/No rate changes recorded/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Add rate change' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Detect from history' })).toBeInTheDocument();
  });

  it('exports the rate timeline to CSV, sorted by effective date', async () => {
    // Pass the rows newest-first to prove the export re-sorts them.
    render(<Harness rows={[...rateChanges].reverse()} onChanged={() => {}} />);

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Download Rate History as CSV' }));
    });

    expect(exportToCsv).toHaveBeenCalledWith(
      'rate-history',
      ['Effective date', 'Rate (%)', 'Source', 'Payment', 'Note'],
      [
        ['2022-05-13', 1.75, 'Initial', 3200, ''],
        ['2022-08-05', 3.25, 'Inferred', '', ''],
      ],
    );
  });

  it('disables the CSV export when there are no rate changes', () => {
    render(<Harness rows={[]} onChanged={() => {}} />);
    expect(
      screen.getByRole('button', { name: 'Download Rate History as CSV' }),
    ).toBeDisabled();
  });

  it('detects rate changes from history after confirmation', async () => {
    (loanRateChangesApi.detect as ReturnType<typeof vi.fn>).mockResolvedValue({
      created: rateChanges,
      replacedCount: 2,
      warnings: [],
    });
    const onChanged = vi.fn();
    render(<Harness rows={rateChanges} onChanged={onChanged} />);

    fireEvent.click(screen.getByRole('button', { name: 'Detect from history' }));
    const buttons = screen.getAllByRole('button', { name: 'Detect from history' });
    fireEvent.click(buttons[buttons.length - 1]);

    await waitFor(() => expect(loanRateChangesApi.detect).toHaveBeenCalledWith('loan-1'));
    await waitFor(() => expect(onChanged).toHaveBeenCalled());
  });
});
