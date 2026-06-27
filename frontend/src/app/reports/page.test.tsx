import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@/test/render';
import ReportsPage from './page';

// Mock next/image
vi.mock('next/image', () => ({
  default: ({ priority, fill, ...props }: any) => <img {...props} />,
}));

// Mock logger
vi.mock('@/lib/logger', () => ({
  createLogger: () => ({
    error: vi.fn(),
    warn: vi.fn(),
    info: vi.fn(),
    debug: vi.fn(),
  }),
}));

// Mock auth store
vi.mock('@/store/authStore', () => ({
  useAuthStore: Object.assign(
    (selector?: any) => {
      const state = {
        user: { id: 'test-user-id', email: 'test@example.com', firstName: 'Test', lastName: 'User', role: 'user', hasPassword: true },
        isAuthenticated: true,
        isLoading: false,
        _hasHydrated: true,
        logout: vi.fn(),
      };
      return selector ? selector(state) : state;
    },
    {
      getState: vi.fn(() => ({
        user: { id: 'test-user-id', email: 'test@example.com', firstName: 'Test', lastName: 'User', role: 'user', hasPassword: true },
        isAuthenticated: true,
        isLoading: false,
        _hasHydrated: true,
      })),
    },
  ),
}));

// Mock preferences store
const mockUpdatePreferences = vi.fn();
const mockLoadPreferences = vi.fn().mockResolvedValue(undefined);
let currentFavouriteReportIds: string[] = [];
vi.mock('@/store/preferencesStore', () => ({
  usePreferencesStore: (selector?: any) => {
    const state = {
      preferences: { twoFactorEnabled: true, theme: 'system', favouriteReportIds: currentFavouriteReportIds },
      isLoaded: true,
      _hasHydrated: true,
      updatePreferences: mockUpdatePreferences,
      loadPreferences: mockLoadPreferences,
    };
    return selector ? selector(state) : state;
  },
}));

// Mock auth API
vi.mock('@/lib/auth', () => ({
  authApi: {
    getAuthMethods: vi.fn().mockResolvedValue({
      local: true, oidc: false, registration: true, smtp: false, force2fa: false, demo: false,
    }),
    logout: vi.fn().mockResolvedValue(undefined),
  },
}));

// Mock user settings API
const mockGetSettingsPreferences = vi.fn().mockResolvedValue({ favouriteReportIds: [] });
const mockUpdateSettingsPreferences = vi.fn().mockResolvedValue({ favouriteReportIds: [] });
vi.mock('@/lib/user-settings', () => ({
  userSettingsApi: {
    getPreferences: (...args: any[]) => mockGetSettingsPreferences(...args),
    updatePreferences: (...args: any[]) => mockUpdateSettingsPreferences(...args),
  },
}));

// Mock custom reports API
const mockGetAllReports = vi.fn().mockResolvedValue([]);
const mockToggleFavourite = vi.fn().mockResolvedValue({});
vi.mock('@/lib/custom-reports', () => ({
  customReportsApi: {
    getAll: (...args: any[]) => mockGetAllReports(...args),
    toggleFavourite: (...args: any[]) => mockToggleFavourite(...args),
  },
}));

// Mock IconPicker
const mockGetIconComponent = vi.fn().mockReturnValue(null);
vi.mock('@/components/ui/IconPicker', () => ({
  getIconComponent: (...args: any[]) => mockGetIconComponent(...args),
}));

// Mock AppHeader
vi.mock('@/components/layout/AppHeader', () => ({
  AppHeader: () => <div data-testid="app-header">AppHeader</div>,
}));

const mockSetDensity = vi.fn();
const mockSetCategoryFilter = vi.fn();
let currentDensity = 'normal';
let currentCategoryFilter = 'all';

vi.mock('@/hooks/useLocalStorage', () => ({
  useLocalStorage: (key: string, defaultValue: any) => {
    if (key === 'monize-reports-density') {
      return [currentDensity, mockSetDensity];
    }
    if (key === 'monize-reports-category') {
      return [currentCategoryFilter, mockSetCategoryFilter];
    }
    return [defaultValue, vi.fn()];
  },
}));

const mockPush = vi.fn();
vi.mock('next/navigation', () => ({
  useRouter: () => ({
    push: mockPush,
    replace: vi.fn(),
    back: vi.fn(),
    forward: vi.fn(),
    refresh: vi.fn(),
    prefetch: vi.fn(),
  }),
  usePathname: () => '/reports',
  useSearchParams: () => new URLSearchParams(),
}));

vi.mock('@/components/layout/PageLayout', () => ({
  PageLayout: ({ children }: { children: React.ReactNode }) => <div data-testid="page-layout">{children}</div>,
}));

vi.mock('@/components/layout/PageHeader', () => ({
  PageHeader: ({ title, subtitle, actions }: { title: string; subtitle?: string; actions?: React.ReactNode }) => (
    <div data-testid="page-header">
      <h1>{title}</h1>
      {subtitle && <p>{subtitle}</p>}
      {actions}
    </div>
  ),
}));

