/**
 * Catalogue of the columns a custom investment report can display.
 *
 * Modelled on the Microsoft Money "Portfolio Manager" column set
 * (see ms_money_portfolio_columns.md). Only columns that can actually be
 * populated from our data are included here: holdings + investment
 * transactions + the daily OHLCV prices fetched from Yahoo Finance / MSN
 * Money. Market-data columns our quote providers never return (PE, EPS,
 * Beta, dividend yield, market cap, bid/ask, bond/option-specific fields,
 * fund composition breakdowns, etc.) are intentionally excluded.
 *
 * This is the single source of truth on the backend: the DTO validates that
 * every requested column key exists here, and the data service computes a
 * value for each. The frontend mirrors this list (with the same keys) so the
 * column chooser can show each column's description.
 */

export type InvestmentColumnType =
  | "text"
  | "shares"
  | "currency"
  | "percent"
  | "integer"
  | "number"
  | "date";

export interface InvestmentColumnDef {
  /** Stable identifier persisted in the report definition. */
  key: string;
  /** MS Money column label shown in the UI. */
  label: string;
  /** Value formatting hint consumed by the frontend. */
  type: InvestmentColumnType;
  /** MS Money description shown in the column chooser. */
  description: string;
  /** True when the value is monetary and denominated in the holding's own currency. */
  native?: boolean;
}

/** The column always present in every report (cannot be removed). */
export const ALWAYS_INCLUDED_COLUMN = "symbol";

