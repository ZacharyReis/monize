import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, act, within } from '@/test/render';
import { InvestmentTransactionList } from './InvestmentTransactionList';

vi.mock('@/hooks/useDateFormat', () => ({
  useDateFormat: () => ({ formatDate: (d: string) => d, dateFormat: 'browser' }),
}));

vi.mock('@/hooks/useNumberFormat', () => ({
  useNumberFormat: () => ({
    formatCurrency: (n: number) => `$${n.toFixed(2)}`,
    formatQuantity: (n: number) =>
      new Intl.NumberFormat('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 4 }).format(n),
    numberFormat: 'en-US',
  }),
}));

vi.mock('@/hooks/useExchangeRates', () => ({
  useExchangeRates: () => ({
    defaultCurrency: 'CAD',
  }),
}));

describe('InvestmentTransactionList', () => {
  const makeTx = (overrides: any = {}) => ({
    id: 't1', action: 'BUY', transactionDate: '2024-01-15',
    security: { symbol: 'AAPL', name: 'Apple Inc.', currencyCode: 'CAD' },
    quantity: 10, price: 150, totalAmount: 1500,
    ...overrides,
  });

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders loading state', () => {
    render(<InvestmentTransactionList transactions={[]} isLoading={true} />);
    expect(screen.getByText('Recent Transactions')).toBeInTheDocument();
    expect(document.querySelector('.animate-pulse')).toBeInTheDocument();
  });

  it('renders empty state', () => {
    render(<InvestmentTransactionList transactions={[]} isLoading={false} />);
    expect(screen.getByText('No investment transactions yet.')).toBeInTheDocument();
  });

  it('renders transactions table', () => {
    const transactions = [makeTx()] as any[];
    render(<InvestmentTransactionList transactions={transactions} isLoading={false} />);
    expect(screen.getByText('AAPL')).toBeInTheDocument();
    expect(screen.getByText('Buy')).toBeInTheDocument();
  });

  it('shows New Transaction button when callback provided', () => {
    const transactions = [makeTx()] as any[];
    render(<InvestmentTransactionList transactions={transactions} isLoading={false} onNewTransaction={vi.fn()} />);
    expect(screen.getByText('+ New Brokerage Transaction')).toBeInTheDocument();
  });

  it('shows New Transaction button in empty state when callback provided', () => {
    render(<InvestmentTransactionList transactions={[]} isLoading={false} onNewTransaction={vi.fn()} />);
    expect(screen.getByText('+ New Brokerage Transaction')).toBeInTheDocument();
  });

  it('calls onNewTransaction when button is clicked', () => {
    const onNewTransaction = vi.fn();
    const transactions = [makeTx()] as any[];
    render(<InvestmentTransactionList transactions={transactions} isLoading={false} onNewTransaction={onNewTransaction} />);
    fireEvent.click(screen.getByText('+ New Brokerage Transaction'));
    expect(onNewTransaction).toHaveBeenCalled();
  });

  it('renders table headers', () => {
    const transactions = [makeTx()] as any[];
    render(<InvestmentTransactionList transactions={transactions} isLoading={false} />);
    expect(screen.getByText('Date')).toBeInTheDocument();
    expect(screen.getByText('Action')).toBeInTheDocument();
    expect(screen.getByText('Symbol')).toBeInTheDocument();
    expect(screen.getByText('Total')).toBeInTheDocument();
  });

  it('shows Actions column when onDelete or onEdit provided', () => {
    const transactions = [makeTx()] as any[];
    render(<InvestmentTransactionList transactions={transactions} isLoading={false} onDelete={vi.fn()} />);
    expect(screen.getByText('Actions')).toBeInTheDocument();
  });

  it('does not show Actions column when no callbacks', () => {
    const transactions = [makeTx()] as any[];
    render(<InvestmentTransactionList transactions={transactions} isLoading={false} />);
    expect(screen.queryByText('Actions')).not.toBeInTheDocument();
  });

  it('shows Edit and Delete buttons for transactions', () => {
    const transactions = [makeTx()] as any[];
    render(
      <InvestmentTransactionList
        transactions={transactions}
        isLoading={false}
        onEdit={vi.fn()}
        onDelete={vi.fn()}
      />
    );
    expect(screen.getByText('Edit')).toBeInTheDocument();
    expect(screen.getByText('Delete')).toBeInTheDocument();
  });

  it('calls onEdit when Edit button is clicked', () => {
    const onEdit = vi.fn();
    const tx = makeTx();
    render(
      <InvestmentTransactionList
        transactions={[tx] as any[]}
        isLoading={false}
        onEdit={onEdit}
        onDelete={vi.fn()}
      />
    );
    fireEvent.click(screen.getByText('Edit'));
    expect(onEdit).toHaveBeenCalledWith(expect.objectContaining({ id: 't1' }));
  });

  it('shows delete confirmation dialog when Delete is clicked', () => {
    const onDelete = vi.fn();
    const tx = makeTx();
    render(
      <InvestmentTransactionList
        transactions={[tx] as any[]}
        isLoading={false}
        onDelete={onDelete}
      />
    );
    fireEvent.click(screen.getByText('Delete'));
    expect(screen.getByText('Delete Transaction')).toBeInTheDocument();
    expect(screen.getByText(/Are you sure you want to delete/)).toBeInTheDocument();
  });

  it('calls onDelete when confirming delete', () => {
    const onDelete = vi.fn();
    const tx = makeTx();
    render(
      <InvestmentTransactionList
        transactions={[tx] as any[]}
        isLoading={false}
        onDelete={onDelete}
      />
    );
    fireEvent.click(screen.getByText('Delete'));
    // Confirm in the dialog
    const confirmButtons = screen.getAllByText('Delete');
    fireEvent.click(confirmButtons[confirmButtons.length - 1]);
    expect(onDelete).toHaveBeenCalledWith('t1');
  });

  it('closes delete dialog on cancel', () => {
    const onDelete = vi.fn();
    const tx = makeTx();
    render(
      <InvestmentTransactionList
        transactions={[tx] as any[]}
        isLoading={false}
        onDelete={onDelete}
      />
    );
    fireEvent.click(screen.getByText('Delete'));
    fireEvent.click(screen.getByText('Cancel'));
    expect(onDelete).not.toHaveBeenCalled();
  });

  it('cycles density on button click', () => {
    const transactions = [makeTx()] as any[];
    render(<InvestmentTransactionList transactions={transactions} isLoading={false} />);
    expect(screen.getByText('Normal')).toBeInTheDocument();

    fireEvent.click(screen.getByText('Normal'));
    expect(screen.getByText('Compact')).toBeInTheDocument();

    fireEvent.click(screen.getByText('Compact'));
    expect(screen.getByText('Dense')).toBeInTheDocument();

    fireEvent.click(screen.getByText('Dense'));
    expect(screen.getByText('Normal')).toBeInTheDocument();
  });

  it('calls onDensityChange prop when cycling density', () => {
    const onDensityChange = vi.fn();
    const transactions = [makeTx()] as any[];
    render(
      <InvestmentTransactionList
        transactions={transactions}
        isLoading={false}
        density="normal"
        onDensityChange={onDensityChange}
      />
    );
    fireEvent.click(screen.getByText('Normal'));
    expect(onDensityChange).toHaveBeenCalledWith('compact');
  });

  it('shows filter button when onFiltersChange provided', () => {
    const transactions = [makeTx()] as any[];
    render(
      <InvestmentTransactionList
        transactions={transactions}
        isLoading={false}
        onFiltersChange={vi.fn()}
      />
    );
    expect(screen.getByText('Filter')).toBeInTheDocument();
  });

  it('toggles filter bar on filter button click', () => {
    const transactions = [makeTx()] as any[];
    render(
      <InvestmentTransactionList
        transactions={transactions}
        isLoading={false}
        onFiltersChange={vi.fn()}
        availableSymbols={['AAPL', 'MSFT']}
      />
    );
    fireEvent.click(screen.getByText('Filter'));
    expect(screen.getByText('Symbol', { selector: 'label' })).toBeInTheDocument();
    expect(screen.getByText('Action', { selector: 'label' })).toBeInTheDocument();
    expect(screen.getByText('From')).toBeInTheDocument();
    expect(screen.getByText('To')).toBeInTheDocument();
  });

  it('shows "(filtered)" and active filter count when filters are active', () => {
    const transactions = [makeTx()] as any[];
    render(
      <InvestmentTransactionList
        transactions={transactions}
        isLoading={false}
        onFiltersChange={vi.fn()}
        filters={{ symbol: 'AAPL' }}
      />
    );
    expect(screen.getByText('(filtered)')).toBeInTheDocument();
  });

  it('shows Clear Filters button when filters are active', () => {
    const onFiltersChange = vi.fn();
    const transactions = [makeTx()] as any[];
    render(
      <InvestmentTransactionList
        transactions={transactions}
        isLoading={false}
        onFiltersChange={onFiltersChange}
        filters={{ symbol: 'AAPL' }}
      />
    );
    // Open filter bar
    fireEvent.click(screen.getByText('Filter'));
    fireEvent.click(screen.getByText('Clear Filters'));
    expect(onFiltersChange).toHaveBeenCalledWith({});
  });

  it('renders different action labels correctly', () => {
    const transactions = [
      makeTx({ id: 't1', action: 'SELL' }),
      makeTx({ id: 't2', action: 'DIVIDEND' }),
      makeTx({ id: 't3', action: 'INTEREST', security: null }),
    ] as any[];
    render(<InvestmentTransactionList transactions={transactions} isLoading={false} />);
    expect(screen.getByText('Sell')).toBeInTheDocument();
    expect(screen.getByText('Dividend')).toBeInTheDocument();
    expect(screen.getByText('Interest')).toBeInTheDocument();
  });

  it('shows dash for missing security symbol', () => {
    const transactions = [makeTx({ security: null })] as any[];
    render(<InvestmentTransactionList transactions={transactions} isLoading={false} />);
    expect(screen.getAllByText('-').length).toBeGreaterThanOrEqual(1);
  });

  it('shows foreign currency indicator for non-default currencies', () => {
    const transactions = [makeTx({
      security: { symbol: 'AAPL', name: 'Apple', currencyCode: 'USD' },
    })] as any[];
    render(<InvestmentTransactionList transactions={transactions} isLoading={false} />);
    const usdLabels = screen.getAllByText('USD');
    expect(usdLabels.length).toBeGreaterThan(0);
  });

  describe('viewToggle prop', () => {
    it('renders viewToggle in loading state', () => {
      render(
        <InvestmentTransactionList
          transactions={[]}
          isLoading={true}
          viewToggle={<div data-testid="view-toggle">Toggle</div>}
        />
      );
      expect(screen.getByTestId('view-toggle')).toBeInTheDocument();
    });

    it('renders viewToggle in empty state', () => {
      render(
        <InvestmentTransactionList
          transactions={[]}
          isLoading={false}
          viewToggle={<div data-testid="view-toggle">Toggle</div>}
        />
      );
      expect(screen.getByTestId('view-toggle')).toBeInTheDocument();
    });

    it('renders viewToggle in main content state', () => {
      const transactions = [makeTx()] as any[];
      render(
        <InvestmentTransactionList
          transactions={transactions}
          isLoading={false}
          viewToggle={<div data-testid="view-toggle">Toggle</div>}
        />
      );
      expect(screen.getByTestId('view-toggle')).toBeInTheDocument();
    });

    it('does not render viewToggle when not provided', () => {
      const transactions = [makeTx()] as any[];
      render(<InvestmentTransactionList transactions={transactions} isLoading={false} />);
      expect(screen.queryByTestId('view-toggle')).not.toBeInTheDocument();
    });
  });

  it('calls onEdit on row click', () => {
    const onEdit = vi.fn();
    const tx = makeTx();
    render(
      <InvestmentTransactionList
        transactions={[tx] as any[]}
        isLoading={false}
        onEdit={onEdit}
      />
    );
    fireEvent.click(screen.getByText('AAPL'));
    expect(onEdit).toHaveBeenCalledWith(expect.objectContaining({ id: 't1' }));
  });

  describe('SPLIT rendering', () => {
    it('renders the split ratio as "N:1" instead of the raw quantity', () => {
      const tx = makeTx({ id: 's1', action: 'SPLIT', quantity: 2, price: 0, totalAmount: 0 });
      render(<InvestmentTransactionList transactions={[tx] as any[]} isLoading={false} />);
      expect(screen.getByText('2:1')).toBeInTheDocument();
    });

    it('renders a 1:2 reverse split as "1:2"', () => {
      const tx = makeTx({ id: 's2', action: 'SPLIT', quantity: 0.5, price: 0, totalAmount: 0 });
      render(<InvestmentTransactionList transactions={[tx] as any[]} isLoading={false} />);
      expect(screen.getByText('1:2')).toBeInTheDocument();
    });

    it('renders a 3-for-2 split as "3:2"', () => {
      const tx = makeTx({ id: 's3', action: 'SPLIT', quantity: 1.5, price: 0, totalAmount: 0 });
      render(<InvestmentTransactionList transactions={[tx] as any[]} isLoading={false} />);
      expect(screen.getByText('3:2')).toBeInTheDocument();
    });

    it('shows "-" in the price column when no post-split price was set', () => {
      const tx = makeTx({
        id: 's4',
        action: 'SPLIT',
        quantity: 2,
        price: null,
        totalAmount: 0,
      });
      render(<InvestmentTransactionList transactions={[tx] as any[]} isLoading={false} />);
      // The Shares column shows the ratio; the Price column shows "-".
      const row = screen.getByText('2:1').closest('tr')!;
      expect(row).toHaveTextContent('-');
    });

    it('renders "-" when the stored quantity is null (no ratio set)', () => {
      const tx = makeTx({
        id: 's-null',
        action: 'SPLIT',
        quantity: null,
        price: null,
        totalAmount: 0,
      });
      render(<InvestmentTransactionList transactions={[tx] as any[]} isLoading={false} />);
      // Shares column should not render an inferred ratio.
      expect(screen.queryByText(/^\d+:\d+$/)).not.toBeInTheDocument();
    });

    it('renders "-" for suspicious imported quantities (e.g. 5 from older buggy QIF)', () => {
      const tx = makeTx({
        id: 's-bad',
        action: 'SPLIT',
        quantity: 5, // Residue from older buggy import; not a user-authored ratio.
        price: null,
        totalAmount: 0,
      });
      render(<InvestmentTransactionList transactions={[tx] as any[]} isLoading={false} />);
      expect(screen.queryByText('5:1')).not.toBeInTheDocument();
    });

    it('still renders forward splits up to 4:1 since they are common user-set ratios', () => {
      const tx = makeTx({ id: 's-3', action: 'SPLIT', quantity: 3, price: 0, totalAmount: 0 });
      render(<InvestmentTransactionList transactions={[tx] as any[]} isLoading={false} />);
      expect(screen.getByText('3:1')).toBeInTheDocument();
    });

    it('renders a 4:1 split ratio', () => {
      const tx = makeTx({ id: 's-4', action: 'SPLIT', quantity: 4, price: 0, totalAmount: 0 });
      render(<InvestmentTransactionList transactions={[tx] as any[]} isLoading={false} />);
      expect(screen.getByText('4:1')).toBeInTheDocument();
    });

    it('renders a non-integer decimal split ratio using probe denominators (e.g. 1.25 -> 5:4)', () => {
      // 1.25 = 5/4; denom=4 should be found first
      const tx = makeTx({ id: 's-dec', action: 'SPLIT', quantity: 1.25, price: 0, totalAmount: 0 });
      render(<InvestmentTransactionList transactions={[tx] as any[]} isLoading={false} />);
      expect(screen.getByText('5:4')).toBeInTheDocument();
    });

    it('renders a large ratio (>=1) that does not factor evenly against probed denominators using the fallback N:1 form', () => {
      // 7 is not in {2,3,4} so isPlausibleSplitRatio returns false -> "-"
      // But a non-integer >= 1 with no clean factor should fall to `trim(ratio):1`
      // ratio=1.333... (non-integer >= 1 not matching probed denoms under 1e-6):
      const tx = makeTx({ id: 's-large', action: 'SPLIT', quantity: 1.333, price: null, totalAmount: 0 });
      render(<InvestmentTransactionList transactions={[tx] as any[]} isLoading={false} />);
      // Should render some ratio string (not "-") since 1.333 is non-integer
      const ratioEl = screen.queryByText(/\d+:\d+/);
      expect(ratioEl).toBeInTheDocument();
    });

    it('renders a ratio < 1 that does not factor using the 1:N fallback form', () => {
      // 0.1 = 1/10; denom=10 should be probed
      const tx = makeTx({ id: 's-tenth', action: 'SPLIT', quantity: 0.1, price: null, totalAmount: 0 });
      render(<InvestmentTransactionList transactions={[tx] as any[]} isLoading={false} />);
      expect(screen.getByText('1:10')).toBeInTheDocument();
    });

    it('shows the price when SPLIT transaction has a non-null price', () => {
      const tx = makeTx({ id: 's-price', action: 'SPLIT', quantity: 2, price: 50, totalAmount: 0 });
      render(<InvestmentTransactionList transactions={[tx] as any[]} isLoading={false} />);
      // Price column should show the formatted price, not "-"
      expect(screen.getByText('2:1')).toBeInTheDocument();
      // $50.00 comes from the mock formatCurrency
      expect(screen.getByText('$50.00')).toBeInTheDocument();
    });
  });

  describe('all action types render', () => {
    const actionCases = [
      'CAPITAL_GAIN',
      'REINVEST',
      'TRANSFER_IN',
      'TRANSFER_OUT',
      'ADD_SHARES',
      'REMOVE_SHARES',
    ] as const;

    it.each(actionCases)('renders %s action label', (action) => {
      const tx = makeTx({ id: `tx-${action}`, action });
      render(<InvestmentTransactionList transactions={[tx] as any[]} isLoading={false} />);
      // Just ensure the component renders without crashing; action is in the table
      expect(screen.getByRole('table')).toBeInTheDocument();
    });

    it('renders an unknown action with a fallback gray color class', () => {
      const tx = makeTx({ id: 'tx-unknown', action: 'MYSTERY_ACTION' });
      render(<InvestmentTransactionList transactions={[tx] as any[]} isLoading={false} />);
      // The label should show the raw action string when not in ACTION_LABELS
      expect(screen.getByText('MYSTERY_ACTION')).toBeInTheDocument();
    });
  });

  describe('density display in rows', () => {
    it('shows short action labels in dense mode', () => {
      const tx = makeTx({ id: 'tx-dense', action: 'BUY' });
      render(
        <InvestmentTransactionList
          transactions={[tx] as any[]}
          isLoading={false}
          density="dense"
        />
      );
      // In dense mode "Buy" stays "Buy" (shortLabel equals label for BUY)
      expect(screen.getByText('Buy')).toBeInTheDocument();
    });

    it('shows short label for DIVIDEND in dense mode', () => {
      const tx = makeTx({ id: 'tx-dense-div', action: 'DIVIDEND' });
      render(
        <InvestmentTransactionList
          transactions={[tx] as any[]}
          isLoading={false}
          density="dense"
        />
      );
      // shortLabel for DIVIDEND is 'Div'
      expect(screen.getByText('Div')).toBeInTheDocument();
    });

    it('hides the security name in compact/dense mode', () => {
      const tx = makeTx({ id: 'tx-compact', action: 'BUY' });
      render(
        <InvestmentTransactionList
          transactions={[tx] as any[]}
          isLoading={false}
          density="compact"
        />
      );
      // In compact mode, the <div> with security name is not rendered
      expect(screen.queryByText('Apple Inc.')).not.toBeInTheDocument();
    });

    it('shows the security name in normal mode', () => {
      const tx = makeTx({ id: 'tx-normal', action: 'BUY' });
      render(
        <InvestmentTransactionList
          transactions={[tx] as any[]}
          isLoading={false}
          density="normal"
        />
      );
      expect(screen.getByText('Apple Inc.')).toBeInTheDocument();
    });

    it('shows icon-only edit and delete buttons in dense mode', () => {
      const tx = makeTx({ id: 'tx-edit-dense', action: 'BUY' });
      render(
        <InvestmentTransactionList
          transactions={[tx] as any[]}
          isLoading={false}
          density="dense"
          onEdit={vi.fn()}
          onDelete={vi.fn()}
        />
      );
      // In dense mode the actions are icon-only buttons exposed via their labels.
      expect(screen.getByRole('button', { name: 'Edit' })).toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Delete' })).toBeInTheDocument();
    });

    it('applies striped background class for odd rows in non-normal density', () => {
      const transactions = [
        makeTx({ id: 't1', action: 'BUY' }),
        makeTx({ id: 't2', action: 'SELL' }),
      ] as any[];
      render(
        <InvestmentTransactionList
          transactions={transactions}
          isLoading={false}
          density="compact"
        />
      );
      // At index=1 (second row) with compact density, the stripe class is applied
      const rows = document.querySelectorAll('tbody tr');
      expect(rows).toHaveLength(2);
      expect(rows[1].className).toContain('bg-gray-50');
    });
  });

  describe('account name rendering', () => {
    it('shows account name when accounts prop is provided', () => {
      const tx = makeTx({ id: 'tx-acct', accountId: 'acct-1' });
      const accounts = [{ id: 'acct-1', name: 'Brokerage Account' }] as any[];
      render(
        <InvestmentTransactionList
          transactions={[tx] as any[]}
          isLoading={false}
          accounts={accounts}
        />
      );
      expect(screen.getByText('Brokerage Account')).toBeInTheDocument();
    });

    it('shows nothing in account cell when account ID not found in accounts list', () => {
      const tx = makeTx({ id: 'tx-no-acct', accountId: 'unknown-id' });
      const accounts = [{ id: 'acct-1', name: 'Something Else' }] as any[];
      render(
        <InvestmentTransactionList
          transactions={[tx] as any[]}
          isLoading={false}
          accounts={accounts}
        />
      );
      // 'Something Else' account should not appear since accountId doesn't match
      expect(screen.queryByText('Something Else')).not.toBeInTheDocument();
    });
  });

  describe('filter interactions', () => {
    it('calls onFiltersChange when symbol filter changes', () => {
      const onFiltersChange = vi.fn();
      const transactions = [makeTx()] as any[];
      render(
        <InvestmentTransactionList
          transactions={transactions}
          isLoading={false}
          onFiltersChange={onFiltersChange}
          availableSymbols={['AAPL', 'MSFT']}
        />
      );
      fireEvent.click(screen.getByText('Filter'));
      // The symbol select is the first combobox in the filter bar
      const selects = screen.getAllByRole('combobox');
      fireEvent.change(selects[0], { target: { value: 'AAPL' } });
      expect(onFiltersChange).toHaveBeenCalledWith(expect.objectContaining({ symbol: 'AAPL' }));
    });

    it('calls onFiltersChange when action filter changes', () => {
      const onFiltersChange = vi.fn();
      const transactions = [makeTx()] as any[];
      render(
        <InvestmentTransactionList
          transactions={transactions}
          isLoading={false}
          onFiltersChange={onFiltersChange}
        />
      );
      fireEvent.click(screen.getByText('Filter'));
      // The action select is the second combobox in the filter bar
      const selects = screen.getAllByRole('combobox');
      fireEvent.change(selects[1], { target: { value: 'SELL' } });
      expect(onFiltersChange).toHaveBeenCalledWith(expect.objectContaining({ action: 'SELL' }));
    });

    it('clears filter value when empty string is selected', () => {
      const onFiltersChange = vi.fn();
      const transactions = [makeTx()] as any[];
      render(
        <InvestmentTransactionList
          transactions={transactions}
          isLoading={false}
          onFiltersChange={onFiltersChange}
          filters={{ action: 'BUY' }}
        />
      );
      fireEvent.click(screen.getByText('Filter'));
      // The action select is the second combobox
      const selects = screen.getAllByRole('combobox');
      fireEvent.change(selects[1], { target: { value: '' } });
      // Empty string should produce undefined for that key
      expect(onFiltersChange).toHaveBeenCalledWith(
        expect.objectContaining({ action: undefined })
      );
    });

    it('shows active filter count badge for multiple active filters', () => {
      const transactions = [makeTx()] as any[];
      render(
        <InvestmentTransactionList
          transactions={transactions}
          isLoading={false}
          onFiltersChange={vi.fn()}
          filters={{ symbol: 'AAPL', action: 'BUY' }}
        />
      );
      // Two active filters should show badge with "2"
      expect(screen.getByText('2')).toBeInTheDocument();
    });

    it('shows empty state message when filters active but no transactions match', () => {
      render(
        <InvestmentTransactionList
          transactions={[]}
          isLoading={false}
          onFiltersChange={vi.fn()}
          filters={{ symbol: 'AAPL' }}
        />
      );
      expect(screen.getByText('No transactions match your filters.')).toBeInTheDocument();
    });

    it('does not show Filter button when onFiltersChange is not provided', () => {
      const transactions = [makeTx()] as any[];
      render(<InvestmentTransactionList transactions={transactions} isLoading={false} />);
      expect(screen.queryByText('Filter')).not.toBeInTheDocument();
    });
  });

  describe('row click and long-press interactions', () => {
    it('does not call onEdit when row click follows a long-press trigger', async () => {
      const onEdit = vi.fn();
      const tx = makeTx();
      render(
        <InvestmentTransactionList
          transactions={[tx] as any[]}
          isLoading={false}
          onEdit={onEdit}
          onDelete={vi.fn()}
        />
      );
      const row = screen.getByText('AAPL').closest('tr')!;

      // Simulate a long press that fires: mousedown -> (timer) -> click
      fireEvent.mouseDown(row);
      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 800));
      });
      fireEvent.click(row);

      // onEdit should not be called because longPressTriggered was true
      expect(onEdit).not.toHaveBeenCalled();
    });

    it('does not open delete dialog on long-press when onDelete is not provided', async () => {
      const tx = makeTx();
      render(
        <InvestmentTransactionList
          transactions={[tx] as any[]}
          isLoading={false}
          onEdit={vi.fn()}
        />
      );
      const row = screen.getByText('AAPL').closest('tr')!;
      fireEvent.mouseDown(row);
      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 800));
      });
      // Delete dialog should not appear since onDelete is absent
      expect(screen.queryByText('Delete Transaction')).not.toBeInTheDocument();
    });

    it('clears long-press timer on mouseup', async () => {
      const onEdit = vi.fn();
      const tx = makeTx();
      render(
        <InvestmentTransactionList
          transactions={[tx] as any[]}
          isLoading={false}
          onEdit={onEdit}
          onDelete={vi.fn()}
        />
      );
      const row = screen.getByText('AAPL').closest('tr')!;
      fireEvent.mouseDown(row);
      fireEvent.mouseUp(row);
      // After mouseUp, timer is cleared; clicking should still trigger edit
      fireEvent.click(row);
      expect(onEdit).toHaveBeenCalledWith(expect.objectContaining({ id: 't1' }));
    });

    it('clears long-press timer on mouseleave', () => {
      const tx = makeTx();
      render(
        <InvestmentTransactionList
          transactions={[tx] as any[]}
          isLoading={false}
          onDelete={vi.fn()}
        />
      );
      const row = screen.getByText('AAPL').closest('tr')!;
      fireEvent.mouseDown(row);
      fireEvent.mouseLeave(row);
      // Should not throw and timer should be cleared
    });

    it('opens the action sheet on long press and the delete dialog from it', async () => {
      const onDelete = vi.fn();
      const tx = makeTx();
      render(
        <InvestmentTransactionList
          transactions={[tx] as any[]}
          isLoading={false}
          onDelete={onDelete}
        />
      );
      const row = screen.getByText('AAPL').closest('tr')!;

      fireEvent.touchStart(row, {
        touches: [{ clientX: 100, clientY: 100 }],
      });
      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 800));
      });

      // The long-press opens the shared action sheet; its Delete opens the dialog.
      fireEvent.click(within(screen.getByRole('dialog')).getByText('Delete'));
      expect(screen.getByText('Delete Transaction')).toBeInTheDocument();
    });

    it('cancels long-press when touch moves beyond threshold', async () => {
      const tx = makeTx();
      render(
        <InvestmentTransactionList
          transactions={[tx] as any[]}
          isLoading={false}
          onDelete={vi.fn()}
        />
      );
      const row = screen.getByText('AAPL').closest('tr')!;

      fireEvent.touchStart(row, {
        touches: [{ clientX: 100, clientY: 100 }],
      });
      fireEvent.touchMove(row, {
        touches: [{ clientX: 120, clientY: 100 }], // moved 20px > threshold of 10
      });
      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 800));
      });

      // Delete dialog should NOT appear since move cancelled the timer
      expect(screen.queryByText('Delete Transaction')).not.toBeInTheDocument();
    });

    it('does not cancel long-press when touch move is within threshold', async () => {
      const tx = makeTx();
      render(
        <InvestmentTransactionList
          transactions={[tx] as any[]}
          isLoading={false}
          onDelete={vi.fn()}
        />
      );
      const row = screen.getByText('AAPL').closest('tr')!;

      fireEvent.touchStart(row, {
        touches: [{ clientX: 100, clientY: 100 }],
      });
      fireEvent.touchMove(row, {
        touches: [{ clientX: 105, clientY: 102 }], // moved 5px < threshold
      });
      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 800));
      });

      // The action sheet opened (long-press was not cancelled); its Delete opens the dialog.
      fireEvent.click(within(screen.getByRole('dialog')).getByText('Delete'));
      expect(screen.getByText('Delete Transaction')).toBeInTheDocument();
    });

    it('clears long-press on touchend', () => {
      const tx = makeTx();
      render(
        <InvestmentTransactionList
          transactions={[tx] as any[]}
          isLoading={false}
          onDelete={vi.fn()}
        />
      );
      const row = screen.getByText('AAPL').closest('tr')!;
      fireEvent.touchStart(row, { touches: [{ clientX: 10, clientY: 10 }] });
      fireEvent.touchEnd(row);
      // Should not throw
    });

    it('clears long-press on touchcancel', () => {
      const tx = makeTx();
      render(
        <InvestmentTransactionList
          transactions={[tx] as any[]}
          isLoading={false}
          onDelete={vi.fn()}
        />
      );
      const row = screen.getByText('AAPL').closest('tr')!;
      fireEvent.touchStart(row, { touches: [{ clientX: 10, clientY: 10 }] });
      fireEvent.touchCancel(row);
    });

    it('handleRowClick does nothing when onEdit is not provided', () => {
      const tx = makeTx();
      render(
        <InvestmentTransactionList
          transactions={[tx] as any[]}
          isLoading={false}
        />
      );
      const row = screen.getByText('AAPL').closest('tr')!;
      // Should not throw
      fireEvent.click(row);
    });
  });

  describe('delete confirmation message', () => {
    it('includes security symbol in confirm message when security is present', () => {
      const tx = makeTx({ action: 'BUY' });
      render(
        <InvestmentTransactionList
          transactions={[tx] as any[]}
          isLoading={false}
          onDelete={vi.fn()}
        />
      );
      fireEvent.click(screen.getByText('Delete'));
      expect(screen.getByText(/for AAPL/)).toBeInTheDocument();
    });

    it('omits security symbol in confirm message when security is null', () => {
      const tx = makeTx({ security: null });
      render(
        <InvestmentTransactionList
          transactions={[tx] as any[]}
          isLoading={false}
          onDelete={vi.fn()}
        />
      );
      fireEvent.click(screen.getByText('Delete'));
      expect(screen.getByText(/Are you sure you want to delete this Buy transaction\?/)).toBeInTheDocument();
    });

    it('uses raw action string when action is not in ACTION_LABELS', () => {
      const tx = makeTx({ action: 'MYSTERY_ACTION', security: null });
      render(
        <InvestmentTransactionList
          transactions={[tx] as any[]}
          isLoading={false}
          onDelete={vi.fn()}
        />
      );
      fireEvent.click(screen.getByText('Delete'));
      expect(screen.getByText(/MYSTERY_ACTION transaction/)).toBeInTheDocument();
    });

    it('calls onDelete even when onDelete prop is provided but deleteConfirm.transaction is set', () => {
      const onDelete = vi.fn();
      const tx = makeTx({ id: 'del-1' });
      render(
        <InvestmentTransactionList
          transactions={[tx] as any[]}
          isLoading={false}
          onDelete={onDelete}
        />
      );
      fireEvent.click(screen.getByText('Delete'));
      const buttons = screen.getAllByText('Delete');
      fireEvent.click(buttons[buttons.length - 1]);
      expect(onDelete).toHaveBeenCalledWith('del-1');
    });
  });

  describe('currency indicator in rows', () => {
    it('does not show currency indicator when security currency matches default', () => {
      const tx = makeTx({
        security: { symbol: 'TSX', name: 'Toronto Stock', currencyCode: 'CAD' },
      });
      render(<InvestmentTransactionList transactions={[tx] as any[]} isLoading={false} />);
      // CAD == defaultCurrency (CAD), so no currency badge should appear
      expect(screen.queryByText('CAD')).not.toBeInTheDocument();
    });

    it('shows currency indicator for foreign currency in both price and total columns', () => {
      const tx = makeTx({
        security: { symbol: 'AAPL', name: 'Apple', currencyCode: 'USD' },
        price: 150,
        totalAmount: 1500,
      });
      render(<InvestmentTransactionList transactions={[tx] as any[]} isLoading={false} />);
      const usdLabels = screen.getAllByText('USD');
      // Should appear in both price and total columns
      expect(usdLabels.length).toBeGreaterThanOrEqual(2);
    });
  });
});
