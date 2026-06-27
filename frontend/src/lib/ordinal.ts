/**
 * Format a day-of-month number as an English ordinal (1 -> "1st", 22 -> "22nd").
 * Used for credit-card statement due/settlement days.
 */
export function getOrdinal(day: number): string {
  const suffix =
    day >= 11 && day <= 13
      ? 'th'
      : day % 10 === 1
        ? 'st'
        : day % 10 === 2
          ? 'nd'
          : day % 10 === 3
            ? 'rd'
            : 'th';
  return `${day}${suffix}`;
}
