/** Inclusive ±`days` window around an ISO YYYY-MM-DD date, as ISO strings.
 *  UTC math avoids local-timezone drift. */
export function matchDateWindow(
  date: string,
  days = 7,
): { lo: string; hi: string } {
  const base = new Date(`${date}T00:00:00Z`);
  const lo = new Date(base);
  lo.setUTCDate(base.getUTCDate() - days);
  const hi = new Date(base);
  hi.setUTCDate(base.getUTCDate() + days);
  const fmt = (d: Date): string => d.toISOString().slice(0, 10);
  return { lo: fmt(lo), hi: fmt(hi) };
}