export const INVESTMENT_REPORT_COLUMNS: readonly InvestmentColumnDef[] = [
  // -- Identity ------------------------------------------------------------
  {
    key: "symbol",
    label: "Symbol",
    type: "text",
    description: "Company ticker symbol.",
  },
  {
    key: "name",
    label: "Name",
    type: "text",
    description: "The name of the investment.",
  },
  {
    key: "securityType",
    label: "Type",
    type: "text",
    description:
      "Type of investment, such as stock, ETF, mutual fund, or bond.",
  },
  {
    key: "currency",
    label: "Currency",
    type: "text",
    description: "The currency the information displayed is based on.",
  },
  {
    key: "account",
    label: "Account",
    type: "text",
    description: "The investment account that holds this security.",
  },
  // -- Position & cost -----------------------------------------------------
  {
    key: "quantity",
    label: "Quantity",
    type: "shares",
    description: "The number of shares you hold of a given security.",
  },
  {
    key: "averageCost",
    label: "Average Cost",
    type: "currency",
    description:
      "The average cost per share, including commissions, that you paid for this security.",
    native: true,
  },
  {
    key: "costBasis",
    label: "Cost Basis",
    type: "currency",
    description:
      "The total cost, including commissions and fees, of all shares of an investment.",
    native: true,
  },
  // -- Valuation -----------------------------------------------------------
  {
    key: "lastPrice",
    label: "Last Price",
    type: "currency",
    description: "The most recent price at which the security traded.",
    native: true,
  },
  {
    key: "marketValue",
    label: "Market Value",
    type: "currency",
    description: "Market value of your investment at the last price.",
    native: true,
  },
  {
    key: "gain",
    label: "Gain",
    type: "currency",
    description:
      "Your gain or loss on this security. Current market value plus income, minus cost basis.",
    native: true,
  },
  {
    key: "gainPercent",
    label: "%Gain",
    type: "percent",
    description:
      "The percentage of profit or loss on an investment based on its cost.",
  },
  {
    key: "priceAppreciation",
    label: "Price Appreciation",
    type: "currency",
    description:
      "Your gain or loss due to price fluctuations. Current market value minus cost basis.",
    native: true,
  },
  {
    key: "portfolioPercent",
    label: "% of portfolio",
    type: "percent",
    description:
      "The percentage of your total portfolio invested in this security by market value.",
  },
  // -- Quote (as of the report date) ---------------------------------------
  {
    key: "open",
    label: "Open",
    type: "currency",
    description:
      "The first price at which a security traded on the trading day.",
    native: true,
  },
  {
    key: "dayHigh",
    label: "High (Day High)",
    type: "currency",
    description: "The highest price at which a security traded during the day.",
    native: true,
  },
  {
    key: "dayLow",
    label: "Low (Day Low)",
    type: "currency",
    description: "The lowest price at which a security traded during the day.",
    native: true,
  },
  {
    key: "previousClose",
    label: "Close",
    type: "currency",
    description:
      "The last price at which a security traded on the previous trading day.",
    native: true,
  },
  {
    key: "change",
    label: "Change",
    type: "currency",
    description:
      "Per-share difference between the preceding day's close and the most recent price.",
    native: true,
  },
  {
    key: "changePercent",
    label: "%Change",
    type: "percent",
    description:
      "The percentage difference between the preceding day's close and the current price.",
  },
  {
    key: "todaysTotalChange",
    label: "Today's Total Change",
    type: "currency",
    description:
      "Your gain or loss today: the per-share change since the previous close multiplied by your shares.",
    native: true,
  },
  {
    key: "volume",
    label: "Volume",
    type: "integer",
    description:
      "The total units of an investment traded on the most recent trading day.",
  },
  {
    key: "lastTransactionDate",
    label: "Last Transaction Date",
    type: "date",
    description: "The last date the investment was traded.",
  },
  // -- Transaction analytics ----------------------------------------------
  {
    key: "income",
    label: "Income",
    type: "currency",
    description:
      "Interest, dividends and capital gains distributions you have received for an investment.",
    native: true,
  },
  {
    key: "commissions",
    label: "Commissions",
    type: "currency",
    description:
      "The total brokerage fees you paid to buy or sell an investment.",
    native: true,
  },
  {
    key: "purchases",
    label: "Purchases",
    type: "currency",
    description:
      "The cost of your total purchases (excluding reinvested income) of this investment.",
    native: true,
  },
  {
    key: "sales",
    label: "Sales",
    type: "currency",
    description: "The total sales you have made for this investment.",
    native: true,
  },
  {
    key: "reinvestments",
    label: "Reinvestments",
    type: "currency",
    description: "The total reinvested income for this investment.",
    native: true,
  },
  {
    key: "realizedGains",
    label: "Realized Gains",
    type: "currency",
    description:
      "The gain from shares actually sold. Does not include the change in value of shares you still hold.",
    native: true,
  },
  // -- Other ---------------------------------------------------------------
  {
    key: "exchangeRate",
    label: "Exchange Rate",
    type: "number",
    description:
      "Exchange rate used to convert this investment to your base currency.",
  },
  {
    key: "lastUpdated",
    label: "Last Updated",
    type: "date",
    description: "The date of the most recent stored price for this security.",
  },
  {
    key: "fiftyTwoWeekHigh",
    label: "52-Week High",
    type: "currency",
    description:
      "The highest price at which a security traded over the past 52 weeks (from stored price history).",
    native: true,
  },
  {
    key: "fiftyTwoWeekLow",
    label: "52-Week Low",
    type: "currency",
    description:
      "The lowest price at which a security traded over the past 52 weeks (from stored price history).",
    native: true,
  },
  // -- Period returns ------------------------------------------------------
  {
    key: "totalReturn1Week",
    label: "Total Return - 1 Week",
    type: "percent",
    description:
      "One-week percentage return: current market value plus income, minus beginning market value, divided by beginning market value.",
  },
  {
    key: "totalReturn4Weeks",
    label: "Total Return - 4 Weeks",
    type: "percent",
    description: "Four-week percentage return on investment.",
  },
  {
    key: "totalReturn3Month",
    label: "Total Return - 3 Month",
    type: "percent",
    description: "Three-month percentage return on investment.",
  },
  {
    key: "totalReturn1Year",
    label: "Total Return - 1 Year",
    type: "percent",
    description: "One-year percentage return on investment.",
  },
  {
    key: "totalReturn3Year",
    label: "Total Return - 3 Year",
    type: "percent",
    description: "Three-year percentage return on investment.",
  },
  {
    key: "totalReturnYtd",
    label: "Total Return - YTD",
    type: "percent",
    description: "Year-to-date percentage return on investment.",
  },
  {
    key: "totalReturnAllDates",
    label: "Total Return - All Dates",
    type: "percent",
    description: "Percentage return on investment across all dates held.",
  },
  {
    key: "totalAnnualizedReturn",
    label: "Total Annualized Return",
    type: "percent",
    description:
      "Annual percentage return on investment, projected (short holdings) or averaged (long holdings) to one year.",
  },
] as const;

export const INVESTMENT_REPORT_COLUMN_KEYS: readonly string[] =
  INVESTMENT_REPORT_COLUMNS.map((c) => c.key);

const COLUMN_KEY_SET = new Set(INVESTMENT_REPORT_COLUMN_KEYS);

export function isValidInvestmentColumn(key: string): boolean {
  return COLUMN_KEY_SET.has(key);
}
