import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, act, waitFor } from '@/test/render';
import { ReportAccountMultiSelect } from './ReportAccountMultiSelect';
import { Account } from '@/types/account';

const accounts = [
  { id: 'a1', name: 'TFSA - Brokerage', accountSubType: 'INVESTMENT_BROKERAGE' },
  { id: 'a2', name: 'TFSA - Cash', accountSubType: 'INVESTMENT_CASH' },
  { id: 'a3', name: 'RRSP', accountSubType: 'INVESTMENT_CASH' },
] as unknown as Account[];

describe('ReportAccountMultiSelect', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('shows the All Accounts placeholder, strips name suffixes, and excludes brokerage by default', () => {
    render(<ReportAccountMultiSelect accounts={accounts} value={[]} onChange={() => {}} />);
    const trigger = screen.getByRole('button', { name: 'Filter by account' });
    expect(trigger).toHaveTextContent('All Accounts');

    fireEvent.click(trigger);
    // Cash sub-accounts are offered with the suffix stripped; the brokerage
    // sub-account is excluded by the default filter.
    expect(screen.getByText('TFSA')).toBeInTheDocument();
    expect(screen.getByText('RRSP')).toBeInTheDocument();
    expect(screen.queryByText('TFSA - Brokerage')).not.toBeInTheDocument();
  });

  it('reflects a toggle immediately but debounces the onChange notification', async () => {
    vi.useFakeTimers();
    const onChange = vi.fn();
    render(<ReportAccountMultiSelect accounts={accounts} value={[]} onChange={onChange} />);
    fireEvent.click(screen.getByRole('button', { name: 'Filter by account' }));
    fireEvent.click(screen.getByText('RRSP'));

    // The trigger reflects the selection right away, but the host report is not
    // notified until the debounce window elapses.
    expect(screen.getByRole('button', { name: 'Filter by account' })).toHaveTextContent('RRSP');
    expect(onChange).not.toHaveBeenCalled();

    act(() => {
      vi.advanceTimersByTime(350);
    });
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenCalledWith(['a3']);
  });

  it('keeps the dropdown open across rapid toggles and collapses them into one onChange', () => {
    vi.useFakeTimers();
    const onChange = vi.fn();
    render(<ReportAccountMultiSelect accounts={accounts} value={[]} onChange={onChange} />);
    fireEvent.click(screen.getByRole('button', { name: 'Filter by account' }));

    fireEvent.click(screen.getByText('RRSP'));
    fireEvent.click(screen.getByText('TFSA'));

    // The portal dropdown is still mounted (options remain queryable) between
    // checkbox clicks, so the user can keep selecting without re-opening it.
    expect(screen.getByText('Select All')).toBeInTheDocument();
    expect(onChange).not.toHaveBeenCalled();

    act(() => {
      vi.advanceTimersByTime(350);
    });
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenCalledWith(['a3', 'a2']);
  });

  it('cancels a pending debounce when the parent pushes an external value change', () => {
    vi.useFakeTimers();
    const onChange = vi.fn();
    const { rerender } = render(
      <ReportAccountMultiSelect accounts={accounts} value={[]} onChange={onChange} />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Filter by account' }));
    fireEvent.click(screen.getByText('RRSP'));

    // Before the 350ms debounce elapses, the parent resets the selection
    // externally. The pending (now stale) onChange must NOT fire afterwards.
    rerender(<ReportAccountMultiSelect accounts={accounts} value={[]} onChange={onChange} />);
    act(() => {
      vi.advanceTimersByTime(350);
    });
    expect(onChange).not.toHaveBeenCalled();
  });

  it('adopts an external value reset', async () => {
    const { rerender } = render(
      <ReportAccountMultiSelect accounts={accounts} value={['a3']} onChange={() => {}} />,
    );
    expect(screen.getByRole('button', { name: 'Filter by account' })).toHaveTextContent('RRSP');

    rerender(<ReportAccountMultiSelect accounts={accounts} value={[]} onChange={() => {}} />);
    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Filter by account' })).toHaveTextContent(
        'All Accounts',
      );
    });
  });

  it('honours a custom filter that excludes cash sub-accounts', () => {
    render(
      <ReportAccountMultiSelect
        accounts={accounts}
        value={[]}
        onChange={() => {}}
        filter={(a) => a.accountSubType !== 'INVESTMENT_CASH'}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Filter by account' }));
    // Only the brokerage account remains (label suffix stripped).
    expect(screen.getByText('TFSA')).toBeInTheDocument();
    expect(screen.queryByText('RRSP')).not.toBeInTheDocument();
  });
});
