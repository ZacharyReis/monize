import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  buildIntradayCacheKey,
  ChartFlagShadowFilter,
  clearAllIntradayCache,
  computeMinMaxFlagIndices,
  computeTightYAxisDomain,
  INTRADAY_CACHE_PREFIX,
  niceAxisStep,
  readIntradayCache,
  renderChartFlagDot,
  renderMinMaxFlagDots,
  writeIntradayCache,
} from './portfolio-chart-utils';

describe('buildIntradayCacheKey', () => {
  it('builds key with defined account ids (sorted)', () => {
    const key = buildIntradayCacheKey('1d', ['z', 'a', 'm'], 'USD');
    expect(key).toBe(`${INTRADAY_CACHE_PREFIX}1d|a,m,z|USD`);
  });

  it('builds key with undefined account ids (null coalescing)', () => {
    const key = buildIntradayCacheKey('1w', undefined, 'EUR');
    expect(key).toBe(`${INTRADAY_CACHE_PREFIX}1w||EUR`);
  });

  it('builds key with empty account ids array', () => {
    const key = buildIntradayCacheKey('1m', [], 'GBP');
    expect(key).toBe(`${INTRADAY_CACHE_PREFIX}1m||GBP`);
  });
});

describe('readIntradayCache', () => {
  beforeEach(() => {
    sessionStorage.clear();
  });

  it('returns null when key does not exist', () => {
    expect(readIntradayCache('missing-key')).toBeNull();
  });

  it('returns parsed payload when key exists', () => {
    const payload = {
      fetchedAt: 1000,
      points: [{ timestamp: '2024-01-01T10:00:00Z', value: 100 }],
      interval: '1m' as const,
      currency: 'USD',
      fallbackToDaily: false,
      skippedSymbols: [],
    };
    sessionStorage.setItem('test-key', JSON.stringify(payload));
    expect(readIntradayCache('test-key')).toEqual(payload);
  });

  it('returns null when stored value is invalid JSON', () => {
    sessionStorage.setItem('bad-key', '{not valid json}');
    expect(readIntradayCache('bad-key')).toBeNull();
  });
});

describe('writeIntradayCache', () => {
  beforeEach(() => {
    sessionStorage.clear();
  });

  const payload = {
    fetchedAt: 2000,
    points: [],
    interval: '5m' as const,
    currency: 'USD',
    fallbackToDaily: false,
    skippedSymbols: ['AAPL'],
    failedSymbols: [],
  };

  it('writes payload to sessionStorage', () => {
    writeIntradayCache('write-key', payload);
    const stored = sessionStorage.getItem('write-key');
    expect(JSON.parse(stored!)).toEqual(payload);
  });

  it('does not throw when sessionStorage.setItem throws', () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementationOnce(() => {
      throw new DOMException('QuotaExceededError');
    });
    expect(() => writeIntradayCache('key', payload)).not.toThrow();
  });
});

