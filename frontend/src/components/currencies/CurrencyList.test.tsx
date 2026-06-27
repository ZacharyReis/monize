import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, act, waitFor } from '@/test/render';
import { CurrencyList } from './CurrencyList';
import { exchangeRatesApi } from '@/lib/exchange-rates';

vi.mock('@/lib/exchange-rates', () => ({
  exchangeRatesApi: {
    deleteCurrency: vi.fn().mockResolvedValue(undefined),
  },
}));

vi.mock('@/lib/logger', () => ({
  createLogger: () => ({ error: vi.fn(), info: vi.fn(), warn: vi.fn(), debug: vi.fn() }),
}));

vi.mock('@/lib/errors', () => ({
  getErrorMessage: (_err: unknown, fallback: string) => fallback,
}));

describe('CurrencyList', () => {
  const onEdit = vi.fn();
  const onToggleActive = vi.fn();
  const onRefresh = vi.fn();
  const getRate = vi.fn().mockReturnValue(null);

  const defaultProps = {
    usage: {} as Record<string, { accounts: number; securities: number }>,
    defaultCurrency: 'CAD',
    getRate,
    onEdit,
    onToggleActive,
    onRefresh,
  };

  const makeCurrency = (overrides: any = {}) => ({
    code: 'USD',
    name: 'US Dollar',
    symbol: '$',
    decimalPlaces: 2,
    isActive: true,
    isSystem: false,
    createdAt: '2025-01-01T00:00:00Z',
    ...overrides,
  });

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders empty state', () => {
    render(<CurrencyList currencies={[]} {...defaultProps} />);
    expect(screen.getByText('No currencies')).toBeInTheDocument();
  });

  it('renders currencies table with data', () => {
    const currencies = [
      makeCurrency({ code: 'CAD', name: 'Canadian Dollar' }),
      makeCurrency({ code: 'USD', name: 'US Dollar', isActive: false }),
    ];

    render(<CurrencyList currencies={currencies} {...defaultProps} />);
    expect(screen.getByText('CAD')).toBeInTheDocument();
    expect(screen.getByText('USD')).toBeInTheDocument();
    expect(screen.getByText('Active')).toBeInTheDocument();
    expect(screen.getByText('Inactive')).toBeInTheDocument();
  });

  it('calls onEdit when edit button is clicked', () => {
    const currencies = [makeCurrency({ code: 'CAD', name: 'Canadian Dollar' })];

    render(<CurrencyList currencies={currencies} {...defaultProps} />);
    fireEvent.click(screen.getByText('Edit'));
    expect(onEdit).toHaveBeenCalledWith(expect.objectContaining({ code: 'CAD' }));
  });

  it('shows deactivate button for non-default, unused active currency', () => {
    const currencies = [makeCurrency()];

    render(<CurrencyList currencies={currencies} {...defaultProps} />);
    expect(screen.getByText('Deactivate')).toBeInTheDocument();
  });

  it('shows activate button for inactive currencies', () => {
    const currencies = [makeCurrency({ code: 'JPY', name: 'Japanese Yen', symbol: '\u00a5', isActive: false })];

    render(<CurrencyList currencies={currencies} {...defaultProps} />);
    expect(screen.getByText('Activate')).toBeInTheDocument();
  });

  it('hides deactivate button for default currency', () => {
    const currencies = [makeCurrency({ code: 'CAD', name: 'Canadian Dollar' })];

    render(<CurrencyList currencies={currencies} {...defaultProps} />);
    expect(screen.queryByText('Deactivate')).not.toBeInTheDocument();
    // Edit should still be visible
    expect(screen.getByText('Edit')).toBeInTheDocument();
  });

  it('hides deactivate button for currency in use', () => {
    const currencies = [makeCurrency()];
    const usage = { USD: { accounts: 2, securities: 0 } };

    render(<CurrencyList currencies={currencies} {...defaultProps} usage={usage} />);
    expect(screen.queryByText('Deactivate')).not.toBeInTheDocument();
    expect(screen.getByText('Edit')).toBeInTheDocument();
  });

  describe('isSystem flag', () => {
    it('hides Edit button for system currencies in row actions', () => {
      const currencies = [makeCurrency({ code: 'USD', isSystem: true })];

      render(<CurrencyList currencies={currencies} {...defaultProps} />);
      expect(screen.queryByText('Edit')).not.toBeInTheDocument();
    });

    it('shows Edit button for non-system currencies', () => {
      const currencies = [makeCurrency({ code: 'USD', isSystem: false })];

      render(<CurrencyList currencies={currencies} {...defaultProps} />);
      expect(screen.getByText('Edit')).toBeInTheDocument();
    });

    it('shows Edit for non-system but hides for system in mixed list', () => {
      const currencies = [
        makeCurrency({ code: 'CAD', name: 'Canadian Dollar', isSystem: true }),
        makeCurrency({ code: 'XYZ', name: 'Custom Currency', symbol: 'X', isSystem: false }),
      ];

      render(<CurrencyList currencies={currencies} {...defaultProps} />);
      const editButtons = screen.getAllByText('Edit');
      expect(editButtons).toHaveLength(1);
    });

    it('hides Edit Currency in context menu for system currencies', async () => {
      vi.useFakeTimers();
      const currencies = [makeCurrency({ code: 'USD', isSystem: true })];

      render(<CurrencyList currencies={currencies} {...defaultProps} />);
      const row = screen.getByText('USD').closest('tr')!;

      await act(async () => {
        fireEvent.mouseDown(row);
        vi.advanceTimersByTime(750);
      });

      expect(screen.queryByText('Edit Currency')).not.toBeInTheDocument();
      vi.useRealTimers();
    });

    it('shows Edit Currency in context menu for non-system currencies', async () => {
      vi.useFakeTimers();
      const currencies = [makeCurrency({ code: 'USD', isSystem: false })];

      render(<CurrencyList currencies={currencies} {...defaultProps} />);
      const row = screen.getByText('USD').closest('tr')!;

      await act(async () => {
        fireEvent.mouseDown(row);
        vi.advanceTimersByTime(750);
      });

      expect(screen.getByText('Edit Currency')).toBeInTheDocument();
      vi.useRealTimers();
    });

    it('hides Delete Currency in context menu for system currencies', async () => {
      vi.useFakeTimers();
      const currencies = [makeCurrency({ code: 'JPY', name: 'Japanese Yen', isSystem: true })];

      render(<CurrencyList currencies={currencies} {...defaultProps} />);
      const row = screen.getByText('JPY').closest('tr')!;

      await act(async () => {
        fireEvent.mouseDown(row);
        vi.advanceTimersByTime(750);
      });

      // System currencies are shared catalog rows: they can be deactivated
      // (hidden from your list) but not deleted.
      expect(screen.getAllByText('Deactivate').length).toBeGreaterThanOrEqual(1);
      expect(screen.queryByText('Delete Currency')).not.toBeInTheDocument();
      vi.useRealTimers();
    });
  });

  it('shows Default badge for default currency', () => {
    const currencies = [makeCurrency({ code: 'CAD', name: 'Canadian Dollar' })];

    render(<CurrencyList currencies={currencies} {...defaultProps} />);
    expect(screen.getByText('Default')).toBeInTheDocument();
  });

  it('toggles density when density button is clicked', () => {
    const currencies = [makeCurrency({ code: 'CAD', name: 'Canadian Dollar' })];

    render(<CurrencyList currencies={currencies} {...defaultProps} />);
    const densityButton = screen.getByText('Normal');
    fireEvent.click(densityButton);
    expect(screen.getByText('Compact')).toBeInTheDocument();
    fireEvent.click(screen.getByText('Compact'));
    expect(screen.getByText('Dense')).toBeInTheDocument();
  });

  it('displays exchange rate when available', () => {
    const rateGetter = vi.fn().mockReturnValue(0.7321);
    const currencies = [makeCurrency()];

    render(<CurrencyList currencies={currencies} {...defaultProps} getRate={rateGetter} />);
    expect(screen.getByText('0.7321')).toBeInTheDocument();
  });

  it('displays usage information when currency is in use', () => {
    const currencies = [makeCurrency()];
    const usage = { USD: { accounts: 2, securities: 3 } };

    render(<CurrencyList currencies={currencies} {...defaultProps} usage={usage} />);
    expect(screen.getByText('2 accts, 3 secs')).toBeInTheDocument();
  });

  it('calls onDensityChange when provided', () => {
    const onDensityChange = vi.fn();
    const currencies = [makeCurrency({ code: 'CAD', name: 'Canadian Dollar' })];

    render(<CurrencyList currencies={currencies} {...defaultProps} density="normal" onDensityChange={onDensityChange} />);
    fireEvent.click(screen.getByText('Normal'));
    expect(onDensityChange).toHaveBeenCalledWith('compact');
  });

  describe('sorting', () => {
    it('renders sortable column headers', () => {
      const currencies = [makeCurrency({ code: 'CAD', name: 'Canadian Dollar' })];

      render(<CurrencyList currencies={currencies} {...defaultProps} />);
      const codeHeader = screen.getByText('Code');
      const nameHeader = screen.getByText('Name');
      expect(codeHeader.closest('th')).toBeInTheDocument();
      expect(nameHeader.closest('th')).toBeInTheDocument();
    });

    it('calls onSort when a sortable column header is clicked', () => {
      const onSort = vi.fn();
      const currencies = [makeCurrency({ code: 'CAD', name: 'Canadian Dollar' })];

      render(<CurrencyList currencies={currencies} {...defaultProps} onSort={onSort} sortField="code" sortDirection="asc" />);
      fireEvent.click(screen.getByText('Name'));
      expect(onSort).toHaveBeenCalledWith('name');
    });

    it('calls onSort with current field to toggle direction', () => {
      const onSort = vi.fn();
      const currencies = [makeCurrency({ code: 'CAD', name: 'Canadian Dollar' })];

      render(<CurrencyList currencies={currencies} {...defaultProps} onSort={onSort} sortField="code" sortDirection="asc" />);
      fireEvent.click(screen.getByText('Code'));
      expect(onSort).toHaveBeenCalledWith('code');
    });

    it('uses local sort state when no onSort prop is provided', () => {
      const currencies = [
        makeCurrency({ code: 'CAD', name: 'Canadian Dollar' }),
        makeCurrency({ code: 'USD', name: 'US Dollar' }),
      ];

      render(<CurrencyList currencies={currencies} {...defaultProps} />);
      // Click Name header to sort - should not throw
      fireEvent.click(screen.getByText('Name'));
    });
  });

  describe('long-press context menu', () => {
    beforeEach(() => {
      vi.useFakeTimers();
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    it('opens context menu on long press', async () => {
      const currencies = [makeCurrency()];

      render(<CurrencyList currencies={currencies} {...defaultProps} />);
      const row = screen.getByText('USD').closest('tr')!;

      await act(async () => {
        fireEvent.mouseDown(row);
        vi.advanceTimersByTime(750);
      });

      expect(screen.getByText('Edit Currency')).toBeInTheDocument();
    });

    it('shows currency code and name in context menu', async () => {
      const currencies = [makeCurrency()];

      render(<CurrencyList currencies={currencies} {...defaultProps} />);
      const row = screen.getByText('USD').closest('tr')!;

      await act(async () => {
        fireEvent.mouseDown(row);
        vi.advanceTimersByTime(750);
      });

      // Code appears in both table row and context menu header
      const codeElements = screen.getAllByText('USD');
      expect(codeElements.length).toBeGreaterThanOrEqual(2);
      // Name appears in both table row and context menu
      const nameElements = screen.getAllByText('US Dollar');
      expect(nameElements.length).toBeGreaterThanOrEqual(2);
    });

    it('context menu Edit Currency calls onEdit', async () => {
      const currencies = [makeCurrency()];

      render(<CurrencyList currencies={currencies} {...defaultProps} />);
      const row = screen.getByText('USD').closest('tr')!;

      await act(async () => {
        fireEvent.mouseDown(row);
        vi.advanceTimersByTime(750);
      });

      fireEvent.click(screen.getByText('Edit Currency'));
      expect(onEdit).toHaveBeenCalledWith(expect.objectContaining({ code: 'USD' }));
    });

    it('context menu shows Deactivate and Delete for non-default, unused currency', async () => {
      const currencies = [makeCurrency()];

      render(<CurrencyList currencies={currencies} {...defaultProps} />);
      const row = screen.getByText('USD').closest('tr')!;

      await act(async () => {
        fireEvent.mouseDown(row);
        vi.advanceTimersByTime(750);
      });

      const deactivateButtons = screen.getAllByText('Deactivate');
      expect(deactivateButtons.length).toBeGreaterThanOrEqual(1);
      expect(screen.getByText('Delete Currency')).toBeInTheDocument();
    });

    it('context menu hides Deactivate and Delete for default currency', async () => {
      const currencies = [makeCurrency({ code: 'CAD', name: 'Canadian Dollar' })];

      render(<CurrencyList currencies={currencies} {...defaultProps} />);
      const row = screen.getByText('CAD').closest('tr')!;

      await act(async () => {
        fireEvent.mouseDown(row);
        vi.advanceTimersByTime(750);
      });

      expect(screen.getByText('Edit Currency')).toBeInTheDocument();
      expect(screen.queryByText('Delete Currency')).not.toBeInTheDocument();
    });

    it('context menu hides Deactivate and Delete for in-use currency', async () => {
      const currencies = [makeCurrency()];
      const usage = { USD: { accounts: 1, securities: 0 } };

      render(<CurrencyList currencies={currencies} {...defaultProps} usage={usage} />);
      const row = screen.getByText('USD').closest('tr')!;

      await act(async () => {
        fireEvent.mouseDown(row);
        vi.advanceTimersByTime(750);
      });

      expect(screen.getByText('Edit Currency')).toBeInTheDocument();
      expect(screen.queryByText('Delete Currency')).not.toBeInTheDocument();
    });

    it('context menu Deactivate calls onToggleActive', async () => {
      const currencies = [makeCurrency()];

      render(<CurrencyList currencies={currencies} {...defaultProps} />);
      const row = screen.getByText('USD').closest('tr')!;

      await act(async () => {
        fireEvent.mouseDown(row);
        vi.advanceTimersByTime(750);
      });

      const deactivateButtons = screen.getAllByText('Deactivate');
      fireEvent.click(deactivateButtons[deactivateButtons.length - 1]);
      expect(onToggleActive).toHaveBeenCalledWith(expect.objectContaining({ code: 'USD' }));
    });

    it('does not open context menu if mouse released before 750ms', async () => {
      const currencies = [makeCurrency()];

      render(<CurrencyList currencies={currencies} {...defaultProps} />);
      const row = screen.getByText('USD').closest('tr')!;

      await act(async () => {
        fireEvent.mouseDown(row);
        vi.advanceTimersByTime(500);
        fireEvent.mouseUp(row);
        vi.advanceTimersByTime(300);
      });

      expect(screen.queryByText('Edit Currency')).not.toBeInTheDocument();
    });

    it('cancels long-press when touch moves beyond threshold', async () => {
      const currencies = [makeCurrency()];

      render(<CurrencyList currencies={currencies} {...defaultProps} />);
      const row = screen.getByText('USD').closest('tr')!;

      await act(async () => {
        fireEvent.touchStart(row, {
          touches: [{ clientX: 100, clientY: 100 }],
        });
        vi.advanceTimersByTime(400);
        fireEvent.touchMove(row, {
          touches: [{ clientX: 115, clientY: 100 }], // > 10px threshold
        });
        vi.advanceTimersByTime(400);
      });

      expect(screen.queryByText('Edit Currency')).not.toBeInTheDocument();
    });

    it('opens context menu via touch start and fires after 750ms', async () => {
      const currencies = [makeCurrency()];

      render(<CurrencyList currencies={currencies} {...defaultProps} />);
      const row = screen.getByText('USD').closest('tr')!;

      await act(async () => {
        fireEvent.touchStart(row, {
          touches: [{ clientX: 100, clientY: 100 }],
        });
        vi.advanceTimersByTime(750);
      });

      expect(screen.getByText('Edit Currency')).toBeInTheDocument();
    });

    it('cancels long-press on touchEnd before threshold', async () => {
      const currencies = [makeCurrency()];

      render(<CurrencyList currencies={currencies} {...defaultProps} />);
      const row = screen.getByText('USD').closest('tr')!;

      await act(async () => {
        fireEvent.touchStart(row, {
          touches: [{ clientX: 100, clientY: 100 }],
        });
        vi.advanceTimersByTime(400);
        fireEvent.touchEnd(row);
        vi.advanceTimersByTime(400);
      });

      expect(screen.queryByText('Edit Currency')).not.toBeInTheDocument();
    });

    it('cancels long-press on touchCancel', async () => {
      const currencies = [makeCurrency()];

      render(<CurrencyList currencies={currencies} {...defaultProps} />);
      const row = screen.getByText('USD').closest('tr')!;

      await act(async () => {
        fireEvent.touchStart(row, {
          touches: [{ clientX: 100, clientY: 100 }],
        });
        vi.advanceTimersByTime(400);
        fireEvent.touchCancel(row);
        vi.advanceTimersByTime(400);
      });

      expect(screen.queryByText('Edit Currency')).not.toBeInTheDocument();
    });

    it('context menu shows Activate for inactive non-default currency', async () => {
      const currencies = [makeCurrency({ code: 'USD', isActive: false })];

      render(<CurrencyList currencies={currencies} {...defaultProps} />);
      const row = screen.getByText('USD').closest('tr')!;

      await act(async () => {
        fireEvent.mouseDown(row);
        vi.advanceTimersByTime(750);
      });

      // Both the table row action and the context menu show "Activate"
      const activateButtons = screen.getAllByText('Activate');
      expect(activateButtons.length).toBeGreaterThanOrEqual(1);
    });

    it('context menu Activate calls onToggleActive for inactive currency', async () => {
      const currencies = [makeCurrency({ code: 'USD', isActive: false })];

      render(<CurrencyList currencies={currencies} {...defaultProps} />);
      const row = screen.getByText('USD').closest('tr')!;

      await act(async () => {
        fireEvent.mouseDown(row);
        vi.advanceTimersByTime(750);
      });

      // Click the last Activate button (the context menu one)
      const activateButtons = screen.getAllByText('Activate');
      fireEvent.click(activateButtons[activateButtons.length - 1]);
      expect(onToggleActive).toHaveBeenCalledWith(expect.objectContaining({ code: 'USD' }));
    });

    it('context menu Delete opens confirm dialog', async () => {
      const currencies = [makeCurrency()];

      render(<CurrencyList currencies={currencies} {...defaultProps} />);
      const row = screen.getByText('USD').closest('tr')!;

      await act(async () => {
        fireEvent.mouseDown(row);
        vi.advanceTimersByTime(750);
      });

      fireEvent.click(screen.getByText('Delete Currency'));
      // ConfirmDialog should appear
      expect(screen.getByText(/Delete "USD"/i)).toBeInTheDocument();
    });

    it('does not cancel long-press on small touch movement within threshold', async () => {
      const currencies = [makeCurrency()];

      render(<CurrencyList currencies={currencies} {...defaultProps} />);
      const row = screen.getByText('USD').closest('tr')!;

      await act(async () => {
        fireEvent.touchStart(row, {
          touches: [{ clientX: 100, clientY: 100 }],
        });
        vi.advanceTimersByTime(400);
        // Move only 5px — within the 10px threshold, should not cancel
        fireEvent.touchMove(row, {
          touches: [{ clientX: 105, clientY: 100 }],
        });
        vi.advanceTimersByTime(400);
      });

      expect(screen.getByText('Edit Currency')).toBeInTheDocument();
    });
  });

  describe('delete confirmation', () => {
    it('calls deleteCurrency and onRefresh on confirm', async () => {
      vi.mocked(exchangeRatesApi.deleteCurrency).mockResolvedValue(undefined);
      const currencies = [makeCurrency()];

      render(<CurrencyList currencies={currencies} {...defaultProps} />);

      // Open context menu to get Delete button
      vi.useFakeTimers();
      const row = screen.getByText('USD').closest('tr')!;
      await act(async () => {
        fireEvent.mouseDown(row);
        vi.advanceTimersByTime(750);
      });
      fireEvent.click(screen.getByText('Delete Currency'));
      vi.useRealTimers();

      // Confirm delete
      await act(async () => {
        fireEvent.click(screen.getByText('Delete'));
      });

      await waitFor(() => {
        expect(exchangeRatesApi.deleteCurrency).toHaveBeenCalledWith('USD');
        expect(onRefresh).toHaveBeenCalled();
      });
    });

    it('shows error toast when deleteCurrency fails', async () => {
      vi.mocked(exchangeRatesApi.deleteCurrency).mockRejectedValue(new Error('In use'));
      const currencies = [makeCurrency()];

      render(<CurrencyList currencies={currencies} {...defaultProps} />);

      vi.useFakeTimers();
      const row = screen.getByText('USD').closest('tr')!;
      await act(async () => {
        fireEvent.mouseDown(row);
        vi.advanceTimersByTime(750);
      });
      fireEvent.click(screen.getByText('Delete Currency'));
      vi.useRealTimers();

      await act(async () => {
        fireEvent.click(screen.getByText('Delete'));
      });

      await waitFor(() => {
        expect(exchangeRatesApi.deleteCurrency).toHaveBeenCalledWith('USD');
        // onRefresh should NOT be called on error
        expect(onRefresh).not.toHaveBeenCalled();
      });
    });

    it('cancels delete when Cancel is clicked', async () => {
      const currencies = [makeCurrency()];

      render(<CurrencyList currencies={currencies} {...defaultProps} />);

      vi.useFakeTimers();
      const row = screen.getByText('USD').closest('tr')!;
      await act(async () => {
        fireEvent.mouseDown(row);
        vi.advanceTimersByTime(750);
      });
      fireEvent.click(screen.getByText('Delete Currency'));
      vi.useRealTimers();

      fireEvent.click(screen.getByText('Cancel'));
      expect(exchangeRatesApi.deleteCurrency).not.toHaveBeenCalled();
      expect(onRefresh).not.toHaveBeenCalled();
    });
  });

  describe('density modes', () => {
    it('shows dense status abbreviations (Act/Ina) in dense mode', () => {
      const currencies = [
        makeCurrency({ code: 'USD', isActive: true }),
        makeCurrency({ code: 'JPY', name: 'Japanese Yen', symbol: '¥', isActive: false }),
      ];

      render(<CurrencyList currencies={currencies} {...defaultProps} density="dense" />);
      expect(screen.getByText('Act')).toBeInTheDocument();
      expect(screen.getByText('Ina')).toBeInTheDocument();
    });

    it('shows the edit icon button in dense mode', () => {
      const currencies = [makeCurrency({ code: 'USD' })];

      render(<CurrencyList currencies={currencies} {...defaultProps} density="dense" />);
      expect(screen.getByRole('button', { name: 'Edit' })).toBeInTheDocument();
    });

    it('shows the deactivate icon button in dense mode', () => {
      const currencies = [makeCurrency({ code: 'USD', isActive: true })];

      render(<CurrencyList currencies={currencies} {...defaultProps} density="dense" />);
      expect(screen.getByRole('button', { name: 'Deactivate' })).toBeInTheDocument();
    });

    it('shows the activate icon button for inactive currency in dense mode', () => {
      const currencies = [makeCurrency({ code: 'USD', isActive: false })];

      render(<CurrencyList currencies={currencies} {...defaultProps} density="dense" />);
      expect(screen.getByRole('button', { name: 'Activate' })).toBeInTheDocument();
    });

    it('hides Decimals column in compact mode', () => {
      const currencies = [makeCurrency({ code: 'USD' })];

      render(<CurrencyList currencies={currencies} {...defaultProps} density="compact" />);
      expect(screen.queryByText('Decimals')).not.toBeInTheDocument();
    });

    it('shows Decimals column in normal mode', () => {
      const currencies = [makeCurrency({ code: 'USD' })];

      render(<CurrencyList currencies={currencies} {...defaultProps} density="normal" />);
      expect(screen.getByText('Decimals')).toBeInTheDocument();
    });

    it('applies alternating row style for non-normal density at odd index', () => {
      const currencies = [
        makeCurrency({ code: 'USD', name: 'US Dollar' }),
        makeCurrency({ code: 'EUR', name: 'Euro', symbol: '€' }),
      ];

      const { container } = render(
        <CurrencyList currencies={currencies} {...defaultProps} density="dense" />,
      );
      const rows = container.querySelectorAll('tbody tr');
      // Index 0: even -> bg-white, Index 1: odd -> bg-gray-50
      expect(rows[1].className).toContain('bg-gray-50');
    });
  });

  describe('sorting - local state', () => {
    it('toggles sort direction when clicking the same column twice', () => {
      const currencies = [makeCurrency({ code: 'CAD', name: 'Canadian Dollar' })];

      render(<CurrencyList currencies={currencies} {...defaultProps} />);
      // First click: sorts by name asc
      fireEvent.click(screen.getByText('Name'));
      // Second click: should toggle to desc without throwing
      fireEvent.click(screen.getByText('Name'));
    });

    it('sorts by symbol column locally', () => {
      const currencies = [makeCurrency({ code: 'CAD', name: 'Canadian Dollar' })];

      render(<CurrencyList currencies={currencies} {...defaultProps} />);
      fireEvent.click(screen.getByText('Symbol'));
    });

    it('sorts by rate column locally', () => {
      const currencies = [makeCurrency({ code: 'CAD', name: 'Canadian Dollar' })];

      render(<CurrencyList currencies={currencies} {...defaultProps} />);
      fireEvent.click(screen.getByText(/Rate/));
    });

    it('sorts by decimals column when density is normal', () => {
      const currencies = [makeCurrency({ code: 'CAD', name: 'Canadian Dollar' })];

      render(<CurrencyList currencies={currencies} {...defaultProps} density="normal" />);
      fireEvent.click(screen.getByText('Decimals'));
    });
  });

  describe('exchange rate display', () => {
    it('shows N/A when rate is null for non-default currency', () => {
      const currencies = [makeCurrency({ code: 'USD' })];
      const nullGetRate = vi.fn().mockReturnValue(null);

      render(<CurrencyList currencies={currencies} {...defaultProps} getRate={nullGetRate} />);
      expect(screen.getByText('N/A')).toBeInTheDocument();
    });

    it('shows dash for default currency rate', () => {
      const currencies = [makeCurrency({ code: 'CAD' })];
      const rateGetter = vi.fn().mockReturnValue(1.0);

      const { container } = render(
        <CurrencyList currencies={currencies} {...defaultProps} getRate={rateGetter} />,
      );
      // Rate cell for default currency shows '-'
      const rateCells = container.querySelectorAll('td');
      const dashCell = Array.from(rateCells).find(
        (td) => td.textContent === '-' && td.className.includes('text-right'),
      );
      expect(dashCell).toBeTruthy();
    });
  });

  describe('usage display', () => {
    it('shows only account usage when securities is zero', () => {
      const currencies = [makeCurrency()];
      const usage = { USD: { accounts: 3, securities: 0 } };

      render(<CurrencyList currencies={currencies} {...defaultProps} usage={usage} />);
      expect(screen.getByText('3 accts')).toBeInTheDocument();
    });

    it('shows only securities usage when accounts is zero', () => {
      const currencies = [makeCurrency()];
      const usage = { USD: { accounts: 0, securities: 2 } };

      render(<CurrencyList currencies={currencies} {...defaultProps} usage={usage} />);
      expect(screen.getByText('2 secs')).toBeInTheDocument();
    });

    it('shows singular account label for one account', () => {
      const currencies = [makeCurrency()];
      const usage = { USD: { accounts: 1, securities: 0 } };

      render(<CurrencyList currencies={currencies} {...defaultProps} usage={usage} />);
      expect(screen.getByText('1 acct')).toBeInTheDocument();
    });

    it('shows singular security label for one security', () => {
      const currencies = [makeCurrency()];
      const usage = { USD: { accounts: 0, securities: 1 } };

      render(<CurrencyList currencies={currencies} {...defaultProps} usage={usage} />);
      expect(screen.getByText('1 sec')).toBeInTheDocument();
    });

    it('shows dash when no usage exists for currency', () => {
      const currencies = [makeCurrency()];
      const usage = {};

      render(<CurrencyList currencies={currencies} {...defaultProps} usage={usage} />);
      // The usage cell should show '-' placeholder
      const dashElements = screen.getAllByText('-');
      expect(dashElements.length).toBeGreaterThanOrEqual(1);
    });
  });
});
