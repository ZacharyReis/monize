import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, fireEvent, act } from "@/test/render";
import { SpendingByCategoryReport } from "./SpendingByCategoryReport";

const mockPush = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: mockPush }),
}));

vi.mock("@/hooks/useNumberFormat", () => ({
  useNumberFormat: () => ({
    formatCurrencyCompact: (n: number) => `$${n.toFixed(2)}`,
    formatCurrency: (n: number) => `$${n.toFixed(2)}`,
    formatCurrencyAxis: (n: number) => `$${n}`,
    defaultCurrency: "CAD",
  }),
}));

let mockIsValid = true;
vi.mock("@/hooks/useDateRange", () => {
  const resolvedRange = { start: "2025-01-01", end: "2025-03-31" };
  return {
    useDateRange: () => ({
      dateRange: "3m",
      setDateRange: vi.fn(),
      startDate: "",
      setStartDate: vi.fn(),
      endDate: "",
      setEndDate: vi.fn(),
      resolvedRange,
      get isValid() { return mockIsValid; },
    }),
  };
});

vi.mock("@/lib/chart-colours", () => ({
  CHART_COLOURS: ["#3b82f6", "#ef4444", "#22c55e", "#f97316"],
}));

vi.mock("@/components/ui/DateRangeSelector", () => ({
  DateRangeSelector: () => <div data-testid="date-range-selector" />,
}));

vi.mock("@/components/ui/ChartViewToggle", () => ({
  ChartViewToggle: ({ onChange }: any) => (
    <div data-testid="chart-view-toggle">
      <button data-testid="toggle-bar" onClick={() => onChange("bar")}>Bar</button>
      <button data-testid="toggle-pie" onClick={() => onChange("pie")}>Pie</button>
      <button data-testid="toggle-table" onClick={() => onChange("table")}>Table</button>
    </div>
  ),
}));

vi.mock("@/components/ui/ExportDropdown", () => ({
  ExportDropdown: ({ onExportPdf, onExportCsv }: any) => (
    <div data-testid="export-dropdown">
      <button data-testid="export-pdf" onClick={onExportPdf}>PDF</button>
      {onExportCsv && (
        <button data-testid="export-csv" onClick={onExportCsv}>CSV</button>
      )}
    </div>
  ),
}));

const mockExportToPdf = vi.fn();
vi.mock("@/lib/pdf-export", () => ({
  exportToPdf: (...args: any[]) => mockExportToPdf(...args),
}));

vi.mock("recharts", () => ({
  ResponsiveContainer: ({ children }: any) => (
    <div data-testid="responsive-container">{children}</div>
  ),
  PieChart: ({ children }: any) => (
    <div data-testid="pie-chart">{children}</div>
  ),
  Pie: () => null,
  Cell: () => null,
  Tooltip: () => null,
  BarChart: ({ children }: any) => (
    <div data-testid="bar-chart">{children}</div>
  ),
  Bar: () => null,
  XAxis: () => null,
  YAxis: () => null,
  CartesianGrid: () => null,
}));

const mockGetSpendingByCategory = vi.fn();

vi.mock("@/lib/built-in-reports", () => ({
  builtInReportsApi: {
    getSpendingByCategory: (...args: any[]) =>
      mockGetSpendingByCategory(...args),
  },
}));

vi.mock("@/lib/logger", () => ({
  createLogger: () => ({
    error: vi.fn(),
    warn: vi.fn(),
    info: vi.fn(),
    debug: vi.fn(),
  }),
}));