describe('clearAllIntradayCache', () => {
  beforeEach(() => {
    sessionStorage.clear();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('removes all keys with the intraday cache prefix', () => {
    sessionStorage.setItem(`${INTRADAY_CACHE_PREFIX}1d||USD`, 'a');
    sessionStorage.setItem(`${INTRADAY_CACHE_PREFIX}1w||EUR`, 'b');
    sessionStorage.setItem('unrelated-key', 'c');

    clearAllIntradayCache();

    expect(sessionStorage.getItem(`${INTRADAY_CACHE_PREFIX}1d||USD`)).toBeNull();
    expect(sessionStorage.getItem(`${INTRADAY_CACHE_PREFIX}1w||EUR`)).toBeNull();
    expect(sessionStorage.getItem('unrelated-key')).toBe('c');
  });

  it('handles empty sessionStorage without error', () => {
    expect(() => clearAllIntradayCache()).not.toThrow();
  });

  it('skips null keys returned by sessionStorage.key()', () => {
    sessionStorage.setItem(`${INTRADAY_CACHE_PREFIX}1d||USD`, 'val');
    vi.spyOn(Storage.prototype, 'key').mockImplementation((i: number) => {
      return i === 0 ? null : null;
    });
    Object.defineProperty(Storage.prototype, 'length', { get: () => 1, configurable: true });
    expect(() => clearAllIntradayCache()).not.toThrow();
  });

  it('handles sessionStorage throwing during iteration', () => {
    vi.spyOn(Storage.prototype, 'key').mockImplementationOnce(() => {
      throw new Error('storage error');
    });
    Object.defineProperty(Storage.prototype, 'length', { get: () => 1, configurable: true });
    expect(() => clearAllIntradayCache()).not.toThrow();
  });
});

describe('niceAxisStep', () => {
  it('returns 1 for zero input', () => {
    expect(niceAxisStep(0)).toBe(1);
  });

  it('returns 1 for negative input', () => {
    expect(niceAxisStep(-5)).toBe(1);
  });

  it('returns nice step when f < 1.5 (nf=1)', () => {
    // raw=1.2: exp=0, magnitude=1, f=1.2 < 1.5 → nf=1, result=1
    expect(niceAxisStep(1.2)).toBe(1);
  });

  it('returns nice step when f >= 1.5 and f < 3 (nf=2)', () => {
    // raw=2: exp=0, magnitude=1, f=2, 1.5<=2<3 → nf=2, result=2
    expect(niceAxisStep(2)).toBe(2);
  });

  it('returns nice step when f >= 3 and f < 7 (nf=5)', () => {
    // raw=5: exp=0, magnitude=1, f=5, 3<=5<7 → nf=5, result=5
    expect(niceAxisStep(5)).toBe(5);
  });

  it('returns nice step when f >= 7 (nf=10)', () => {
    // raw=9: exp=0, magnitude=1, f=9 >= 7 → nf=10, result=10
    expect(niceAxisStep(9)).toBe(10);
  });

  it('handles larger values correctly', () => {
    // raw=250: exp=2, magnitude=100, f=2.5, 1.5<=2.5<3 → nf=2, result=200
    expect(niceAxisStep(250)).toBe(200);
  });
});

describe('computeTightYAxisDomain', () => {
  it('returns [0, auto] for empty array', () => {
    expect(computeTightYAxisDomain([])).toEqual([0, 'auto']);
  });

  it('handles flat-line (range === 0)', () => {
    const [min, max] = computeTightYAxisDomain([100, 100, 100]) as [number, number];
    expect(min).toBeLessThan(100);
    expect(max).toBeGreaterThan(100);
  });

  it('handles flat-line at zero (uses Math.max(0, 1) = 1 pad)', () => {
    const [min, max] = computeTightYAxisDomain([0, 0]) as [number, number];
    expect(min).toBeLessThan(0);
    expect(max).toBeGreaterThan(0);
  });

  it('handles values that cross zero', () => {
    const [min, max] = computeTightYAxisDomain([-10, 5]) as [number, number];
    expect(min).toBeLessThanOrEqual(-10);
    expect(max).toBeGreaterThanOrEqual(5);
  });

  it('handles all-positive values (minValue >= 0, clamps to 0)', () => {
    const [min, max] = computeTightYAxisDomain([10, 20, 30]) as [number, number];
    expect(min).toBeGreaterThanOrEqual(0);
    expect(max).toBeGreaterThan(30);
  });

  it('handles all-negative values (minValue < 0, clamps max to 0)', () => {
    const [min, max] = computeTightYAxisDomain([-30, -20, -10]) as [number, number];
    expect(min).toBeLessThan(-30);
    expect(max).toBeLessThanOrEqual(0);
  });

  it('handles single positive value', () => {
    const [min, max] = computeTightYAxisDomain([500]) as [number, number];
    // range=0, so flat-line path
    expect(min).toBeLessThan(500);
    expect(max).toBeGreaterThan(500);
  });
});

describe('renderChartFlagDot', () => {
  const baseOpts = { cx: 100, cy: 200, index: 3, color: '#10b981', label: '$1,234' };

  it('returns a ReactElement for side=above', () => {
    const el = renderChartFlagDot({ ...baseOpts, side: 'above' });
    expect(el).toBeTruthy();
    expect(typeof el).toBe('object');
  });

  it('returns a ReactElement for side=below', () => {
    const el = renderChartFlagDot({ ...baseOpts, side: 'below' });
    expect(el).toBeTruthy();
    expect(typeof el).toBe('object');
  });

  it('returns a ReactElement for side=right', () => {
    const el = renderChartFlagDot({ ...baseOpts, side: 'right' });
    expect(el).toBeTruthy();
    expect(typeof el).toBe('object');
  });

  it('returns a ReactElement for side=left', () => {
    const el = renderChartFlagDot({ ...baseOpts, side: 'left' });
    expect(el).toBeTruthy();
    expect(typeof el).toBe('object');
  });

  it('uses default gap=24 when gap is not specified', () => {
    const el = renderChartFlagDot({ ...baseOpts, side: 'above' });
    expect(el).toBeTruthy();
  });

  it('accepts custom gap value', () => {
    const el = renderChartFlagDot({ ...baseOpts, side: 'above', gap: 12 });
    expect(el).toBeTruthy();
  });

  it('adds a dismiss control wired to onDismiss when provided', () => {
    const onDismiss = vi.fn();
    const el = renderChartFlagDot({ ...baseOpts, side: 'right', onDismiss, dismissLabel: 'Hide' });
    const children = (el.props as any).children as any[];
    const closeButton = children.find((c: any) => c && c.props && c.props.role === 'button');
    expect(closeButton).toBeTruthy();
    expect(closeButton.props['aria-label']).toBe('Hide');
    closeButton.props.onClick({ stopPropagation: () => {} });
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });

  it('omits the dismiss control when onDismiss is absent', () => {
    const el = renderChartFlagDot({ ...baseOpts, side: 'right' });
    const children = (el.props as any).children as any[];
    const closeButton = children.find((c: any) => c && c.props && c.props.role === 'button');
    expect(closeButton).toBeFalsy();
  });
});

describe('ChartFlagShadowFilter', () => {
  it('returns a ReactElement', () => {
    const el = ChartFlagShadowFilter();
    expect(el).toBeTruthy();
    expect(typeof el).toBe('object');
  });
});

describe('computeMinMaxFlagIndices', () => {
  it('returns no flags for an empty series', () => {
    expect(computeMinMaxFlagIndices([])).toEqual({ maxIndex: -1, minIndex: -1, show: false });
  });

  it('suppresses the flags for a flat series', () => {
    expect(computeMinMaxFlagIndices([5, 5, 5])).toEqual({ maxIndex: 0, minIndex: 0, show: false });
  });

  it('finds the max and min indices', () => {
    expect(computeMinMaxFlagIndices([3, 9, 1, 7])).toEqual({ maxIndex: 1, minIndex: 2, show: true });
  });

  it('resolves ties to the first occurrence', () => {
    expect(computeMinMaxFlagIndices([4, 9, 9, 1, 1])).toEqual({ maxIndex: 1, minIndex: 3, show: true });
  });

  it('handles all-negative values', () => {
    expect(computeMinMaxFlagIndices([-2, -8, -1])).toEqual({ maxIndex: 2, minIndex: 1, show: true });
  });
});

describe('renderMinMaxFlagDots', () => {
  const flags = { maxIndex: 1, minIndex: 4, show: true };
  const base = {
    flags,
    pointCount: 6,
    highColor: '#10b981',
    lowColor: '#ef4444',
    highLabel: '$9',
    lowLabel: '$1',
  };

  it('renders an invisible dot for a non-extreme point', () => {
    const el = renderMinMaxFlagDots({ ...base, cx: 10, cy: 20, index: 2 });
    expect(el.type).toBe('circle');
  });

  it('renders a bubble group for the max point', () => {
    const el = renderMinMaxFlagDots({ ...base, cx: 10, cy: 20, index: 1 });
    expect(el.type).toBe('g');
  });

  it('renders a bubble group for the min point', () => {
    const el = renderMinMaxFlagDots({ ...base, cx: 10, cy: 20, index: 4 });
    expect(el.type).toBe('g');
  });

  it('renders an invisible dot when coordinates are missing', () => {
    const el = renderMinMaxFlagDots({ ...base, index: 1 });
    expect(el.type).toBe('circle');
  });

  it('renders an invisible dot when the flags are suppressed', () => {
    const el = renderMinMaxFlagDots({
      ...base,
      flags: { maxIndex: 0, minIndex: 0, show: false },
      cx: 10,
      cy: 20,
      index: 0,
    });
    expect(el.type).toBe('circle');
  });

  it('hides the high bubble when highDismissed is set', () => {
    const el = renderMinMaxFlagDots({ ...base, cx: 10, cy: 20, index: 1, highDismissed: true });
    expect(el.type).toBe('circle');
  });

  it('hides the low bubble when lowDismissed is set', () => {
    const el = renderMinMaxFlagDots({ ...base, cx: 10, cy: 20, index: 4, lowDismissed: true });
    expect(el.type).toBe('circle');
  });

  it('wires the high bubble dismiss control to onDismissHigh', () => {
    const onDismissHigh = vi.fn();
    const el = renderMinMaxFlagDots({
      ...base,
      cx: 10,
      cy: 20,
      index: 1,
      onDismissHigh,
      dismissLabel: 'Hide',
    });
    const children = (el.props as any).children as any[];
    const closeButton = children.find((c: any) => c && c.props && c.props.role === 'button');
    expect(closeButton).toBeTruthy();
    closeButton.props.onClick({ stopPropagation: () => {} });
    expect(onDismissHigh).toHaveBeenCalledTimes(1);
  });
});
