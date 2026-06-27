// Mirrors backend/src/investment-reports. The column catalogue below must stay
// in sync with backend/src/investment-reports/investment-report-columns.ts.

export enum InvestmentGroupBy {
  NONE = 'NONE',
  ACCOUNT = 'ACCOUNT',
  SYMBOL = 'SYMBOL',
  CURRENCY = 'CURRENCY',
}

export enum InvestmentSortDirection {
  ASC = 'ASC',
  DESC = 'DESC',
}

export type InvestmentColumnType =
  | 'text'
  | 'shares'
  | 'currency'
  | 'percent'
  | 'integer'
  | 'number'
  | 'date';

export interface InvestmentColumnDef {
  key: string;
  label: string;
  type: InvestmentColumnType;
  description: string;
}

export const ALWAYS_INCLUDED_COLUMN = 'symbol';

export const INVESTMENT_REPORT_COLUMNS: InvestmentColumnDef[] = [
  { key: 'symbol', label: 'Symbol', type: 'text', description: 'Company ticker symbol.' },
  { key: 'name', label: 'Name', type: 'text', description: 'The name of the investment.' },
  { key: 'securityType', label: 'Type', type: 'text', description: 'Type of investment, such as stock, ETF, mutual fund, or bond.' },
  { key: 'currency', label: 'Currency', type: 'text', description: 'The currency the information displayed is based on.' },
  { key: 'account', label: 'Account', type: 'text', description: 'The investment account that holds this security.' },
  { key: 'quantity', label: 'Quantity', type: 'shares', description: 'The number of shares you hold of a given security.' },
  { key: 'averageCost', label: 'Average Cost', type: 'currency', description: 'The average cost per share, including commissions, that you paid for this security.' },
  { key: 'costBasis', label: 'Cost Basis', type: 'currency', description: 'The total cost, including commissions and fees, of all shares of an investment.' },
  { key: 'lastPrice', label: 'Last Price', type: 'currency', description: 'The most recent price at which the security traded.' },
  { key: 'marketValue', label: 'Market Value', type: 'currency', description: 'Market value of your investment at the last price.' },
  { key: 'gain', label: 'Gain', type: 'currency', description: 'Your gain or loss on this security. Current market value plus income, minus cost basis.' },
  { key: 'gainPercent', label: '%Gain', type: 'percent', description: 'The percentage of profit or loss on an investment based on its cost.' },
  { key: 'priceAppreciation', label: 'Price Appreciation', type: 'currency', description: 'Your gain or loss due to price fluctuations. Current market value minus cost basis.' },
  { key: 'portfolioPercent', label: '% of portfolio', type: 'percent', description: 'The percentage of your total portfolio invested in this security by market value.' },
  { key: 'open', label: 'Open', type: 'currency', description: 'The first price at which a security traded on the trading day.' },
  { key: 'dayHigh', label: 'High (Day High)', type: 'currency', description: 'The highest price at which a security traded during the day.' },
  { key: 'dayLow', label: 'Low (Day Low)', type: 'currency', description: 'The lowest price at which a security traded during the day.' },
  { key: 'previousClose', label: 'Close', type: 'currency', description: 'The last price at which a security traded on the previous trading day.' },
  { key: 'change', label: 'Change', type: 'currency', description: "Per-share difference between the preceding day's close and the most recent price." },
  { key: 'changePercent', label: '%Change', type: 'percent', description: "The percentage difference between the preceding day's close and the current price." },
  { key: 'todaysTotalChange', label: "Today's Total Change", type: 'currency', description: 'Your gain or loss today: the per-share change since the previous close multiplied by your shares.' },
  { key: 'volume', label: 'Volume', type: 'integer', description: 'The total units of an investment traded on the most recent trading day.' },
  { key: 'lastTransactionDate', label: 'Last Transaction Date', type: 'date', description: 'The last date the investment was traded.' },
  { key: 'income', label: 'Income', type: 'currency', description: 'Interest, dividends and capital gains distributions you have received for an investment.' },
  { key: 'commissions', label: 'Commissions', type: 'currency', description: 'The total brokerage fees you paid to buy or sell an investment.' },
  { key: 'purchases', label: 'Purchases', type: 'currency', description: 'The cost of your total purchases (excluding reinvested income) of this investment.' },
  { key: 'sales', label: 'Sales', type: 'currency', description: 'The total sales you have made for this investment.' },
  { key: 'reinvestments', label: 'Reinvestments', type: 'currency', description: 'The total reinvested income for this investment.' },
  { key: 'realizedGains', label: 'Realized Gains', type: 'currency', description: 'The gain from shares actually sold. Does not include the change in value of shares you still hold.' },
  { key: 'exchangeRate', label: 'Exchange Rate', type: 'number', description: 'Exchange rate used to convert this investment to your base currency.' },
  { key: 'lastUpdated', label: 'Last Updated', type: 'date', description: 'The date of the most recent stored price for this security.' },
  { key: 'fiftyTwoWeekHigh', label: '52-Week High', type: 'currency', description: 'The highest price at which a security traded over the past 52 weeks (from stored price history).' },
  { key: 'fiftyTwoWeekLow', label: '52-Week Low', type: 'currency', description: 'The lowest price at which a security traded over the past 52 weeks (from stored price history).' },
  { key: 'totalReturn1Week', label: 'Total Return - 1 Week', type: 'percent', description: 'One-week percentage return: current market value plus income, minus beginning market value, divided by beginning market value.' },
  { key: 'totalReturn4Weeks', label: 'Total Return - 4 Weeks', type: 'percent', description: 'Four-week percentage return on investment.' },
  { key: 'totalReturn3Month', label: 'Total Return - 3 Month', type: 'percent', description: 'Three-month percentage return on investment.' },
  { key: 'totalReturn1Year', label: 'Total Return - 1 Year', type: 'percent', description: 'One-year percentage return on investment.' },
  { key: 'totalReturn3Year', label: 'Total Return - 3 Year', type: 'percent', description: 'Three-year percentage return on investment.' },
  { key: 'totalReturnYtd', label: 'Total Return - YTD', type: 'percent', description: 'Year-to-date percentage return on investment.' },
  { key: 'totalReturnAllDates', label: 'Total Return - All Dates', type: 'percent', description: 'Percentage return on investment across all dates held.' },
  { key: 'totalAnnualizedReturn', label: 'Total Annualized Return', type: 'percent', description: 'Annual percentage return on investment, projected or averaged to one year.' },
];

