'use client';

import { useImperativeHandle, useMemo, useRef, type Ref } from 'react';
import { useTranslations } from 'next-intl';
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Legend,
} from 'recharts';
import { useReportData } from '@/hooks/useReportData';
import { investmentsApi } from '@/lib/investments';
import { Security, SecurityPrice } from '@/types/investment';
import { chartColors, chartSeriesColor } from '@/lib/chart-colors';
import { Skeleton } from '@/components/ui/LoadingSkeleton';
import { parseLocalDate, type ChartDatePattern } from '@/lib/utils';
import { useChartDateFormat } from '@/hooks/useChartDateFormat';
import { useNumberFormat } from '@/hooks/useNumberFormat';
import { buildTimeAxisTicks } from '@/lib/chart-time-axis';
import { resolvePdfColor } from '@/components/reports/resolve-pdf-color';

// Match the single-security price chart's window (~3 years of history).
const PRICE_LIMIT = 1095;

/** A security plotted as one line, with its assigned palette colour. */
export interface PerformanceSeries {
  id: string;
  symbol: string;
  name: string;
  color: string;
}

/** One merged row: a timestamp plus each security's % return (by id). */
export interface PerformanceRow {
  ts: number;
  [securityId: string]: number;
}

/**
 * Normalise each security's price history to its own cumulative percent return
 * (rebased to 0% at that security's first available price in the window) and
 * merge into one date-keyed dataset. Rebasing per security -- rather than
 * plotting raw prices -- is what lets securities with different price levels and
 * currencies be compared on a single axis. A security with no usable price (none
 * in the window, or a non-positive base) is dropped from the legend rather than
 * drawn as a flat zero line.
 */
export function buildPerformanceData(
  input: { security: Security; prices: SecurityPrice[] }[],
): { rows: PerformanceRow[]; series: Omit<PerformanceSeries, 'color'>[] } {
  const byTs = new Map<number, PerformanceRow>();
  const series: Omit<PerformanceSeries, 'color'>[] = [];

  for (const { security, prices } of input) {
    const sorted = [...prices].sort((a, b) =>
      a.priceDate.localeCompare(b.priceDate),
    );
    const base = sorted.length > 0 ? Number(sorted[0].closePrice) : 0;
    if (!(base > 0)) continue;

    series.push({ id: security.id, symbol: security.symbol, name: security.name });

    for (const p of sorted) {
      const ts = parseLocalDate(p.priceDate).getTime();
      const pct = (Number(p.closePrice) / base - 1) * 100;
      const row = byTs.get(ts) ?? { ts };
      row[security.id] = pct;
      byTs.set(ts, row);
    }
  }

  const rows = [...byTs.values()].sort((a, b) => a.ts - b.ts);
  return { rows, series };
}

/** Imperative surface for the parent report's Export dropdown. */
export interface SecurityComparisonChartHandle {
  exportPdf: () => Promise<void>;
}

interface SecurityComparisonChartProps {
  /** The securities the user chose to compare (from the multi-select). */
  securities: Security[];
  /** Bumped by the RefreshPricesButton so a manual price refresh re-fetches. */
  reloadKey?: number;
  /**
   * Exposes `exportPdf` so the parent report's Export dropdown (which lives in
   * the shared toolbar above this component) can export the comparison chart.
   * The handle lives here because this component owns the fetched series and
   * the chart DOM the capture needs.
   */
  exportRef?: Ref<SecurityComparisonChartHandle>;
}

/**
 * Performance-comparison view for the Security Performance report: each of the
 * user-selected securities drawn on one chart as its cumulative percent return
 * over time, so they can see at a glance which holdings have out- or
 * under-performed. Mounted only when two or more securities are selected, so its
 * per-security price fetches do not run for the single-security detail flow.
 */
