'use client';

import { PerformanceSummary } from '@/lib/monte-carlo';
import { InfoTooltip } from '@/components/ui/InfoTooltip';
import { useTranslations } from 'next-intl';

export type SummaryRow = {
  label: string;
  description: string;
  band: PerformanceSummary[keyof PerformanceSummary];
  format: 'currency' | 'percent' | 'ratio';
};

// Kept for backward-compatibility in callers that only need English CSV/PDF headers.
export const PERFORMANCE_SUMMARY_HEADERS = [
  'Summary Statistics',
  '10th Percentile',
  '25th Percentile',
  '50th Percentile',
  '75th Percentile',
  '90th Percentile',
];

export type TranslationFn = (key: string) => string;

export function buildPerformanceSummaryRows(
  summary: PerformanceSummary,
  t?: TranslationFn,
): SummaryRow[] {
  const label = (key: string, fallback: string) => (t ? t(key) : fallback);
  return [
    {
      label: label('monteCarloPerformance.rowTwrNominalLabel', 'Time Weighted Rate of Return (nominal)'),
      description: label('monteCarloPerformance.rowTwrNominalDesc', 'Geometric mean of the simulated annual returns. Ignores cash flows and is reported in nominal terms (not adjusted for inflation).'),
      band: summary.twrNominal,
      format: 'percent',
    },
    {
      label: label('monteCarloPerformance.rowTwrRealLabel', 'Time Weighted Rate of Return (real)'),
      description: label('monteCarloPerformance.rowTwrRealDesc', "Geometric mean of the simulated annual returns, adjusted for inflation so the result is in today's purchasing power."),
      band: summary.twrReal,
      format: 'percent',
    },
    {
      label: label('monteCarloPerformance.rowEndBalanceNominalLabel', 'Portfolio End Balance (nominal)'),
      description: label('monteCarloPerformance.rowEndBalanceNominalDesc', 'Final portfolio value at the end of the simulation horizon, in future-dollar (nominal) terms.'),
      band: summary.endBalanceNominal,
      format: 'currency',
    },
    {
      label: label('monteCarloPerformance.rowEndBalanceRealLabel', 'Portfolio End Balance (real)'),
      description: label('monteCarloPerformance.rowEndBalanceRealDesc', "Final portfolio value discounted back to today's purchasing power using the inflation rate."),
      band: summary.endBalanceReal,
      format: 'currency',
    },
    {
      label: label('monteCarloPerformance.rowMeanReturnNominalLabel', 'Annual Mean Return (nominal)'),
      description: label('monteCarloPerformance.rowMeanReturnNominalDesc', 'Arithmetic average of the simulated annual returns. Always greater than or equal to the time-weighted return when volatility is non-zero.'),
      band: summary.meanReturnNominal,
      format: 'percent',
    },
    {
      label: label('monteCarloPerformance.rowAnnualizedVolatilityLabel', 'Annualized Volatility'),
      description: label('monteCarloPerformance.rowAnnualizedVolatilityDesc', 'Standard deviation of the simulated annual returns — a measure of how much returns vary year-to-year.'),
      band: summary.annualizedVolatility,
      format: 'percent',
    },
    {
      label: label('monteCarloPerformance.rowMaxDrawdownLabel', 'Maximum Drawdown'),
      description: label('monteCarloPerformance.rowMaxDrawdownDesc', 'Largest peak-to-trough drop in portfolio value during the simulation, including the effect of contributions and withdrawals.'),
      band: summary.maxDrawdown,
      format: 'percent',
    },
    {
      label: label('monteCarloPerformance.rowMaxDrawdownExCashflowsLabel', 'Maximum Drawdown Excluding Cashflows'),
      description: label('monteCarloPerformance.rowMaxDrawdownExCashflowsDesc', 'Largest peak-to-trough drop driven purely by investment returns, ignoring contributions and withdrawals.'),
      band: summary.maxDrawdownExcludingCashflows,
      format: 'percent',
    },
    {
      label: label('monteCarloPerformance.rowSafeWithdrawalRateLabel', 'Safe Withdrawal Rate'),
      description: label('monteCarloPerformance.rowSafeWithdrawalRateDesc', 'Largest constant inflation-adjusted withdrawal, expressed as a percentage of the starting balance, that exactly depletes the portfolio at the end of the horizon.'),
      band: summary.safeWithdrawalRate,
      format: 'percent',
    },
    {
      label: label('monteCarloPerformance.rowPerpetualWithdrawalRateLabel', 'Perpetual Withdrawal Rate'),
      description: label('monteCarloPerformance.rowPerpetualWithdrawalRateDesc', 'Largest constant inflation-adjusted withdrawal, as a percentage of the starting balance, that preserves the real value of the portfolio at the end of the horizon.'),
      band: summary.perpetualWithdrawalRate,
      format: 'percent',
    },
  ];
}

export function formatSummaryValue(
  v: number,
  kind: SummaryRow['format'],
  formatCurrency: (v: number) => string,
): string {
  if (!Number.isFinite(v)) return '—';
  if (kind === 'currency') return formatCurrency(v);
  if (kind === 'percent') return `${(v * 100).toFixed(2)}%`;
  return v.toFixed(2);
}

export function PerformanceSummaryTable({
  summary,
  formatCurrency,
}: {
  summary: PerformanceSummary;
  formatCurrency: (v: number) => string;
}) {
  const t = useTranslations('reports');
  const rows = buildPerformanceSummaryRows(summary, t as TranslationFn);
  const formatValue = (v: number, kind: SummaryRow['format']): string =>
    formatSummaryValue(v, kind, formatCurrency);

  return (
    <div className="overflow-x-auto">
      <table className="min-w-full text-xs">
        <thead className="bg-gray-50 dark:bg-gray-900/40 text-gray-500 dark:text-gray-400">
          <tr>
            <th className="px-3 py-2 text-left font-medium">
              {t('monteCarloPerformance.colSummaryStatistics')}
            </th>
            <th className="px-3 py-2 text-right font-medium">{t('monteCarloPerformance.col10thPercentile')}</th>
            <th className="px-3 py-2 text-right font-medium">{t('monteCarloPerformance.col25thPercentile')}</th>
            <th className="px-3 py-2 text-right font-semibold text-gray-700 dark:text-gray-200 bg-blue-50 dark:bg-blue-900/30">
              {t('monteCarloPerformance.col50thPercentile')}
            </th>
            <th className="px-3 py-2 text-right font-medium">{t('monteCarloPerformance.col75thPercentile')}</th>
            <th className="px-3 py-2 text-right font-medium">{t('monteCarloPerformance.col90thPercentile')}</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-200 dark:divide-gray-700">
          {rows.map((row) => (
            <tr key={row.label}>
              <td className="px-3 py-1.5 text-gray-900 dark:text-gray-100">
                {row.label}
                <InfoTooltip text={row.description} />
              </td>
              <td className="px-3 py-1.5 text-right">
                {formatValue(row.band.p10, row.format)}
              </td>
              <td className="px-3 py-1.5 text-right">
                {formatValue(row.band.p25, row.format)}
              </td>
              <td className="px-3 py-1.5 text-right font-semibold text-gray-900 dark:text-gray-100 bg-blue-50 dark:bg-blue-900/30">
                {formatValue(row.band.p50, row.format)}
              </td>
              <td className="px-3 py-1.5 text-right">
                {formatValue(row.band.p75, row.format)}
              </td>
              <td className="px-3 py-1.5 text-right">
                {formatValue(row.band.p90, row.format)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
