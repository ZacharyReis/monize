import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, act } from '@/test/render';
import { SecurityPriceHistory } from './SecurityPriceHistory';

// The chart itself is covered by BalanceHistoryChart.test; here it stands in
// for itself so the props the modal builds -- the title and the trade markers
// -- can be asserted directly.
vi.mock('@/components/transactions/BalanceHistoryChart', () => ({
  BalanceHistoryChart: ({ title, markers }: any) => (
    <div data-testid="price-chart">
      {title}
      {(markers ?? []).map((marker: any, i: number) => (
        <span key={i} data-testid="chart-marker">
          {marker.direction}: {marker.label}
        </span>
      ))}
    </div>
  ),
}));

vi.mock('@/lib/investments', () => ({
  investmentsApi: {
    getSecurityPrices: vi.fn(),
    getSecurityTransactionHistory: vi.fn(),
    createSecurityPrice: vi.fn(),
    updateSecurityPrice: vi.fn(),
    deleteSecurityPrice: vi.fn(),
    backfillSecurityPrices: vi.fn(),
  },
}));

vi.mock('@/hooks/useDateFormat', () => ({
  useDateFormat: () => ({
    formatDate: (d: string) => d,
    dateFormat: 'browser',
  }),
}));

const { investmentsApi } = await import('@/lib/investments');

const mockSecurity = {
  id: 'sec-1',
  symbol: 'AAPL',
  name: 'Apple Inc.',
  securityType: 'STOCK',
  exchange: 'NASDAQ',
  currencyCode: 'USD',
  isActive: true,
  isFavourite: false,
  skipPriceUpdates: false,
  sector: null,
  industry: null,
  sectorWeightings: null,
  countryWeightings: null,
    quoteProvider: null,
    msnInstrumentId: null,
  createdAt: '2025-01-01',
  updatedAt: '2025-01-01',
};

const mockPrices = [
  {
    id: 1,
    securityId: 'sec-1',
    priceDate: '2025-06-01',
    openPrice: 190,
    highPrice: 195,
    lowPrice: 189,
    closePrice: 193.5,
    volume: 50000000,
    source: 'yahoo_finance',
    createdAt: '2025-06-01T17:00:00Z',
  },
  {
    id: 2,
    securityId: 'sec-1',
    priceDate: '2025-05-30',
    openPrice: null,
    highPrice: null,
    lowPrice: null,
    closePrice: 150.25,
    volume: null,
    source: 'buy',
    createdAt: '2025-05-30T10:00:00Z',
  },
  {
    id: 3,
    securityId: 'sec-1',
    priceDate: '2025-05-29',
    openPrice: 145,
    highPrice: 148,
    lowPrice: 144,
    closePrice: 147,
    volume: 1000,
    source: 'manual',
    createdAt: '2025-05-29T10:00:00Z',
  },
];

/** `count` synthetic daily prices, newest first, as the API returns them. */
function manyPrices(count: number) {
  return Array.from({ length: count }, (_, i) => {
    const month = 1 + Math.floor(i / 28);
    const day = 1 + (i % 28);
    return {
      id: 100 + i,
      securityId: 'sec-1',
      priceDate: `2025-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`,
      openPrice: 100 + i,
      highPrice: 101 + i,
      lowPrice: 99 + i,
      closePrice: 100 + i,
      volume: 1000,
      source: 'yahoo_finance',
      createdAt: '2025-04-01T10:00:00Z',
    };
  });
}

/**
 * Controllable IntersectionObserver. The component tears its observer down and
 * rebuilds it on every batch, so only the most recent callback is live --
 * `scrollToEnd` always drives that one.
 */
type IntersectCallback = (entries: { isIntersecting: boolean }[]) => void;
const liveObservers: IntersectCallback[] = [];

vi.stubGlobal(
  'IntersectionObserver',
  vi.fn(function (this: Record<string, unknown>, callback: IntersectCallback) {
    this.observe = vi.fn(() => {
      liveObservers.push(callback);
    });
    this.unobserve = vi.fn();
    this.disconnect = vi.fn(() => {
      const index = liveObservers.indexOf(callback);
      if (index !== -1) liveObservers.splice(index, 1);
    });
  }),
);

