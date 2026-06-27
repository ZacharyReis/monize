/**
 * Chart colour tokens for Recharts components.
 *
 * These are CSS variable references, not hex values: passing them straight
 * into Recharts `fill` / `stroke` / `stopColor` props makes every chart
 * follow the active colour theme AND light/dark mode automatically, with no
 * JS recomputation on theme change. The variables are defined in
 * `src/app/globals.css` (defaults) and overridden per theme in
 * `src/app/themes.css`.
 *
 * Do not use these for user-chosen entity colours (tags, categories,
 * payees) -- those come from the database and are intentionally not themed.
 */
export const chartColors = {
  /** Accent-coloured series (balance lines, primary bars). Follows the theme accent. */
  primary: 'var(--chart-primary)',
  /** Income / gains / positive values. */
  income: 'var(--chart-income)',
  /** Expenses / losses / negative values. */
  expense: 'var(--chart-expense)',
  /** Warnings, projections, secondary highlights. */
  warning: 'var(--chart-warning)',
  /** CartesianGrid stroke and axis lines. */
  grid: 'var(--chart-grid)',
  /** Axis tick label fill. */
  axis: 'var(--chart-axis)',
} as const;

/** Categorical palette for multi-series charts (pies, stacked bars, multi-line). */
export const CHART_SERIES = [
  'var(--chart-1)',
  'var(--chart-2)',
  'var(--chart-3)',
  'var(--chart-4)',
  'var(--chart-5)',
  'var(--chart-6)',
  'var(--chart-7)',
  'var(--chart-8)',
  'var(--chart-9)',
  'var(--chart-10)',
] as const;

/** Cycle through the categorical palette for series index `i`. */
export function chartSeriesColor(i: number): string {
  return CHART_SERIES[i % CHART_SERIES.length];
}
