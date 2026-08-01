export interface MonthlyNetWorth {
  month: string; // "2023-01-01"
  assets: number;
  liabilities: number;
  netWorth: number;
}

export interface MonthlyInvestmentValue {
  month: string;
  value: number;
}

export interface DailyInvestmentValue {
  date: string;
  value: number;
}

export type InvestmentBreakdownGranularity = 'daily' | 'monthly';

/**
 * One stacked band on the Portfolio Value Over Time "by security" chart:
 * an individual security, the rolled-up "other" bucket, or aggregate cash.
 * `symbol`/`name` are only populated for real securities; `cash` and `other`
 * are labelled on the client so their copy stays localized.
 */
export interface InvestmentBreakdownSeries {
  key: string; // securityId, or the sentinel 'cash' / 'other'
  type: 'security' | 'cash' | 'other';
  symbol: string | null;
  name: string;
}

export interface InvestmentBreakdownPoint {
  date: string; // YYYY-MM-DD; month-first for monthly granularity
  total: number;
  values: Record<string, number>; // keyed by InvestmentBreakdownSeries.key
}

export interface InvestmentBreakdown {
  granularity: InvestmentBreakdownGranularity;
  currency: string;
  series: InvestmentBreakdownSeries[];
  points: InvestmentBreakdownPoint[];
}

/**
 * Per-security intraday breakdown (1D / 1W / 1M ranges). Same band shape as
 * the daily/monthly breakdown, but points are keyed by timestamp and the
 * response carries the intraday availability metadata so the report applies the
 * same fallback handling as the total intraday series.
 */
export interface IntradayBreakdownPoint {
  timestamp: string;
  total: number;
  values: Record<string, number>;
}

export interface IntradayBreakdown {
  series: InvestmentBreakdownSeries[];
  points: IntradayBreakdownPoint[];
  interval: '1m' | '2m' | '5m' | '15m' | '30m' | '60m' | '90m';
  currency: string;
  range: '1d' | '1w' | '1m';
  fetchedAt: string;
  skippedSymbols: string[];
  failedSymbols: string[];
  fallbackToDaily: boolean;
}