/** Scrolls the end-of-list sentinel into view, releasing the next batch. */
async function scrollToEnd() {
  const callback = liveObservers[liveObservers.length - 1];
  await act(async () => {
    callback?.([{ isIntersecting: true }]);
  });
}

describe('SecurityPriceHistory', () => {
  const onClose = vi.fn();

  // The component intentionally rethrows from handleAdd/handleEdit so the real
  // SecurityPriceForm keeps its submitting state. react-hook-form's handleSubmit
  // surfaces that as a rejected promise the test never awaits, which vitest
  // would flag as an unhandled rejection. Swallow the expected test errors.
  const swallowExpected = (event: PromiseRejectionEvent) => {
    const msg = (event.reason as Error)?.message;
    if (msg === 'nope' || msg === 'boom') {
      event.preventDefault();
    }
  };

  beforeEach(() => {
    vi.clearAllMocks();
    liveObservers.length = 0;
    window.addEventListener('unhandledrejection', swallowExpected);
    (investmentsApi.getSecurityPrices as ReturnType<typeof vi.fn>).mockResolvedValue(mockPrices);
    (investmentsApi.getSecurityTransactionHistory as ReturnType<typeof vi.fn>).mockResolvedValue({
      securityId: 'sec-1',
      symbol: 'AAPL',
      name: 'Apple Inc.',
      currencyCode: 'USD',
      isActive: true,
      accounts: [],
      transactions: [],
      currentQuantityAll: 0,
    });
  });

  afterEach(() => {
    window.removeEventListener('unhandledrejection', swallowExpected);
  });

  async function renderComponent() {
    let result: ReturnType<typeof render>;
    await act(async () => {
      result = render(<SecurityPriceHistory security={mockSecurity} onClose={onClose} />);
    });
    return result!;
  }

  it('renders price history with source badges', async () => {
    await renderComponent();

    expect(screen.getByText('AAPL - Price History')).toBeInTheDocument();
    expect(screen.getByText('Yahoo')).toBeInTheDocument();
    expect(screen.getByText('Buy')).toBeInTheDocument();
    expect(screen.getByText('Manual')).toBeInTheDocument();
  });

  it('shows empty state when no prices', async () => {
    (investmentsApi.getSecurityPrices as ReturnType<typeof vi.fn>).mockResolvedValue([]);
    await renderComponent();

    expect(screen.getByText('No price history available')).toBeInTheDocument();
  });

  it('shows add price form when button clicked', async () => {
    await renderComponent();

    await act(async () => {
      fireEvent.click(screen.getByText('+ Add Price'));
    });

    // "Add Price" appears as both the section header and form button
    expect(screen.getAllByText('Add Price').length).toBeGreaterThanOrEqual(1);
    expect(screen.getByLabelText('Close Price')).toBeInTheDocument();
  });

  it('calls onClose when close button clicked', async () => {
    await renderComponent();

    fireEvent.click(screen.getByRole('button', { name: 'Close' }));
    expect(onClose).toHaveBeenCalled();
  });

  it('renders edit and delete buttons for each row', async () => {
    await renderComponent();

    const editButtons = screen.getAllByText('Edit');
    const deleteButtons = screen.getAllByText('Delete');
    expect(editButtons).toHaveLength(3);
    expect(deleteButtons).toHaveLength(3);
  });

  it('loads prices on mount with the 9999 limit', async () => {
    await renderComponent();
    expect(investmentsApi.getSecurityPrices).toHaveBeenCalledWith('sec-1', 9999);
  });

  it('shows the loading spinner before prices resolve', () => {
    (investmentsApi.getSecurityPrices as ReturnType<typeof vi.fn>).mockReturnValue(
      new Promise(() => {}),
    );
    render(<SecurityPriceHistory security={mockSecurity} onClose={onClose} />);
    expect(screen.getByText('Loading prices...')).toBeInTheDocument();
  });

  it('shows an error toast and the empty state when loading prices fails', async () => {
    const toast = (await import('react-hot-toast')).default;
    // A non-Error rejection makes getErrorMessage fall back to the default text.
    (investmentsApi.getSecurityPrices as ReturnType<typeof vi.fn>).mockRejectedValue(
      'boom',
    );
    await renderComponent();
    await act(async () => {});
    expect(toast.error).toHaveBeenCalledWith('Failed to load price history');
    expect(screen.getByText('No price history available')).toBeInTheDocument();
  });

  it('renders all source label variants including unknowns', async () => {
    (investmentsApi.getSecurityPrices as ReturnType<typeof vi.fn>).mockResolvedValue([
      { id: 10, securityId: 'sec-1', priceDate: '2025-06-10', openPrice: null, highPrice: null, lowPrice: null, closePrice: 1, volume: null, source: 'msn_finance', createdAt: 'x' },
      { id: 11, securityId: 'sec-1', priceDate: '2025-06-11', openPrice: null, highPrice: null, lowPrice: null, closePrice: 1, volume: null, source: 'sell', createdAt: 'x' },
      { id: 12, securityId: 'sec-1', priceDate: '2025-06-12', openPrice: null, highPrice: null, lowPrice: null, closePrice: 1, volume: null, source: 'reinvest', createdAt: 'x' },
      { id: 13, securityId: 'sec-1', priceDate: '2025-06-13', openPrice: null, highPrice: null, lowPrice: null, closePrice: 1, volume: null, source: 'transfer_in', createdAt: 'x' },
      { id: 14, securityId: 'sec-1', priceDate: '2025-06-14', openPrice: null, highPrice: null, lowPrice: null, closePrice: 1, volume: null, source: 'transfer_out', createdAt: 'x' },
      { id: 15, securityId: 'sec-1', priceDate: '2025-06-15', openPrice: null, highPrice: null, lowPrice: null, closePrice: 1, volume: null, source: 'made_up_provider', createdAt: 'x' },
      { id: 16, securityId: 'sec-1', priceDate: '2025-06-16', openPrice: null, highPrice: null, lowPrice: null, closePrice: 1, volume: null, source: null, createdAt: 'x' },
    ]);
    await renderComponent();
    expect(screen.getByText('MSN')).toBeInTheDocument();
    expect(screen.getByText('Sell')).toBeInTheDocument();
    expect(screen.getByText('Reinvest')).toBeInTheDocument();
    expect(screen.getByText('Transfer In')).toBeInTheDocument();
    expect(screen.getByText('Transfer Out')).toBeInTheDocument();
    expect(screen.getByText('made_up_provider')).toBeInTheDocument();
    expect(screen.getByText('Unknown')).toBeInTheDocument();
  });

  it('hides the Add Price button while the add form is open and reopens it on cancel', async () => {
    await renderComponent();

    await act(async () => {
      fireEvent.click(screen.getByText('+ Add Price'));
    });
    expect(screen.queryByText('+ Add Price')).not.toBeInTheDocument();

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    });
    expect(screen.getByText('+ Add Price')).toBeInTheDocument();
  });

  it('creates a price, shows a success toast, closes the form, and reloads', async () => {
    const toast = (await import('react-hot-toast')).default;
    (investmentsApi.createSecurityPrice as ReturnType<typeof vi.fn>).mockResolvedValue(
      mockPrices[0],
    );
    await renderComponent();

    await act(async () => {
      fireEvent.click(screen.getByText('+ Add Price'));
    });
    fireEvent.change(screen.getByLabelText('Close Price'), {
      target: { value: '15.5' },
    });
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Add Price' }));
    });

    expect(investmentsApi.createSecurityPrice).toHaveBeenCalledWith(
      'sec-1',
      expect.objectContaining({ closePrice: 15.5 }),
    );
    expect(toast.success).toHaveBeenCalledWith('Price added');
    expect(screen.queryByLabelText('Close Price')).not.toBeInTheDocument();
  });

  it('shows an error toast and keeps the add form open when create fails', async () => {
    const toast = (await import('react-hot-toast')).default;
    (investmentsApi.createSecurityPrice as ReturnType<typeof vi.fn>).mockRejectedValue(
      'nope',
    );
    await renderComponent();

    await act(async () => {
      fireEvent.click(screen.getByText('+ Add Price'));
    });
    fireEvent.change(screen.getByLabelText('Close Price'), {
      target: { value: '15.5' },
    });
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Add Price' }));
    });
    await act(async () => {});

    expect(toast.error).toHaveBeenCalledWith('Failed to add price');
    // Form remains open and no reload happened.
    expect(screen.getByLabelText('Close Price')).toBeInTheDocument();
    expect(investmentsApi.getSecurityPrices).toHaveBeenCalledTimes(1);
  });

  it('opens the edit form prefilled and updates the price', async () => {
    const toast = (await import('react-hot-toast')).default;
    (investmentsApi.updateSecurityPrice as ReturnType<typeof vi.fn>).mockResolvedValue(
      mockPrices[0],
    );
    await renderComponent();

    await act(async () => {
      fireEvent.click(screen.getAllByText('Edit')[0]);
    });
    expect(screen.getByText('Edit Price')).toBeInTheDocument();
    expect(screen.getByLabelText('Close Price')).toHaveValue(193.5);

    fireEvent.change(screen.getByLabelText('Close Price'), {
      target: { value: '200' },
    });
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Update Price' }));
    });

    expect(investmentsApi.updateSecurityPrice).toHaveBeenCalledWith(
      'sec-1',
      1,
      expect.objectContaining({ closePrice: 200 }),
    );
    expect(toast.success).toHaveBeenCalledWith('Price updated');
  });

  it('shows an error toast and keeps the edit form open when update fails', async () => {
    const toast = (await import('react-hot-toast')).default;
    (investmentsApi.updateSecurityPrice as ReturnType<typeof vi.fn>).mockRejectedValue(
      'nope',
    );
    await renderComponent();

    await act(async () => {
      fireEvent.click(screen.getAllByText('Edit')[0]);
    });
    fireEvent.change(screen.getByLabelText('Close Price'), {
      target: { value: '200' },
    });
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Update Price' }));
    });
    await act(async () => {});

    expect(toast.error).toHaveBeenCalledWith('Failed to update price');
    expect(screen.getByText('Edit Price')).toBeInTheDocument();
  });

  it('cancels the edit form via its Cancel button', async () => {
    await renderComponent();
    await act(async () => {
      fireEvent.click(screen.getAllByText('Edit')[0]);
    });
    expect(screen.getByText('Edit Price')).toBeInTheDocument();
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    });
    expect(screen.queryByText('Edit Price')).not.toBeInTheDocument();
  });

  it('deletes a price after confirmation and reloads', async () => {
    const toast = (await import('react-hot-toast')).default;
    (investmentsApi.deleteSecurityPrice as ReturnType<typeof vi.fn>).mockResolvedValue(
      undefined,
    );
    await renderComponent();

    fireEvent.click(screen.getAllByText('Delete')[0]);
    // The ConfirmDialog adds a second "Delete" action button.
    const confirmButtons = screen.getAllByRole('button', { name: 'Delete' });
    await act(async () => {
      fireEvent.click(confirmButtons[confirmButtons.length - 1]);
    });

    expect(investmentsApi.deleteSecurityPrice).toHaveBeenCalledWith('sec-1', 1);
    expect(toast.success).toHaveBeenCalledWith('Price deleted');
  });

  it('names the row being deleted in the confirm dialog', async () => {
    await renderComponent();

    fireEvent.click(screen.getAllByText('Delete')[0]);

    expect(screen.getByText('Delete price entry for 2025-06-01?')).toBeInTheDocument();
  });

  it('does not delete when the confirm dialog is cancelled', async () => {
    await renderComponent();

    fireEvent.click(screen.getAllByText('Delete')[0]);
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    });

    expect(investmentsApi.deleteSecurityPrice).not.toHaveBeenCalled();
  });

  it('shows an error toast and keeps the table rendered when delete fails', async () => {
    const toast = (await import('react-hot-toast')).default;
    (investmentsApi.deleteSecurityPrice as ReturnType<typeof vi.fn>).mockRejectedValue(
      'boom',
    );
    await renderComponent();

    fireEvent.click(screen.getAllByText('Delete')[0]);
    const confirmButtons = screen.getAllByRole('button', { name: 'Delete' });
    await act(async () => {
      fireEvent.click(confirmButtons[confirmButtons.length - 1]);
    });
    await act(async () => {});

    expect(toast.error).toHaveBeenCalledWith('Failed to delete price');
    expect(screen.getAllByText('Edit')).toHaveLength(3);
  });

  describe('paging the price table', () => {
    const rowCount = () =>
      document.querySelectorAll('tbody tr').length;

    it('renders only the first 10 rows, with no button to press', async () => {
      (investmentsApi.getSecurityPrices as ReturnType<typeof vi.fn>).mockResolvedValue(
        manyPrices(75),
      );
      await renderComponent();

      expect(rowCount()).toBe(10);
      expect(screen.getByText('Showing 10 of 75 prices')).toBeInTheDocument();
      expect(screen.queryByRole('button', { name: /more/i })).not.toBeInTheDocument();
    });

    it('appends 50 more each time the end of the list scrolls into view', async () => {
      (investmentsApi.getSecurityPrices as ReturnType<typeof vi.fn>).mockResolvedValue(
        manyPrices(75),
      );
      await renderComponent();
      expect(rowCount()).toBe(10);

      await scrollToEnd();
      expect(rowCount()).toBe(60);
      expect(screen.getByText('Showing 60 of 75 prices')).toBeInTheDocument();

      // Last batch is short: 15 left, not another 50.
      await scrollToEnd();
      expect(rowCount()).toBe(75);
    });

    it('stops observing once every row is shown', async () => {
      (investmentsApi.getSecurityPrices as ReturnType<typeof vi.fn>).mockResolvedValue(
        manyPrices(25),
      );
      await renderComponent();

      await scrollToEnd();

      expect(rowCount()).toBe(25);
      expect(screen.queryByTestId('price-history-sentinel')).not.toBeInTheDocument();
      expect(screen.queryByText(/Showing/)).not.toBeInTheDocument();
      expect(liveObservers).toHaveLength(0);
    });

    it('leaves the sentinel out when everything already fits on one page', async () => {
      await renderComponent();

      expect(rowCount()).toBe(3);
      expect(screen.queryByTestId('price-history-sentinel')).not.toBeInTheDocument();
      expect(liveObservers).toHaveLength(0);
    });

    it('charts the whole series even though the table is paged', async () => {
      (investmentsApi.getSecurityPrices as ReturnType<typeof vi.fn>).mockResolvedValue(
        manyPrices(25),
      );
      await renderComponent();

      // The chart is fed every fetched point, not just the visible rows.
      expect(investmentsApi.getSecurityPrices).toHaveBeenCalledWith('sec-1', 9999);
      expect(screen.getByTestId('price-chart')).toBeInTheDocument();
      expect(rowCount()).toBe(10);
    });

    it('collapses back to the first page after a reload', async () => {
      (investmentsApi.getSecurityPrices as ReturnType<typeof vi.fn>).mockResolvedValue(
        manyPrices(25),
      );
      (investmentsApi.deleteSecurityPrice as ReturnType<typeof vi.fn>).mockResolvedValue(
        undefined,
      );
      await renderComponent();

      await scrollToEnd();
      expect(rowCount()).toBe(25);

      fireEvent.click(screen.getAllByText('Delete')[0]);
      const confirmButtons = screen.getAllByRole('button', { name: 'Delete' });
      await act(async () => {
        fireEvent.click(confirmButtons[confirmButtons.length - 1]);
      });

      expect(rowCount()).toBe(10);
    });

    it('keeps the table in a single vertical scroll region -- the modal panel', async () => {
      await renderComponent();

      const scroller = document.querySelector('table')!.parentElement!;
      // Horizontal overflow stays for narrow screens; a capped vertical
      // scroller here would nest a second scrollbar inside the modal's.
      expect(scroller.className).toContain('overflow-x-auto');
      expect(scroller.className).not.toContain('overflow-y-auto');
      expect(scroller.className).not.toContain('max-h-');
    });
  });

  describe('mobile long-press actions', () => {
    // The actions column is CSS-hidden below the sm breakpoint, so on a phone
    // the row's only route to edit/delete is a press-and-hold.
    async function longPressFirstRow() {
      const row = screen.getByText('2025-06-01').closest('tr')!;
      fireEvent.touchStart(row, { touches: [{ clientX: 0, clientY: 0 }] });
      await act(async () => {
        await new Promise((res) => setTimeout(res, 800));
      });
      return row;
    }

    it('hides the actions column on mobile and keeps it from the sm breakpoint up', async () => {
      await renderComponent();

      const header = screen.getByRole('columnheader', { name: 'Actions' });
      expect(header.className).toContain('hidden');
      expect(header.className).toContain('sm:table-cell');

      const actionCell = screen.getAllByText('Edit')[0].closest('td')!;
      expect(actionCell.className).toContain('hidden');
      expect(actionCell.className).toContain('sm:table-cell');
    });

    it('opens the action sheet on long-press, headed by the row date and close price', async () => {
      await renderComponent();
      await longPressFirstRow();

      expect(screen.getByRole('dialog')).toBeInTheDocument();
      // Sheet heading: the pressed row's date, subtitled with its close price.
      // Both also appear in the table row, hence the duplicate counts.
      const sheet = screen.getByRole('dialog');
      expect(sheet.textContent).toContain('2025-06-01');
      expect(sheet.textContent).toContain('193.50');
    });

    it('does not open the sheet when the touch moves beyond the drag threshold', async () => {
      await renderComponent();

      const row = screen.getByText('2025-06-01').closest('tr')!;
      fireEvent.touchStart(row, { touches: [{ clientX: 0, clientY: 0 }] });
      fireEvent.touchMove(row, { touches: [{ clientX: 50, clientY: 50 }] });
      await act(async () => {
        await new Promise((res) => setTimeout(res, 800));
      });

      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    });

    it('opens the edit form from the action sheet', async () => {
      await renderComponent();
      await longPressFirstRow();

      const sheetEdit = screen.getAllByRole('button', { name: 'Edit' }).at(-1)!;
      await act(async () => {
        fireEvent.click(sheetEdit);
      });

      expect(screen.getByText('Edit Price')).toBeInTheDocument();
    });

    it('deletes a price from the action sheet after confirmation', async () => {
      (investmentsApi.deleteSecurityPrice as ReturnType<typeof vi.fn>).mockResolvedValue(
        undefined,
      );
      await renderComponent();
      await longPressFirstRow();

      const sheetDelete = screen.getAllByRole('button', { name: 'Delete' }).at(-1)!;
      await act(async () => {
        fireEvent.click(sheetDelete);
      });

      const confirmButtons = screen.getAllByRole('button', { name: 'Delete' });
      await act(async () => {
        fireEvent.click(confirmButtons[confirmButtons.length - 1]);
      });

      expect(investmentsApi.deleteSecurityPrice).toHaveBeenCalledWith('sec-1', 1);
    });
  });

  describe('price chart', () => {
    it('charts the price series above the table', async () => {
      await renderComponent();

      // Deliberately the account balance-history chart, so the two screens
      // read the same way; only the title and the neutral colouring differ.
      expect(screen.getByText('Price History')).toBeInTheDocument();
      expect(screen.getByText(/AAPL/)).toBeInTheDocument();
    });

    it('marks the days shares moved, and how many', async () => {
      (investmentsApi.getSecurityTransactionHistory as ReturnType<typeof vi.fn>).mockResolvedValue({
        securityId: 'sec-1',
        symbol: 'AAPL',
        name: 'Apple Inc.',
        currencyCode: 'USD',
        isActive: true,
        accounts: [],
        currentQuantityAll: 8,
        transactions: [
          { id: 't1', transactionDate: '2025-05-30', accountId: 'a1', accountName: 'RRSP', action: 'BUY', quantity: 10, price: 150, commission: 0, totalAmount: 1500, description: null, runningQuantityAccount: 10, runningQuantityAll: 10 },
          { id: 't2', transactionDate: '2025-06-01', accountId: 'a1', accountName: 'RRSP', action: 'SELL', quantity: 2, price: 193, commission: 0, totalAmount: 386, description: null, runningQuantityAccount: 8, runningQuantityAll: 8 },
          // No shares moved, so nothing to pin on the chart.
          { id: 't3', transactionDate: '2025-06-01', accountId: 'a1', accountName: 'RRSP', action: 'DIVIDEND', quantity: null, price: null, commission: 0, totalAmount: 12, description: null, runningQuantityAccount: 8, runningQuantityAll: 8 },
        ],
      });

      await renderComponent();

      const markers = screen.getAllByTestId('chart-marker');
      expect(markers).toHaveLength(2);
      expect(markers[0]).toHaveTextContent('in: Bought 10 · RRSP');
      expect(markers[1]).toHaveTextContent('out: Sold 2 · RRSP');
    });

    it('keeps the chart when the trade lookup fails', async () => {
      (investmentsApi.getSecurityTransactionHistory as ReturnType<typeof vi.fn>).mockRejectedValue(
        new Error('nope'),
      );
      await renderComponent();

      // Markers are a nicety; the price history is the point of the modal.
      expect(screen.getByTestId('price-chart')).toBeInTheDocument();
      expect(screen.queryAllByTestId('chart-marker')).toHaveLength(0);
    });

    it('leaves the chart out when there is nothing to plot', async () => {
      (investmentsApi.getSecurityPrices as ReturnType<typeof vi.fn>).mockResolvedValue([
        mockPrices[0],
      ]);
      await renderComponent();

      // A single point is a dot, not a history.
      expect(screen.queryByText('Price History')).not.toBeInTheDocument();
    });
  });

  describe('Force Update Prices', () => {
    it('force-updates prices, shows a success toast with the count, and reloads', async () => {
      const toast = (await import('react-hot-toast')).default;
      (investmentsApi.backfillSecurityPrices as ReturnType<typeof vi.fn>).mockResolvedValue({
        symbol: 'AAPL',
        success: true,
        pricesLoaded: 252,
        provider: 'yahoo',
      });
      await renderComponent();

      await act(async () => {
        fireEvent.click(screen.getByRole('button', { name: 'Force Update Prices' }));
      });

      expect(investmentsApi.backfillSecurityPrices).toHaveBeenCalledWith('sec-1');
      expect(toast.success).toHaveBeenCalledWith('Updated 252 prices for AAPL');
      // Reloaded after the update (initial mount + post-update).
      expect(investmentsApi.getSecurityPrices).toHaveBeenCalledTimes(2);
    });

    it('uses singular wording when exactly one price is loaded', async () => {
      const toast = (await import('react-hot-toast')).default;
      (investmentsApi.backfillSecurityPrices as ReturnType<typeof vi.fn>).mockResolvedValue({
        symbol: 'AAPL',
        success: true,
        pricesLoaded: 1,
        provider: 'yahoo',
      });
      await renderComponent();

      await act(async () => {
        fireEvent.click(screen.getByRole('button', { name: 'Force Update Prices' }));
      });

      expect(toast.success).toHaveBeenCalledWith('Updated 1 price for AAPL');
    });

    it('shows a "no prices found" toast when zero prices are loaded', async () => {
      const toast = (await import('react-hot-toast')).default;
      (investmentsApi.backfillSecurityPrices as ReturnType<typeof vi.fn>).mockResolvedValue({
        symbol: 'AAPL',
        success: true,
        pricesLoaded: 0,
        provider: 'yahoo',
      });
      await renderComponent();

      await act(async () => {
        fireEvent.click(screen.getByRole('button', { name: 'Force Update Prices' }));
      });

      expect(toast.success).toHaveBeenCalledWith('No prices found for AAPL');
    });

    it('shows the backend error message when the update reports failure', async () => {
      const toast = (await import('react-hot-toast')).default;
      (investmentsApi.backfillSecurityPrices as ReturnType<typeof vi.fn>).mockResolvedValue({
        symbol: 'AAPL',
        success: false,
        error: 'No historical data available',
      });
      await renderComponent();

      await act(async () => {
        fireEvent.click(screen.getByRole('button', { name: 'Force Update Prices' }));
      });

      expect(toast.error).toHaveBeenCalledWith('No historical data available');
      // No reload on failure (only the initial mount load).
      expect(investmentsApi.getSecurityPrices).toHaveBeenCalledTimes(1);
    });

    it('falls back to a generic message when failure has no error string', async () => {
      const toast = (await import('react-hot-toast')).default;
      (investmentsApi.backfillSecurityPrices as ReturnType<typeof vi.fn>).mockResolvedValue({
        symbol: 'AAPL',
        success: false,
      });
      await renderComponent();

      await act(async () => {
        fireEvent.click(screen.getByRole('button', { name: 'Force Update Prices' }));
      });

      expect(toast.error).toHaveBeenCalledWith('Failed to update prices for AAPL');
    });

    it('shows an error toast when the request throws', async () => {
      const toast = (await import('react-hot-toast')).default;
      (investmentsApi.backfillSecurityPrices as ReturnType<typeof vi.fn>).mockRejectedValue(
        'boom',
      );
      await renderComponent();

      await act(async () => {
        fireEvent.click(screen.getByRole('button', { name: 'Force Update Prices' }));
      });
      await act(async () => {});

      expect(toast.error).toHaveBeenCalledWith('Failed to update prices');
    });
  });
});