export function SecurityComparisonChart({
  securities,
  reloadKey = 0,
  exportRef,
}: SecurityComparisonChartProps) {
  const t = useTranslations('reports');
  const formatChartDate = useChartDateFormat();
  const { formatSignedPercent } = useNumberFormat();
  const chartRef = useRef<HTMLDivElement>(null);

  const { data, isLoading, error } = useReportData(async () => {
    const results = await Promise.all(
      securities.map(async (security) => ({
        security,
        prices: await investmentsApi.getSecurityPrices(security.id, PRICE_LIMIT),
      })),
    );
    return buildPerformanceData(results);
  }, [securities, reloadKey]);

  const rows = useMemo(() => data?.rows ?? [], [data]);
  const series = useMemo<PerformanceSeries[]>(
    () =>
      (data?.series ?? [])
        .slice()
        .sort((a, b) => a.symbol.localeCompare(b.symbol))
        .map((s, i) => ({ ...s, color: chartSeriesColor(i) })),
    [data],
  );
  const symbolById = useMemo(() => {
    const map = new Map<string, string>();
    series.forEach((s) => map.set(s.id, s.symbol));
    return map;
  }, [series]);

  const xAxis = useMemo(() => {
    if (rows.length === 0) {
      return {
        ticks: [] as number[],
        domain: ['dataMin', 'dataMax'] as [string, string],
        tickFormat: 'MMM yyyy' as ChartDatePattern,
      };
    }
    const minTs = rows[0].ts;
    const maxTs = rows[rows.length - 1].ts;
    const { ticks, stepMonths } = buildTimeAxisTicks(minTs, maxTs);
    return {
      ticks,
      domain: [minTs, maxTs] as [number, number],
      tickFormat: (stepMonths >= 12 ? 'yyyy' : 'MMM yyyy') as ChartDatePattern,
    };
  }, [rows]);

  // Mirrors the single-security chart export: the on-screen card's title,
  // subtitle, and chart, plus a drawn legend (the Recharts legend is HTML, not
  // part of the captured SVG, so the PDF redraws it from the series colours).
  useImperativeHandle(
    exportRef,
    () => ({
      exportPdf: async () => {
        const { exportToPdf } = await import('@/lib/pdf-export');
        await exportToPdf({
          title: t('securityPerformance.comparisonTitle'),
          subtitle: series.map((s) => s.symbol).join(', ') || undefined,
          description: t('securityPerformance.comparisonSubtitle'),
          chartContainer: chartRef.current,
          chartLegend: series.map((s) => ({
            color: resolvePdfColor(s.color),
            label: `${s.symbol} - ${s.name}`,
          })),
          filename: 'security-performance-comparison',
        });
      },
    }),
    [series, t],
  );

  if (error) {
    return (
      <div className="bg-white dark:bg-gray-800 rounded-lg shadow dark:shadow-gray-700/50 p-8 text-center">
        <p className="text-gray-500 dark:text-gray-400">
          {t('securityPerformance.comparisonError')}
        </p>
      </div>
    );
  }

  return (
    <div ref={chartRef} className="bg-white dark:bg-gray-800 rounded-lg shadow dark:shadow-gray-700/50 px-2 py-4 sm:p-6">
      <h3 className="text-lg font-semibold text-gray-900 dark:text-gray-100 mb-1">
        {t('securityPerformance.comparisonTitle')}
      </h3>
      <p className="text-sm text-gray-500 dark:text-gray-400 mb-4">
        {t('securityPerformance.comparisonSubtitle')}
      </p>

      {isLoading ? (
        <Skeleton className="h-80 w-full" />
      ) : series.length === 0 ? (
        <p className="text-gray-500 dark:text-gray-400 text-center py-8">
          {t('securityPerformance.comparisonNoData')}
        </p>
      ) : (
        <div className="h-96">
          <ResponsiveContainer width="100%" height="100%" minWidth={0}>
            <LineChart data={rows}>
              <CartesianGrid strokeDasharray="3 3" stroke={chartColors.grid} />
              <XAxis
                dataKey="ts"
                type="number"
                scale="time"
                domain={xAxis.domain}
                ticks={xAxis.ticks}
                tickFormatter={(ts: number) =>
                  formatChartDate(new Date(ts), xAxis.tickFormat)
                }
                tick={{ fontSize: 11 }}
              />
              <YAxis
                tickFormatter={(v: number) => formatSignedPercent(v)}
                domain={['auto', 'auto']}
                tick={{ fontSize: 11 }}
              />
              <Tooltip
                content={({ active, payload }) => {
                  if (!active || !payload?.length) return null;
                  const ts = (payload[0].payload as PerformanceRow).ts;
                  const items = payload
                    .filter((p) => typeof p.value === 'number')
                    .map((p) => ({
                      id: String(p.dataKey),
                      symbol: symbolById.get(String(p.dataKey)) ?? '',
                      value: p.value as number,
                      color: p.color as string,
                    }))
                    .sort((a, b) => b.value - a.value);
                  return (
                    <div className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg shadow-lg p-3 max-h-64 overflow-y-auto">
                      <p className="font-medium text-gray-900 dark:text-gray-100 mb-1">
                        {formatChartDate(new Date(ts), 'MMM d, yyyy')}
                      </p>
                      {items.map((item) => (
                        <p key={item.id} className="text-sm flex justify-between gap-3">
                          <span style={{ color: item.color }}>{item.symbol}</span>
                          <span className="text-gray-700 dark:text-gray-300">
                            {formatSignedPercent(item.value)}
                          </span>
                        </p>
                      ))}
                    </div>
                  );
                }}
              />
              <Legend />
              {series.map((s) => (
                <Line
                  key={s.id}
                  type="monotone"
                  dataKey={s.id}
                  name={s.symbol}
                  stroke={s.color}
                  strokeWidth={2}
                  dot={false}
                  connectNulls
                />
              ))}
            </LineChart>
          </ResponsiveContainer>
        </div>
      )}
    </div>
  );
}
