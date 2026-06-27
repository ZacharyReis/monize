import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { computeBalanceSummary } from './balance-history';

describe('computeBalanceSummary', () => {
  beforeEach(() => {
    // Lock "today" so tests are not date-dependent.
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-04-10T12:00:00Z'));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('returns null for an empty series', () => {
    expect(computeBalanceSummary([])).toBeNull();
  });

  it('summarises a fully past series with current = last point', () => {
    const summary = computeBalanceSummary([
      { date: '2026-01-01', balance: 1000 },
      { date: '2026-01-02', balance: 750 },
      { date: '2026-01-03', balance: 900 },
    ]);
    expect(summary).toEqual({
      startBalance: 1000,
      currentBalance: 900,
      endBalance: 900,
      hasFutureData: false,
      minBalance: 750,
      goesNegative: false,
    });
  });

  it('anchors current at the last point on or before today when the series extends into the future', () => {
    const summary = computeBalanceSummary([
      { date: '2026-03-01', balance: 2000 },
      { date: '2026-03-10', balance: 1500 },
      { date: '2026-04-01', balance: 1800 },
      { date: '2026-04-15', balance: 1900 },
    ]);
    expect(summary?.currentBalance).toBe(1800);
    expect(summary?.endBalance).toBe(1900);
    expect(summary?.hasFutureData).toBe(true);
  });

  it('does not flag future data when post-today points only carry the balance forward', () => {
    const summary = computeBalanceSummary([
      { date: '2026-01-01', balance: 1000 },
      { date: '2026-03-01', balance: 1500 },
      { date: '2026-06-01', balance: 1500 },
      { date: '2026-12-31', balance: 1500 },
    ]);
    expect(summary?.currentBalance).toBe(1500);
    expect(summary?.hasFutureData).toBe(false);
  });

  it('falls back to the starting balance when all points are in the future', () => {
    const summary = computeBalanceSummary([
      { date: '2026-05-01', balance: 300 },
      { date: '2026-06-01', balance: 400 },
    ]);
    expect(summary?.currentBalance).toBe(300);
    expect(summary?.hasFutureData).toBe(true);
  });

  it('flags a series that dips negative', () => {
    const summary = computeBalanceSummary([
      { date: '2026-01-01', balance: 100 },
      { date: '2026-01-02', balance: -50 },
    ]);
    expect(summary?.minBalance).toBe(-50);
    expect(summary?.goesNegative).toBe(true);
  });

  it('rounds balances to 2 decimals to match the plotted chart points', () => {
    const summary = computeBalanceSummary([
      { date: '2026-01-01', balance: 1000.005 },
      { date: '2026-01-02', balance: 899.996 },
    ]);
    expect(summary?.startBalance).toBe(1000.01);
    expect(summary?.currentBalance).toBe(900);
  });
});