describe("SpendingByCategoryReport", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockPush.mockClear();
    mockIsValid = true;
  });

  it("shows loading state initially", async () => {
    mockGetSpendingByCategory.mockReturnValue(new Promise(() => {}));
    render(<SpendingByCategoryReport />);
    expect(document.querySelector(".animate-pulse")).toBeTruthy();
    // Flush the fetcher's resolution so its state update is wrapped in act().
    await act(async () => {});
  });

  it("renders empty state when no data returned", async () => {
    mockGetSpendingByCategory.mockResolvedValue({
      data: [],
      totalSpending: 0,
    });
    render(<SpendingByCategoryReport />);
    await waitFor(() => {
      expect(
        screen.getByText("No expense data for this period."),
      ).toBeInTheDocument();
    });
  });

  it("renders chart and legend with sample data", async () => {
    mockGetSpendingByCategory.mockResolvedValue({
      data: [
        {
          categoryId: "cat-1",
          categoryName: "Groceries",
          total: 500,
          color: "#ff0000",
        },
        {
          categoryId: "cat-2",
          categoryName: "Utilities",
          total: 200,
          color: "",
        },
      ],
      totalSpending: 700,
    });
    render(<SpendingByCategoryReport />);
    await waitFor(() => {
      expect(screen.getByText("Groceries")).toBeInTheDocument();
    });
    expect(screen.getByText("Utilities")).toBeInTheDocument();
    expect(screen.getByText("Total Expenses")).toBeInTheDocument();
    expect(screen.getByText("$700.00")).toBeInTheDocument();
  });

  it("renders date range selector and chart view toggle", async () => {
    mockGetSpendingByCategory.mockResolvedValue({
      data: [
        { categoryId: "cat-1", categoryName: "Food", total: 100, color: "" },
      ],
      totalSpending: 100,
    });
    render(<SpendingByCategoryReport />);
    await waitFor(() => {
      expect(screen.getByTestId("date-range-selector")).toBeInTheDocument();
    });
    expect(screen.getByTestId("chart-view-toggle")).toBeInTheDocument();
  });

  it("renders category with provided color and percentage", async () => {
    mockGetSpendingByCategory.mockResolvedValue({
      data: [
        {
          categoryId: "cat-1",
          categoryName: "Food",
          total: 300,
          color: "#ff0000",
        },
        { categoryId: "cat-2", categoryName: "Rent", total: 700, color: "" },
      ],
      totalSpending: 1000,
    });
    render(<SpendingByCategoryReport />);
    await waitFor(() => {
      expect(screen.getByText("Food")).toBeInTheDocument();
    });
    expect(screen.getByText("Rent")).toBeInTheDocument();
    // Percentages in legend
    expect(screen.getByText("$300.00 (30.0%)")).toBeInTheDocument();
    expect(screen.getByText("$700.00 (70.0%)")).toBeInTheDocument();
  });

  it("renders category without categoryId as disabled", async () => {
    mockGetSpendingByCategory.mockResolvedValue({
      data: [
        {
          categoryId: "",
          categoryName: "Uncategorized",
          total: 100,
          color: "",
        },
      ],
      totalSpending: 100,
    });
    render(<SpendingByCategoryReport />);
    await waitFor(() => {
      expect(screen.getByText("Uncategorized")).toBeInTheDocument();
    });
    // The button should be disabled
    const button = screen.getByText("Uncategorized").closest("button");
    expect(button).toBeDisabled();
  });

  it("surfaces a retryable error state when the API fails", async () => {
    mockGetSpendingByCategory.mockRejectedValue(new Error("Network error"));
    render(<SpendingByCategoryReport />);
    await waitFor(() => {
      expect(
        screen.getByText(/failed to load report data/i),
      ).toBeInTheDocument();
    });
    expect(screen.getByRole("button", { name: /try again/i })).toBeInTheDocument();
  });

  it("navigates to transactions page on category legend click", async () => {
    mockGetSpendingByCategory.mockResolvedValue({
      data: [
        {
          categoryId: "cat-1",
          categoryName: "Groceries",
          total: 500,
          color: "#ff0000",
        },
      ],
      totalSpending: 500,
    });
    render(<SpendingByCategoryReport />);
    await waitFor(() => {
      expect(screen.getByText("Groceries")).toBeInTheDocument();
    });
    fireEvent.click(screen.getByText("Groceries"));
    expect(mockPush).toHaveBeenCalledWith(
      "/transactions?categoryId=cat-1&startDate=2025-01-01&endDate=2025-03-31",
    );
  });

  it("does not navigate when legend button has no categoryId", async () => {
    mockGetSpendingByCategory.mockResolvedValue({
      data: [
        { categoryId: "", categoryName: "Uncategorized2", total: 50, color: "" },
      ],
      totalSpending: 50,
    });
    render(<SpendingByCategoryReport />);
    await waitFor(() => {
      expect(screen.getByText("Uncategorized2")).toBeInTheDocument();
    });
    const btn = screen.getByText("Uncategorized2").closest("button")!;
    fireEvent.click(btn);
    expect(mockPush).not.toHaveBeenCalled();
  });

  it("switches to bar chart view when toggle is clicked", async () => {
    mockGetSpendingByCategory.mockResolvedValue({
      data: [
        { categoryId: "cat-1", categoryName: "Food", total: 300, color: "" },
      ],
      totalSpending: 300,
    });
    render(<SpendingByCategoryReport />);
    await waitFor(() => {
      expect(screen.getByText("Food")).toBeInTheDocument();
    });
    // Initially shows pie chart
    expect(screen.getByTestId("pie-chart")).toBeInTheDocument();
    // Switch to bar
    fireEvent.click(screen.getByTestId("toggle-bar"));
    await waitFor(() => {
      expect(screen.getByTestId("bar-chart")).toBeInTheDocument();
    });
    expect(screen.queryByTestId("pie-chart")).not.toBeInTheDocument();
  });

  it("switches back to pie chart view from bar view", async () => {
    mockGetSpendingByCategory.mockResolvedValue({
      data: [
        { categoryId: "cat-1", categoryName: "Food", total: 300, color: "" },
      ],
      totalSpending: 300,
    });
    render(<SpendingByCategoryReport />);
    await waitFor(() => {
      expect(screen.getByText("Food")).toBeInTheDocument();
    });
    fireEvent.click(screen.getByTestId("toggle-bar"));
    await waitFor(() => {
      expect(screen.getByTestId("bar-chart")).toBeInTheDocument();
    });
    fireEvent.click(screen.getByTestId("toggle-pie"));
    await waitFor(() => {
      expect(screen.getByTestId("pie-chart")).toBeInTheDocument();
    });
  });

  it("calls exportToPdf with legend items when data is present", async () => {
    mockExportToPdf.mockResolvedValue(undefined);
    mockGetSpendingByCategory.mockResolvedValue({
      data: [
        { categoryId: "cat-1", categoryName: "Food", total: 300, color: "#ff0000" },
        { categoryId: "cat-2", categoryName: "Rent", total: 700, color: "" },
      ],
      totalSpending: 1000,
    });
    render(<SpendingByCategoryReport />);
    await waitFor(() => {
      expect(screen.getByText("Food")).toBeInTheDocument();
    });
    fireEvent.click(screen.getByTestId("export-pdf"));
    await waitFor(() => {
      expect(mockExportToPdf).toHaveBeenCalledWith(
        expect.objectContaining({
          title: "Spending by Category",
          filename: "spending-by-category",
          chartLegend: expect.arrayContaining([
            expect.objectContaining({ label: expect.stringContaining("Food") }),
          ]),
        }),
      );
    });
  });

  it("calls exportToPdf with undefined chartLegend when chart data is empty", async () => {
    mockExportToPdf.mockResolvedValue(undefined);
    mockGetSpendingByCategory.mockResolvedValue({ data: [], totalSpending: 0 });
    render(<SpendingByCategoryReport />);
    await waitFor(() => {
      expect(
        screen.getByText("No expense data for this period."),
      ).toBeInTheDocument();
    });
    fireEvent.click(screen.getByTestId("export-pdf"));
    await waitFor(() => {
      expect(mockExportToPdf).toHaveBeenCalledWith(
        expect.objectContaining({
          chartLegend: undefined,
        }),
      );
    });
  });

  it("shows 0% percentage in legend when totalExpenses is zero", async () => {
    mockGetSpendingByCategory.mockResolvedValue({
      data: [
        { categoryId: "cat-1", categoryName: "Food", total: 0, color: "" },
      ],
      totalSpending: 0,
    });
    render(<SpendingByCategoryReport />);
    await waitFor(() => {
      expect(screen.getByText("Food")).toBeInTheDocument();
    });
    // When totalExpenses is 0, percentage should display as '0'
    expect(screen.getByText("$0.00 (0%)")).toBeInTheDocument();
  });

  it("does not load data when isValid is false", async () => {
    mockIsValid = false;
    mockGetSpendingByCategory.mockResolvedValue({ data: [], totalSpending: 0 });
    render(<SpendingByCategoryReport />);
    // loadData is gated on isValid, so the API should not be called
    expect(mockGetSpendingByCategory).not.toHaveBeenCalled();
    // The fetcher resolves null when isValid is false; flush so that state
    // update is wrapped in act().
    await act(async () => {});
  });

  it("sorts the percentage column when totalExpenses is 0", async () => {
    mockGetSpendingByCategory.mockResolvedValue({
      data: [
        { categoryId: "c1", categoryName: "A", total: 0, color: "" },
        { categoryId: "c2", categoryName: "B", total: 0, color: "" },
      ],
      totalSpending: 0,
    });
    const { container } = render(<SpendingByCategoryReport />);
    await waitFor(() => expect(screen.getByTestId("toggle-table")).toBeInTheDocument());
    fireEvent.click(screen.getByTestId("toggle-table"));
    await waitFor(() => expect(container.querySelector('table')).toBeInTheDocument());
    const ths = container.querySelectorAll('table thead th');
    if (ths[2]) fireEvent.click(ths[2]);
  });

  it("renders sortable table view with rows and totals row", async () => {
    mockGetSpendingByCategory.mockResolvedValue({
      data: [
        { categoryId: "cat-1", categoryName: "Food", total: 300, color: "" },
        { categoryId: "cat-2", categoryName: "Rent", total: 700, color: "" },
        { categoryId: "", categoryName: "Uncategorized", total: 50, color: "" },
      ],
      totalSpending: 1050,
    });
    render(<SpendingByCategoryReport />);
    await waitFor(() => {
      expect(screen.getByTestId("toggle-table")).toBeInTheDocument();
    });
    fireEvent.click(screen.getByTestId("toggle-table"));
    // Click each sort header to exercise comparators (default desc by value).
    const categoryHeader = screen.getByText("Category");
    const amountHeader = screen.getByText("Amount");
    const pctHeader = screen.getByText("% of Total");
    fireEvent.click(categoryHeader); // sort by name
    fireEvent.click(categoryHeader); // toggle desc
    fireEvent.click(pctHeader);
    fireEvent.click(amountHeader);
    expect(screen.getByText("Total")).toBeInTheDocument();
    expect(screen.getByText("100%")).toBeInTheDocument();
    // Clicking a row navigates if it has a categoryId.
    fireEvent.click(screen.getAllByText("Food")[0].closest("tr")!);
    expect(mockPush).toHaveBeenCalled();
  });

  it("exports CSV from the table view", async () => {
    mockGetSpendingByCategory.mockResolvedValue({
      data: [
        { categoryId: "cat-1", categoryName: "Food", total: 300, color: "" },
      ],
      totalSpending: 300,
    });
    render(<SpendingByCategoryReport />);
    await waitFor(() => {
      expect(screen.getByTestId("toggle-table")).toBeInTheDocument();
    });
    fireEvent.click(screen.getByTestId("toggle-table"));
    // CSV button should appear; it just needs to fire without throwing.
    fireEvent.click(screen.getByTestId("export-csv"));
  });
});
