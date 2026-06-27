import {
  format,
  startOfWeek,
  endOfWeek,
  subWeeks,
  startOfMonth,
  endOfMonth,
  subMonths,
  startOfYear,
  endOfYear,
  subYears,
  subDays,
} from 'date-fns';

export type TimePeriod =
  | 'today'
  | 'yesterday'
  | 'this_week'
  | 'last_week'
  | 'month_to_date'
  | 'last_month'
  | 'year_to_date'
  | 'last_year'
  | 'custom';

export const TIME_PERIOD_OPTIONS: Array<{ value: string; labelKey: string }> = [
  { value: '', labelKey: 'filter.periods.select' },
  { value: 'today', labelKey: 'filter.periods.today' },
  { value: 'yesterday', labelKey: 'filter.periods.yesterday' },
  { value: 'this_week', labelKey: 'filter.periods.thisWeek' },
  { value: 'last_week', labelKey: 'filter.periods.lastWeek' },
  { value: 'month_to_date', labelKey: 'filter.periods.monthToDate' },
  { value: 'last_month', labelKey: 'filter.periods.lastMonth' },
  { value: 'year_to_date', labelKey: 'filter.periods.yearToDate' },
  { value: 'last_year', labelKey: 'filter.periods.lastYear' },
  { value: 'custom', labelKey: 'filter.periods.custom' },
];

export function resolveTimePeriod(
  period: TimePeriod,
  weekStartsOn: 0 | 1 | 2 | 3 | 4 | 5 | 6 = 1
): { startDate: string; endDate: string } {
  const today = new Date();
  const fmt = (d: Date) => format(d, 'yyyy-MM-dd');

  switch (period) {
    case 'today':
      return { startDate: fmt(today), endDate: fmt(today) };

    case 'yesterday': {
      const yesterday = subDays(today, 1);
      return { startDate: fmt(yesterday), endDate: fmt(yesterday) };
    }

    case 'this_week':
      return {
        startDate: fmt(startOfWeek(today, { weekStartsOn })),
        endDate: fmt(today),
      };

    case 'last_week': {
      const lastWeekDate = subWeeks(today, 1);
      return {
        startDate: fmt(startOfWeek(lastWeekDate, { weekStartsOn })),
        endDate: fmt(endOfWeek(lastWeekDate, { weekStartsOn })),
      };
    }

    case 'month_to_date':
      return {
        startDate: fmt(startOfMonth(today)),
        endDate: fmt(today),
      };

    case 'last_month': {
      const lastMonthDate = subMonths(today, 1);
      return {
        startDate: fmt(startOfMonth(lastMonthDate)),
        endDate: fmt(endOfMonth(lastMonthDate)),
      };
    }

    case 'year_to_date':
      return {
        startDate: fmt(startOfYear(today)),
        endDate: fmt(today),
      };

    case 'last_year': {
      const lastYearDate = subYears(today, 1);
      return {
        startDate: fmt(startOfYear(lastYearDate)),
        endDate: fmt(endOfYear(lastYearDate)),
      };
    }

    case 'custom':
      return { startDate: '', endDate: '' };

    default:
      return { startDate: '', endDate: '' };
  }
}
