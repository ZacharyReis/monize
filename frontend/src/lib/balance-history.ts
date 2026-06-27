/**
 * A single day's balance in a Balance History series. `date` must be an ISO
 * `yyyy-MM-dd` string so points can be ordered by plain string comparison.
 */
export interface DailyBalancePoint {
  date: string;
  balance: number;
}

export interface BalanceSummary {
  startBalance: number;
  /** Balance at the most recent data point on or before today. */
  currentBalance: number;
  endBalance: number;
  /** True when at least one post-today point differs from the current balance. */
  hasFutureData: boolean;
  minBalance: number;
  goesNegative: boolean;
}

/**
 * Summarises a daily balance series the way the Balance History chart's
 * footer does, so other surfaces (e.g. the Account Info widget) show the
 * exact same "Current" figure. Balances are rounded to 2 decimals up front
 * to match the chart's plotted points.
 */
export function computeBalanceSummary(
  data: ReadonlyArray<DailyBalancePoint>,
): BalanceSummary | null {
  if (data.length === 0) return null;

  const points = data.map((d) => ({
    date: d.date,
    balance: Math.round(d.balance * 100) / 100,
  }));

  const startBalance = points[0].balance;
  const endBalance = points[points.length - 1].balance;

  // Find balance as of today (last data point on or before today)
  const today = new Date();
  const todayStr = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
  let currentBalance = endBalance;
  let todayAnchorIdx = -1;
  for (let i = points.length - 1; i >= 0; i--) {
    if (points[i].date <= todayStr) {
      currentBalance = points[i].balance;
      todayAnchorIdx = i;
      break;
    }
  }
  if (todayAnchorIdx === -1) {
    // All data points are in the future
    currentBalance = startBalance;
  }

  // The backend returns one data point per day in the filtered range, so
  // chart points strictly after today do NOT necessarily mean future
  // transactions exist — the balance simply carries forward on days with
  // no activity. Only consider the range as having future data when at
  // least one post-today point differs from the current balance.
  let hasFutureData = false;
  for (let i = todayAnchorIdx + 1; i < points.length; i++) {
    if (points[i].balance !== currentBalance) {
      hasFutureData = true;
      break;
    }
  }

  let minBalance = startBalance;
  for (const point of points) {
    if (point.balance < minBalance) minBalance = point.balance;
  }

  return {
    startBalance,
    currentBalance,
    endBalance,
    hasFutureData,
    minBalance,
    goesNegative: minBalance < 0,
  };
}

/**
 * Opacity stops for a balance area's vertical gradient. The fill is densest
 * along the data line and fades to transparent at the zero axis, whether
 * balances are positive, negative, or cross zero. `zeroOffset` is the fraction
 * (measured from the top of the area's bounding box) at which the zero line
 * falls, clamped to [0, 1] so all-positive data keeps the original
 * top-to-bottom fade and all-negative data mirrors it (shading increasing
 * toward the bottom).
 */
export function computeBalanceGradient(values: number[]): {
  topOpacity: number;
  zeroOffset: number;
  bottomOpacity: number;
} {
  const SHADE = 0.3;
  if (values.length === 0) {
    return { topOpacity: SHADE, zeroOffset: 1, bottomOpacity: 0 };
  }
  let max = values[0];
  let min = values[0];
  for (const value of values) {
    if (value > max) max = value;
    if (value < min) min = value;
  }
  const span = max - min;
  const zeroOffset =
    span === 0 ? (max >= 0 ? 1 : 0) : Math.min(1, Math.max(0, max / span));
  return {
    topOpacity: max > 0 ? SHADE : 0,
    zeroOffset,
    bottomOpacity: min < 0 ? SHADE : 0,
  };
}