export const INVESTMENT_COLUMN_MAP: Record<string, InvestmentColumnDef> =
  Object.fromEntries(INVESTMENT_REPORT_COLUMNS.map((c) => [c.key, c]));

export const GROUP_BY_LABELS: Record<InvestmentGroupBy, string> = {
  [InvestmentGroupBy.NONE]: 'No Grouping',
  [InvestmentGroupBy.ACCOUNT]: 'Account',
  [InvestmentGroupBy.SYMBOL]: 'Symbol',
  [InvestmentGroupBy.CURRENCY]: 'Currency',
};

export const SORT_DIRECTION_LABELS: Record<InvestmentSortDirection, string> = {
  [InvestmentSortDirection.ASC]: 'Ascending',
  [InvestmentSortDirection.DESC]: 'Descending',
};

export interface InvestmentReportConfig {
  columns: string[];
  accountIds: string[];
  sortColumn: string | null;
  sortDirection: InvestmentSortDirection;
  asOfDate: string | null;
  mergeAccounts?: boolean;
}

export interface InvestmentReport {
  id: string;
  userId: string;
  name: string;
  description: string | null;
  icon: string | null;
  backgroundColor: string | null;
  groupBy: InvestmentGroupBy;
  config: InvestmentReportConfig;
  isFavourite: boolean;
  sortOrder: number;
  createdAt: string;
  updatedAt: string;
}

export interface CreateInvestmentReportData {
  name: string;
  description?: string;
  icon?: string;
  backgroundColor?: string;
  groupBy?: InvestmentGroupBy;
  config: {
    columns: string[];
    accountIds?: string[];
    sortColumn?: string | null;
    sortDirection?: InvestmentSortDirection;
    asOfDate?: string | null;
    mergeAccounts?: boolean;
  };
  isFavourite?: boolean;
  sortOrder?: number;
}

export type UpdateInvestmentReportData = Partial<CreateInvestmentReportData>;

export type InvestmentCellValue = string | number | null;

export interface InvestmentReportRow {
  id: string;
  /** The holding's own (security) currency, for formatting native values. */
  currency: string;
  /** Multiply this row's native monetary values by this to get base currency. */
  baseExchangeRate: number;
  values: Record<string, InvestmentCellValue>;
}

export interface InvestmentReportGroup {
  key: string;
  label: string;
  rows: InvestmentReportRow[];
}

export interface InvestmentReportResult {
  reportId: string;
  name: string;
  asOfDate: string;
  baseCurrency: string;
  groupBy: InvestmentGroupBy;
  columns: string[];
  groups: InvestmentReportGroup[];
  rowCount: number;
}