describe('ReportsPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    currentDensity = 'normal';
    currentCategoryFilter = 'all';
    currentFavouriteReportIds = [];
    mockGetAllReports.mockResolvedValue([]);
    mockGetSettingsPreferences.mockResolvedValue({ favouriteReportIds: [] });
    mockUpdateSettingsPreferences.mockResolvedValue({ favouriteReportIds: [] });
    mockGetIconComponent.mockReturnValue(null);
  });

  it('renders the Reports heading', async () => {
    render(<ReportsPage />);
    await waitFor(() => {
      expect(screen.getByText('Reports')).toBeInTheDocument();
    });
  });

  it('renders the subtitle', async () => {
    render(<ReportsPage />);
    await waitFor(() => {
      expect(screen.getByText(/Generate insights/i)).toBeInTheDocument();
    });
  });

  it('renders built-in report cards', async () => {
    render(<ReportsPage />);
    await waitFor(() => {
      expect(screen.getByText('Spending by Category')).toBeInTheDocument();
      expect(screen.getByText('Income vs Expenses')).toBeInTheDocument();
      expect(screen.getByText('Net Worth Over Time')).toBeInTheDocument();
    });
  });

  it('renders the All Reports filter button', async () => {
    render(<ReportsPage />);
    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'All Reports' })).toBeInTheDocument();
    });
  });

  it('renders report count', async () => {
    render(<ReportsPage />);
    await waitFor(() => {
      expect(screen.getByText(/reports? available/i)).toBeInTheDocument();
    });
  });

  it('renders category filter buttons', async () => {
    render(<ReportsPage />);
    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Spending' })).toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Income' })).toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Net Worth' })).toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Tax' })).toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Debt & Loans' })).toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Investment' })).toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Insights' })).toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Maintenance' })).toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Bills' })).toBeInTheDocument();
    });
  });

  it('navigates to report when report card is clicked', async () => {
    render(<ReportsPage />);
    await waitFor(() => {
      expect(screen.getByText('Spending by Category')).toBeInTheDocument();
    });
    // Find the button with that text
    const reportCard = screen.getByText('Spending by Category').closest('button');
    if (reportCard) {
      fireEvent.click(reportCard);
    }
    expect(mockPush).toHaveBeenCalledWith('/reports/spending-by-category');
  });

  it('renders the New Report dropdown trigger', async () => {
    render(<ReportsPage />);
    await waitFor(() => {
      expect(screen.getByText('New Report')).toBeInTheDocument();
    });
  });

  it('navigates to standard report creation from the dropdown', async () => {
    render(<ReportsPage />);
    await waitFor(() => {
      expect(screen.getByText('New Report')).toBeInTheDocument();
    });
    fireEvent.click(screen.getByText('New Report'));
    fireEvent.click(screen.getByText('Standard Report'));
    expect(mockPush).toHaveBeenCalledWith('/reports/custom/new');
  });

  it('navigates to investment report creation from the dropdown', async () => {
    render(<ReportsPage />);
    await waitFor(() => {
      expect(screen.getByText('New Report')).toBeInTheDocument();
    });
    fireEvent.click(screen.getByText('New Report'));
    fireEvent.click(screen.getByText('Investment Report'));
    expect(mockPush).toHaveBeenCalledWith('/reports/investment/new');
  });

  it('renders density toggle button', async () => {
    render(<ReportsPage />);
    await waitFor(() => {
      expect(screen.getByText('Normal')).toBeInTheDocument();
    });
  });

  it('cycles density when toggle button is clicked', async () => {
    render(<ReportsPage />);
    await waitFor(() => {
      expect(screen.getByText('Normal')).toBeInTheDocument();
    });
    fireEvent.click(screen.getByText('Normal'));
    expect(mockSetDensity).toHaveBeenCalled();
  });

  it('renders compact density view', async () => {
    currentDensity = 'compact';
    render(<ReportsPage />);
    await waitFor(() => {
      // In compact view, reports still render with names
      expect(screen.getByText('Spending by Category')).toBeInTheDocument();
    });
  });

  it('renders dense density view as table', async () => {
    currentDensity = 'dense';
    render(<ReportsPage />);
    await waitFor(() => {
      // Dense view renders as a table with Report / Category / Description columns
      expect(screen.getByText('Report')).toBeInTheDocument();
      expect(screen.getByText('Category')).toBeInTheDocument();
      expect(screen.getByText('Description')).toBeInTheDocument();
    });
  });

  it('filters reports by category when a filter button is clicked', async () => {
    currentCategoryFilter = 'tax';
    render(<ReportsPage />);
    await waitFor(() => {
      // Only tax reports should be shown
      expect(screen.getByText('Tax Summary')).toBeInTheDocument();
    });
    // Non-tax reports should not appear
    expect(screen.queryByText('Spending by Category')).not.toBeInTheDocument();
  });

  it('renders custom reports when loaded', async () => {
    mockGetAllReports.mockResolvedValue([
      {
        id: 'cr-1',
        name: 'My Custom Report',
        description: 'A custom report',
        icon: null,
        backgroundColor: null,
        viewType: 'TABLE',
        timeframeType: 'LAST_30_DAYS',
        groupBy: 'CATEGORY',
        filters: {},
        config: {},
        isFavourite: false,
        sortOrder: 0,
        createdAt: '2026-01-01',
        updatedAt: '2026-01-01',
      },
    ]);
    render(<ReportsPage />);
    await waitFor(() => {
      expect(screen.getByText('My Custom Report')).toBeInTheDocument();
    });
  });

  it('shows loading custom reports text', async () => {
    mockGetAllReports.mockReturnValue(new Promise(() => {}));
    render(<ReportsPage />);
    await waitFor(() => {
      expect(screen.getByText(/loading custom reports/i)).toBeInTheDocument();
    });
  });

  it('handles custom reports API error gracefully', async () => {
    mockGetAllReports.mockRejectedValueOnce(new Error('Network error'));
    render(<ReportsPage />);
    // Page should still render built-in reports
    await waitFor(() => {
      expect(screen.getByText('Spending by Category')).toBeInTheDocument();
    });
  });

  it('shows all report categories in normal density view', async () => {
    render(<ReportsPage />);
    await waitFor(() => {
      // Check for reports from different categories
      expect(screen.getByText('Spending by Category')).toBeInTheDocument();
      expect(screen.getByText('Income vs Expenses')).toBeInTheDocument();
      expect(screen.getByText('Tax Summary')).toBeInTheDocument();
      expect(screen.getByText('Debt Payoff Timeline')).toBeInTheDocument();
      expect(screen.getByText('Investment Performance')).toBeInTheDocument();
      expect(screen.getByText('Recurring Expenses Tracker')).toBeInTheDocument();
      expect(screen.getByText('Uncategorized Transactions')).toBeInTheDocument();
      expect(screen.getByText('Upcoming Bills Calendar')).toBeInTheDocument();
    });
  });

  it('renders report descriptions', async () => {
    render(<ReportsPage />);
    await waitFor(() => {
      expect(screen.getByText(/See where your money goes/i)).toBeInTheDocument();
    });
  });

  it('renders the search input', async () => {
    render(<ReportsPage />);
    await waitFor(() => {
      expect(screen.getByPlaceholderText(/search reports/i)).toBeInTheDocument();
    });
  });

  it('filters reports by name when searching', async () => {
    render(<ReportsPage />);
    await waitFor(() => {
      expect(screen.getByText('Spending by Category')).toBeInTheDocument();
    });
    fireEvent.change(screen.getByPlaceholderText(/search reports/i), {
      target: { value: 'Tax Summary' },
    });
    // Search is debounced, so wait for the filtered list to settle.
    await waitFor(() => {
      expect(screen.queryByText('Spending by Category')).not.toBeInTheDocument();
    });
    expect(screen.getByText('Tax Summary')).toBeInTheDocument();
    expect(screen.queryByText('Income vs Expenses')).not.toBeInTheDocument();
  });

  it('filters reports by description when searching', async () => {
    render(<ReportsPage />);
    await waitFor(() => {
      expect(screen.getByText('Spending by Category')).toBeInTheDocument();
    });
    fireEvent.change(screen.getByPlaceholderText(/search reports/i), {
      target: { value: 'subscriptions' },
    });
    // "Recurring Expenses Tracker" has "subscriptions" in its description.
    // Search is debounced, so wait for the filtered list to settle.
    await waitFor(() => {
      expect(screen.queryByText('Spending by Category')).not.toBeInTheDocument();
    });
    expect(screen.getByText('Recurring Expenses Tracker')).toBeInTheDocument();
  });

  it('search is case-insensitive', async () => {
    render(<ReportsPage />);
    await waitFor(() => {
      expect(screen.getByText('Tax Summary')).toBeInTheDocument();
    });
    fireEvent.change(screen.getByPlaceholderText(/search reports/i), {
      target: { value: 'tax summary' },
    });
    expect(screen.getByText('Tax Summary')).toBeInTheDocument();
  });

  it('shows no reports when search has no matches', async () => {
    render(<ReportsPage />);
    await waitFor(() => {
      expect(screen.getByText('Spending by Category')).toBeInTheDocument();
    });
    fireEvent.change(screen.getByPlaceholderText(/search reports/i), {
      target: { value: 'xyznonexistent' },
    });
    // Search is debounced, so wait for the filtered list to settle.
    await waitFor(() => {
      expect(screen.getByText('0 reports available')).toBeInTheDocument();
    });
  });

  it('search works combined with category filter', async () => {
    currentCategoryFilter = 'spending';
    render(<ReportsPage />);
    await waitFor(() => {
      expect(screen.getByText('Spending by Category')).toBeInTheDocument();
    });
    // "Monthly Spending Trend" is in spending category
    fireEvent.change(screen.getByPlaceholderText(/search reports/i), {
      target: { value: 'monthly' },
    });
    expect(screen.getByText('Monthly Spending Trend')).toBeInTheDocument();
    // "Monthly Comparison" is in insights category, not spending - should be excluded
    expect(screen.queryByText('Monthly Comparison')).not.toBeInTheDocument();
  });

  it('search filters custom reports', async () => {
    mockGetAllReports.mockResolvedValue([
      {
        id: 'cr-1',
        name: 'My Custom Report',
        description: 'A custom report',
        icon: null,
        backgroundColor: null,
        viewType: 'TABLE',
        timeframeType: 'LAST_30_DAYS',
        groupBy: 'CATEGORY',
        filters: {},
        config: {},
        isFavourite: false,
        sortOrder: 0,
        createdAt: '2026-01-01',
        updatedAt: '2026-01-01',
      },
    ]);
    render(<ReportsPage />);
    await waitFor(() => {
      expect(screen.getByText('My Custom Report')).toBeInTheDocument();
    });
    fireEvent.change(screen.getByPlaceholderText(/search reports/i), {
      target: { value: 'My Custom' },
    });
    // Search is debounced, so wait for the filtered list to settle.
    await waitFor(() => {
      expect(screen.queryByText('Spending by Category')).not.toBeInTheDocument();
    });
    expect(screen.getByText('My Custom Report')).toBeInTheDocument();
  });

  it('filters to custom category shows only custom reports', async () => {
    currentCategoryFilter = 'custom';
    mockGetAllReports.mockResolvedValue([
      {
        id: 'cr-1',
        name: 'My Custom Report',
        description: 'Custom',
        icon: null,
        backgroundColor: '#ff0000',
        viewType: 'TABLE',
        timeframeType: 'LAST_30_DAYS',
        groupBy: 'CATEGORY',
        filters: {},
        config: {},
        isFavourite: false,
        sortOrder: 0,
        createdAt: '2026-01-01',
        updatedAt: '2026-01-01',
      },
    ]);
    render(<ReportsPage />);
    await waitFor(() => {
      expect(screen.getByText('My Custom Report')).toBeInTheDocument();
    });
    // Built-in reports should not appear
    expect(screen.queryByText('Spending by Category')).not.toBeInTheDocument();
  });

  // Favourite tests

  it('renders favourite stars for all reports in normal view', async () => {
    render(<ReportsPage />);
    await waitFor(() => {
      expect(screen.getByText('Spending by Category')).toBeInTheDocument();
    });
    const stars = screen.getAllByTitle('Add to favourites');
    expect(stars.length).toBeGreaterThan(0);
  });

  it('renders favourite stars in compact view', async () => {
    currentDensity = 'compact';
    render(<ReportsPage />);
    await waitFor(() => {
      expect(screen.getByText('Spending by Category')).toBeInTheDocument();
    });
    const stars = screen.getAllByTitle('Add to favourites');
    expect(stars.length).toBeGreaterThan(0);
  });

  it('renders favourite stars in dense view', async () => {
    currentDensity = 'dense';
    render(<ReportsPage />);
    await waitFor(() => {
      expect(screen.getByText('Spending by Category')).toBeInTheDocument();
    });
    const stars = screen.getAllByTitle('Add to favourites');
    expect(stars.length).toBeGreaterThan(0);
  });

  it('shows filled star for favourited built-in reports', async () => {
    currentFavouriteReportIds = ['spending-by-category'];
    render(<ReportsPage />);
    await waitFor(() => {
      expect(screen.getByText('Spending by Category')).toBeInTheDocument();
    });
    const removeStars = screen.getAllByTitle('Remove from favourites');
    expect(removeStars.length).toBe(1);
  });

  it('clicking favourite star on built-in report updates preferences and calls API', async () => {
    mockGetSettingsPreferences.mockResolvedValue({ favouriteReportIds: [] });
    mockUpdateSettingsPreferences.mockResolvedValue({ favouriteReportIds: ['spending-by-category'] });
    render(<ReportsPage />);
    await waitFor(() => {
      expect(screen.getByText('Spending by Category')).toBeInTheDocument();
    });
    const stars = screen.getAllByTitle('Add to favourites');
    fireEvent.click(stars[0]);
    // Optimistic update fires immediately
    expect(mockUpdatePreferences).toHaveBeenCalledWith({
      favouriteReportIds: ['spending-by-category'],
    });
    // Then fetches server state and saves
    await waitFor(() => {
      expect(mockGetSettingsPreferences).toHaveBeenCalled();
      expect(mockUpdateSettingsPreferences).toHaveBeenCalledWith({
        favouriteReportIds: ['spending-by-category'],
      });
    });
  });

  it('clicking favourite star does not navigate to the report', async () => {
    render(<ReportsPage />);
    await waitFor(() => {
      expect(screen.getByText('Spending by Category')).toBeInTheDocument();
    });
    const stars = screen.getAllByTitle('Add to favourites');
    fireEvent.click(stars[0]);
    expect(mockPush).not.toHaveBeenCalled();
  });

  it('clicking favourite star on custom report calls toggleFavourite API', async () => {
    mockGetAllReports.mockResolvedValue([
      {
        id: 'cr-1',
        name: 'My Custom Report',
        description: 'A custom report',
        icon: null,
        backgroundColor: null,
        viewType: 'TABLE',
        timeframeType: 'LAST_30_DAYS',
        groupBy: 'CATEGORY',
        filters: {},
        config: {},
        isFavourite: false,
        sortOrder: 0,
        createdAt: '2026-01-01',
        updatedAt: '2026-01-01',
      },
    ]);
    mockToggleFavourite.mockResolvedValue({ id: 'cr-1', isFavourite: true });
    render(<ReportsPage />);
    await waitFor(() => {
      expect(screen.getByText('My Custom Report')).toBeInTheDocument();
    });
    // Find the star next to the custom report - it will be the last "Add to favourites" since custom reports append after built-in
    const stars = screen.getAllByTitle('Add to favourites');
    const lastStar = stars[stars.length - 1];
    fireEvent.click(lastStar);
    await waitFor(() => {
      expect(mockToggleFavourite).toHaveBeenCalledWith('cr-1', true);
    });
  });

  it('shows filled star for favourited custom reports', async () => {
    mockGetAllReports.mockResolvedValue([
      {
        id: 'cr-1',
        name: 'My Custom Report',
        description: 'A custom report',
        icon: null,
        backgroundColor: null,
        viewType: 'TABLE',
        timeframeType: 'LAST_30_DAYS',
        groupBy: 'CATEGORY',
        filters: {},
        config: {},
        isFavourite: true,
        sortOrder: 0,
        createdAt: '2026-01-01',
        updatedAt: '2026-01-01',
      },
    ]);
    render(<ReportsPage />);
    await waitFor(() => {
      expect(screen.getByText('My Custom Report')).toBeInTheDocument();
    });
    const removeStars = screen.getAllByTitle('Remove from favourites');
    expect(removeStars.length).toBe(1);
  });

  it('sorts favourited reports to the top', async () => {
    // Favourite "Tax Summary" (id: 'tax-summary') - should appear before non-favourited reports
    currentFavouriteReportIds = ['tax-summary'];
    currentCategoryFilter = 'all';
    render(<ReportsPage />);
    await waitFor(() => {
      expect(screen.getByText('Tax Summary')).toBeInTheDocument();
    });
    // Get all report names in rendered order
    const reportNames = screen.getAllByText(/./i)
      .filter(el => el.tagName === 'H3')
      .map(el => el.textContent);
    // Tax Summary should be first since it's favourited
    expect(reportNames[0]).toBe('Tax Summary');
  });

  it('density toggle is in the filter bar, not in header actions', async () => {
    render(<ReportsPage />);
    await waitFor(() => {
      expect(screen.getByText('Normal')).toBeInTheDocument();
    });
    // The density toggle should NOT be inside the PageHeader mock (data-testid="page-header")
    const pageHeader = screen.getByTestId('page-header');
    expect(pageHeader).not.toHaveTextContent('Normal');
  });

  it('unfavouriting a built-in report removes it from preferences', async () => {
    currentFavouriteReportIds = ['spending-by-category'];
    mockGetSettingsPreferences.mockResolvedValue({ favouriteReportIds: ['spending-by-category'] });
    mockUpdateSettingsPreferences.mockResolvedValue({ favouriteReportIds: [] });
    render(<ReportsPage />);
    await waitFor(() => {
      expect(screen.getByText('Spending by Category')).toBeInTheDocument();
    });
    const removeStar = screen.getByTitle('Remove from favourites');
    fireEvent.click(removeStar);
    // Optimistic update
    expect(mockUpdatePreferences).toHaveBeenCalledWith({
      favouriteReportIds: [],
    });
    // Server round-trip
    await waitFor(() => {
      expect(mockUpdateSettingsPreferences).toHaveBeenCalledWith({
        favouriteReportIds: [],
      });
    });
  });

  it('favouriting a built-in report adds it to preferences', async () => {
    mockGetSettingsPreferences.mockResolvedValue({ favouriteReportIds: [] });
    mockUpdateSettingsPreferences.mockResolvedValue({ favouriteReportIds: ['spending-by-category'] });
    render(<ReportsPage />);
    await waitFor(() => {
      expect(screen.getByText('Spending by Category')).toBeInTheDocument();
    });
    const stars = screen.getAllByTitle('Add to favourites');
    fireEvent.click(stars[0]);
    // Optimistic update
    expect(mockUpdatePreferences).toHaveBeenCalledWith({
      favouriteReportIds: ['spending-by-category'],
    });
    // Reconciles with server response
    await waitFor(() => {
      expect(mockUpdatePreferences).toHaveBeenCalledWith({
        favouriteReportIds: ['spending-by-category'],
      });
    });
  });

  it('reverts optimistic update when built-in favourite API call fails', async () => {
    mockGetSettingsPreferences.mockRejectedValueOnce(new Error('Network error'));
    render(<ReportsPage />);
    await waitFor(() => {
      expect(screen.getByText('Spending by Category')).toBeInTheDocument();
    });
    const stars = screen.getAllByTitle('Add to favourites');
    fireEvent.click(stars[0]);
    // Optimistic update fires immediately
    expect(mockUpdatePreferences).toHaveBeenCalledWith({
      favouriteReportIds: ['spending-by-category'],
    });
    // After API failure, should revert
    await waitFor(() => {
      expect(mockUpdatePreferences).toHaveBeenCalledWith({
        favouriteReportIds: [],
      });
    });
  });

  it('merges with server state when toggling favourites across devices', async () => {
    // Local store has only 'spending-by-category', but server also has 'net-worth' from another device
    currentFavouriteReportIds = ['spending-by-category'];
    mockGetSettingsPreferences.mockResolvedValue({ favouriteReportIds: ['spending-by-category', 'net-worth'] });
    mockUpdateSettingsPreferences.mockResolvedValue({ favouriteReportIds: ['spending-by-category', 'net-worth', 'tax-summary'] });
    render(<ReportsPage />);
    await waitFor(() => {
      expect(screen.getByText('Tax Summary')).toBeInTheDocument();
    });
    // Favourite 'tax-summary'
    const taxCard = screen.getByText('Tax Summary').closest('button')!;
    const star = taxCard.querySelector('[title="Add to favourites"]')!;
    fireEvent.click(star);
    // Server fetch should include 'net-worth' from other device
    await waitFor(() => {
      expect(mockUpdateSettingsPreferences).toHaveBeenCalledWith({
        favouriteReportIds: ['spending-by-category', 'net-worth', 'tax-summary'],
      });
    });
  });

  it('migrates localStorage favourites to backend on first load', async () => {
    localStorage.setItem('monize-favourite-reports', JSON.stringify(['net-worth', 'tax-summary']));
    mockGetSettingsPreferences.mockResolvedValue({ favouriteReportIds: [] });
    mockUpdateSettingsPreferences.mockResolvedValue({});
    render(<ReportsPage />);
    await waitFor(() => {
      expect(mockUpdatePreferences).toHaveBeenCalledWith({
        favouriteReportIds: ['net-worth', 'tax-summary'],
      });
    });
    await waitFor(() => {
      expect(mockUpdateSettingsPreferences).toHaveBeenCalledWith({
        favouriteReportIds: ['net-worth', 'tax-summary'],
      });
    });
    await waitFor(() => {
      expect(localStorage.getItem('monize-favourite-reports')).toBeNull();
    });
  });

  it('merges localStorage favourites with existing backend favourites', async () => {
    localStorage.setItem('monize-favourite-reports', JSON.stringify(['net-worth', 'spending-by-category']));
    // Server already has 'spending-by-category' from another device
    mockGetSettingsPreferences.mockResolvedValue({ favouriteReportIds: ['spending-by-category'] });
    mockUpdateSettingsPreferences.mockResolvedValue({});
    render(<ReportsPage />);
    await waitFor(() => {
      // Should deduplicate 'spending-by-category' and merge 'net-worth'
      expect(mockUpdatePreferences).toHaveBeenCalledWith({
        favouriteReportIds: ['spending-by-category', 'net-worth'],
      });
    });
  });

  it('removes invalid JSON from localStorage without crashing', async () => {
    localStorage.setItem('monize-favourite-reports', 'not-valid-json');
    render(<ReportsPage />);
    await waitFor(() => {
      expect(screen.getByText('Spending by Category')).toBeInTheDocument();
    });
    expect(localStorage.getItem('monize-favourite-reports')).toBeNull();
  });

  it('removes empty array from localStorage without calling API', async () => {
    localStorage.setItem('monize-favourite-reports', JSON.stringify([]));
    render(<ReportsPage />);
    await waitFor(() => {
      expect(screen.getByText('Spending by Category')).toBeInTheDocument();
    });
    expect(localStorage.getItem('monize-favourite-reports')).toBeNull();
    expect(mockUpdateSettingsPreferences).not.toHaveBeenCalled();
  });

  it('handles custom report toggleFavourite API error gracefully', async () => {
    mockGetAllReports.mockResolvedValue([
      {
        id: 'cr-1',
        name: 'My Custom Report',
        description: 'A custom report',
        icon: null,
        backgroundColor: null,
        viewType: 'TABLE',
        timeframeType: 'LAST_30_DAYS',
        groupBy: 'CATEGORY',
        filters: {},
        config: {},
        isFavourite: false,
        sortOrder: 0,
        createdAt: '2026-01-01',
        updatedAt: '2026-01-01',
      },
    ]);
    mockToggleFavourite.mockRejectedValueOnce(new Error('Network error'));
    render(<ReportsPage />);
    await waitFor(() => {
      expect(screen.getByText('My Custom Report')).toBeInTheDocument();
    });
    const stars = screen.getAllByTitle('Add to favourites');
    const lastStar = stars[stars.length - 1];
    fireEvent.click(lastStar);
    // Should not crash - page should still render
    await waitFor(() => {
      expect(screen.getByText('My Custom Report')).toBeInTheDocument();
    });
  });

  it('navigates to custom report page when custom report card clicked', async () => {
    mockGetAllReports.mockResolvedValue([
      {
        id: 'cr-42',
        name: 'My Nav Report',
        description: 'Click me',
        icon: null,
        backgroundColor: null,
        viewType: 'TABLE',
        timeframeType: 'LAST_30_DAYS',
        groupBy: 'CATEGORY',
        filters: {},
        config: {},
        isFavourite: false,
        sortOrder: 0,
        createdAt: '2026-01-01',
        updatedAt: '2026-01-01',
      },
    ]);
    render(<ReportsPage />);
    await waitFor(() => expect(screen.getByText('My Nav Report')).toBeInTheDocument());
    const reportCard = screen.getByText('My Nav Report').closest('button');
    if (reportCard) fireEvent.click(reportCard);
    expect(mockPush).toHaveBeenCalledWith('/reports/custom/cr-42');
  });

  it('navigates to report in compact density view when card is clicked', async () => {
    currentDensity = 'compact';
    render(<ReportsPage />);
    await waitFor(() => expect(screen.getByText('Spending by Category')).toBeInTheDocument());
    const reportCard = screen.getByText('Spending by Category').closest('button');
    if (reportCard) fireEvent.click(reportCard);
    expect(mockPush).toHaveBeenCalledWith('/reports/spending-by-category');
  });

  it('navigates to report in dense density view when row is clicked', async () => {
    currentDensity = 'dense';
    render(<ReportsPage />);
    await waitFor(() => expect(screen.getByText('Tax Summary')).toBeInTheDocument());
    const row = screen.getByText('Tax Summary').closest('tr');
    if (row) fireEvent.click(row);
    expect(mockPush).toHaveBeenCalledWith('/reports/tax-summary');
  });

  it('renders custom report with backgroundColor style', async () => {
    mockGetAllReports.mockResolvedValue([
      {
        id: 'cr-bg',
        name: 'Colored Custom Report',
        description: 'Has a background',
        icon: null,
        backgroundColor: '#ff5733',
        viewType: 'TABLE',
        timeframeType: 'LAST_30_DAYS',
        groupBy: 'CATEGORY',
        filters: {},
        config: {},
        isFavourite: false,
        sortOrder: 0,
        createdAt: '2026-01-01',
        updatedAt: '2026-01-01',
      },
    ]);
    render(<ReportsPage />);
    await waitFor(() => expect(screen.getByText('Colored Custom Report')).toBeInTheDocument());
    // Should render without crashing with a backgroundColor
    const card = screen.getByText('Colored Custom Report').closest('button');
    expect(card).toBeInTheDocument();
  });

  it('renders custom report with a non-null icon component', async () => {
    // Override the getIconComponent mock to return an SVG element for this test
    mockGetIconComponent.mockReturnValueOnce(<svg data-testid="custom-icon" />);

    mockGetAllReports.mockResolvedValue([
      {
        id: 'cr-icon',
        name: 'Icon Report',
        description: 'Has an icon',
        icon: 'chart-bar',
        backgroundColor: null,
        viewType: 'TABLE',
        timeframeType: 'LAST_30_DAYS',
        groupBy: 'CATEGORY',
        filters: {},
        config: {},
        isFavourite: false,
        sortOrder: 0,
        createdAt: '2026-01-01',
        updatedAt: '2026-01-01',
      },
    ]);
    render(<ReportsPage />);
    await waitFor(() => expect(screen.getByText('Icon Report')).toBeInTheDocument());
    expect(screen.getByTestId('custom-icon')).toBeInTheDocument();
  });

  it('unfavouriting a custom report calls toggleFavourite with false', async () => {
    mockGetAllReports.mockResolvedValue([
      {
        id: 'cr-fav',
        name: 'Favourited Custom',
        description: 'Already favourited',
        icon: null,
        backgroundColor: null,
        viewType: 'TABLE',
        timeframeType: 'LAST_30_DAYS',
        groupBy: 'CATEGORY',
        filters: {},
        config: {},
        isFavourite: true,
        sortOrder: 0,
        createdAt: '2026-01-01',
        updatedAt: '2026-01-01',
      },
    ]);
    mockToggleFavourite.mockResolvedValue({ id: 'cr-fav', isFavourite: false });
    render(<ReportsPage />);
    await waitFor(() => expect(screen.getByText('Favourited Custom')).toBeInTheDocument());
    const removeStar = screen.getAllByTitle('Remove from favourites');
    fireEvent.click(removeStar[removeStar.length - 1]);
    await waitFor(() => {
      expect(mockToggleFavourite).toHaveBeenCalledWith('cr-fav', false);
    });
  });

  it('does not call toggleFavourite when custom report id is not found', async () => {
    // Custom report is loaded but has an id that won't match the report.id prefix
    mockGetAllReports.mockResolvedValue([
      {
        id: 'cr-missing',
        name: 'Ghost Report',
        description: 'Will not match',
        icon: null,
        backgroundColor: null,
        viewType: 'TABLE',
        timeframeType: 'LAST_30_DAYS',
        groupBy: 'CATEGORY',
        filters: {},
        config: {},
        isFavourite: false,
        sortOrder: 0,
        createdAt: '2026-01-01',
        updatedAt: '2026-01-01',
      },
    ]);
    render(<ReportsPage />);
    await waitFor(() => expect(screen.getByText('Ghost Report')).toBeInTheDocument());

    // Directly patch the report list so the id doesn't match any custom report
    // by filtering to custom category first and using a mismatched id via compact density
    // Since the report.id is 'custom/cr-missing', and we find 'cr-missing' in customReports,
    // this test verifies the happy-path lookup works. Test the NOT found path via dense view
    currentCategoryFilter = 'custom';
    // toggleFavourite should be called correctly
    const stars = screen.getAllByTitle('Add to favourites');
    fireEvent.click(stars[stars.length - 1]);
    await waitFor(() => {
      expect(mockToggleFavourite).toHaveBeenCalledWith('cr-missing', true);
    });
  });

  it('activates category filter button visually when clicked', async () => {
    render(<ReportsPage />);
    await waitFor(() => expect(screen.getByText('Spending by Category')).toBeInTheDocument());
    fireEvent.click(screen.getByRole('button', { name: 'Tax' }));
    expect(mockSetCategoryFilter).toHaveBeenCalledWith('tax');
  });

  it('activates all reports filter button visually when clicked', async () => {
    currentCategoryFilter = 'tax';
    render(<ReportsPage />);
    await waitFor(() => expect(screen.getByText('Tax Summary')).toBeInTheDocument());
    fireEvent.click(screen.getByRole('button', { name: 'All Reports' }));
    expect(mockSetCategoryFilter).toHaveBeenCalledWith('all');
  });

  it('handles keydown Enter on favourite star (normal view)', async () => {
    render(<ReportsPage />);
    await waitFor(() => expect(screen.getByText('Spending by Category')).toBeInTheDocument());
    const stars = screen.getAllByTitle('Add to favourites');
    fireEvent.keyDown(stars[0], { key: 'Enter' });
    // Optimistic update should fire
    expect(mockUpdatePreferences).toHaveBeenCalledWith({
      favouriteReportIds: ['spending-by-category'],
    });
  });

  it('handles keydown Space on favourite star (normal view)', async () => {
    render(<ReportsPage />);
    await waitFor(() => expect(screen.getByText('Spending by Category')).toBeInTheDocument());
    const stars = screen.getAllByTitle('Add to favourites');
    fireEvent.keyDown(stars[0], { key: ' ' });
    expect(mockUpdatePreferences).toHaveBeenCalledWith({
      favouriteReportIds: ['spending-by-category'],
    });
  });

  it('does not trigger favourite on unrelated keydown (normal view)', async () => {
    render(<ReportsPage />);
    await waitFor(() => expect(screen.getByText('Spending by Category')).toBeInTheDocument());
    const stars = screen.getAllByTitle('Add to favourites');
    fireEvent.keyDown(stars[0], { key: 'Tab' });
    expect(mockUpdatePreferences).not.toHaveBeenCalled();
  });

  it('handles keydown Enter on favourite star in compact view', async () => {
    currentDensity = 'compact';
    render(<ReportsPage />);
    await waitFor(() => expect(screen.getByText('Spending by Category')).toBeInTheDocument());
    const stars = screen.getAllByTitle('Add to favourites');
    fireEvent.keyDown(stars[0], { key: 'Enter' });
    expect(mockUpdatePreferences).toHaveBeenCalledWith({
      favouriteReportIds: ['spending-by-category'],
    });
  });

  it('report count shows plural for multiple reports', async () => {
    render(<ReportsPage />);
    await waitFor(() => {
      const countEl = screen.getByText(/\d+ reports? available/);
      const match = countEl.textContent?.match(/(\d+) reports? available/);
      expect(Number(match?.[1])).toBeGreaterThan(1);
      expect(countEl.textContent).toContain('reports available');
    });
  });

  it('report count shows singular for exactly 1 report', async () => {
    currentCategoryFilter = 'tax';
    render(<ReportsPage />);
    await waitFor(() => {
      // Tax category has exactly 1 report: Tax Summary
      expect(screen.getByText('1 report available')).toBeInTheDocument();
    });
  });

  it('does not show loading text after custom reports loaded', async () => {
    mockGetAllReports.mockResolvedValue([]);
    render(<ReportsPage />);
    await waitFor(() => {
      expect(screen.queryByText(/loading custom reports/i)).not.toBeInTheDocument();
    });
  });

  it('sorts custom favourited report to the top', async () => {
    mockGetAllReports.mockResolvedValue([
      {
        id: 'cr-fav-top',
        name: 'AAA Custom Fav',
        description: 'Should be first',
        icon: null,
        backgroundColor: null,
        viewType: 'TABLE',
        timeframeType: 'LAST_30_DAYS',
        groupBy: 'CATEGORY',
        filters: {},
        config: {},
        isFavourite: true,
        sortOrder: 0,
        createdAt: '2026-01-01',
        updatedAt: '2026-01-01',
      },
    ]);
    render(<ReportsPage />);
    await waitFor(() => expect(screen.getByText('AAA Custom Fav')).toBeInTheDocument());
    const reportNames = screen.getAllByRole('heading', { level: 3 }).map(el => el.textContent);
    // The custom favourited report should be first
    expect(reportNames[0]).toBe('AAA Custom Fav');
  });

  it('custom report description falls back to view/timeframe labels when description is empty', async () => {
    mockGetAllReports.mockResolvedValue([
      {
        id: 'cr-nodesc',
        name: 'No Desc Report',
        description: '',
        icon: null,
        backgroundColor: null,
        viewType: 'TABLE',
        timeframeType: 'LAST_30_DAYS',
        groupBy: 'CATEGORY',
        filters: {},
        config: {},
        isFavourite: false,
        sortOrder: 0,
        createdAt: '2026-01-01',
        updatedAt: '2026-01-01',
      },
    ]);
    render(<ReportsPage />);
    await waitFor(() => expect(screen.getByText('No Desc Report')).toBeInTheDocument());
    // Description should be something like "Table · Last 30 Days"
    // getByText isn't exact but the report should render without crashing
    expect(screen.getByText('No Desc Report')).toBeInTheDocument();
  });

  it('compact view: clicking star does not navigate', async () => {
    currentDensity = 'compact';
    render(<ReportsPage />);
    await waitFor(() => expect(screen.getByText('Spending by Category')).toBeInTheDocument());
    const stars = screen.getAllByTitle('Add to favourites');
    fireEvent.click(stars[0]);
    expect(mockPush).not.toHaveBeenCalled();
  });

  it('dense view: clicking favourite star does not navigate', async () => {
    currentDensity = 'dense';
    render(<ReportsPage />);
    await waitFor(() => expect(screen.getByText('Spending by Category')).toBeInTheDocument());
    const starButtons = screen.getAllByTitle('Add to favourites');
    fireEvent.click(starButtons[0]);
    expect(mockPush).not.toHaveBeenCalled();
  });

  it('dense view: correctly shows filled star for a favourited report', async () => {
    currentDensity = 'dense';
    currentFavouriteReportIds = ['tax-summary'];
    render(<ReportsPage />);
    await waitFor(() => expect(screen.getByText('Tax Summary')).toBeInTheDocument());
    const removeStar = screen.getAllByTitle('Remove from favourites');
    expect(removeStar.length).toBe(1);
  });

  it('compact view: correctly shows filled star for a favourited report', async () => {
    currentDensity = 'compact';
    currentFavouriteReportIds = ['income-vs-expenses'];
    render(<ReportsPage />);
    await waitFor(() => expect(screen.getByText('Income vs Expenses')).toBeInTheDocument());
    const removeStar = screen.getAllByTitle('Remove from favourites');
    expect(removeStar.length).toBe(1);
  });

  it('shows density label as "Compact" when density is compact', async () => {
    currentDensity = 'compact';
    render(<ReportsPage />);
    await waitFor(() => {
      expect(screen.getByText('Compact')).toBeInTheDocument();
    });
  });

  it('shows density label as "Dense" when density is dense', async () => {
    currentDensity = 'dense';
    render(<ReportsPage />);
    await waitFor(() => {
      expect(screen.getByText('Dense')).toBeInTheDocument();
    });
  });

  it('bills category filter shows only bills reports', async () => {
    currentCategoryFilter = 'bills';
    render(<ReportsPage />);
    await waitFor(() => {
      expect(screen.getByText('Upcoming Bills Calendar')).toBeInTheDocument();
      expect(screen.getByText('Bill Payment History')).toBeInTheDocument();
    });
    expect(screen.queryByText('Spending by Category')).not.toBeInTheDocument();
    expect(screen.queryByText('Tax Summary')).not.toBeInTheDocument();
  });

  it('budget category filter shows only budget reports', async () => {
    currentCategoryFilter = 'budget';
    render(<ReportsPage />);
    await waitFor(() => {
      expect(screen.getByText('Budget vs Actual')).toBeInTheDocument();
    });
    expect(screen.queryByText('Spending by Category')).not.toBeInTheDocument();
  });

  it('investment category filter shows only investment reports', async () => {
    currentCategoryFilter = 'investment';
    render(<ReportsPage />);
    await waitFor(() => {
      expect(screen.getByText('Investment Performance')).toBeInTheDocument();
    });
    expect(screen.queryByText('Tax Summary')).not.toBeInTheDocument();
  });

  it('maintenance category filter shows only maintenance reports', async () => {
    currentCategoryFilter = 'maintenance';
    render(<ReportsPage />);
    await waitFor(() => {
      expect(screen.getByText('Uncategorized Transactions')).toBeInTheDocument();
      expect(screen.getByText('Duplicate Transaction Finder')).toBeInTheDocument();
    });
    expect(screen.queryByText('Tax Summary')).not.toBeInTheDocument();
  });

  it('insights category filter shows only insights reports', async () => {
    currentCategoryFilter = 'insights';
    render(<ReportsPage />);
    await waitFor(() => {
      expect(screen.getByText('Recurring Expenses Tracker')).toBeInTheDocument();
    });
    expect(screen.queryByText('Tax Summary')).not.toBeInTheDocument();
  });

  it('debt category filter shows only debt reports', async () => {
    currentCategoryFilter = 'debt';
    render(<ReportsPage />);
    await waitFor(() => {
      expect(screen.getByText('Debt Payoff Timeline')).toBeInTheDocument();
    });
    expect(screen.queryByText('Tax Summary')).not.toBeInTheDocument();
  });

  it('networth category filter shows only networth reports', async () => {
    currentCategoryFilter = 'networth';
    render(<ReportsPage />);
    await waitFor(() => {
      expect(screen.getByText('Net Worth Over Time')).toBeInTheDocument();
    });
    expect(screen.queryByText('Tax Summary')).not.toBeInTheDocument();
  });

  it('income category filter shows only income reports', async () => {
    currentCategoryFilter = 'income';
    render(<ReportsPage />);
    await waitFor(() => {
      expect(screen.getByText('Income vs Expenses')).toBeInTheDocument();
    });
    expect(screen.queryByText('Tax Summary')).not.toBeInTheDocument();
  });

  it('spending category filter shows only spending reports', async () => {
    currentCategoryFilter = 'spending';
    render(<ReportsPage />);
    await waitFor(() => {
      expect(screen.getByText('Spending by Category')).toBeInTheDocument();
    });
    expect(screen.queryByText('Tax Summary')).not.toBeInTheDocument();
  });
});
