import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';
import { useReportData } from './useReportData';

vi.mock('@/lib/logger', () => ({
  createLogger: () => ({ error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() }),
}));

describe('useReportData', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('starts in a loading state with no data or error', () => {
    const fetcher = vi.fn(() => new Promise<number>(() => {}));
    const { result } = renderHook(() => useReportData(fetcher, []));
    expect(result.current.isLoading).toBe(true);
    expect(result.current.data).toBeNull();
    expect(result.current.error).toBeNull();
  });

  it('loads data and clears loading on success', async () => {
    const fetcher = vi.fn(async () => ({ value: 42 }));
    const { result } = renderHook(() => useReportData(fetcher, []));
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.data).toEqual({ value: 42 });
    expect(result.current.error).toBeNull();
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it('surfaces an Error on failure and stops loading', async () => {
    const err = new Error('boom');
    const fetcher = vi.fn(async () => {
      throw err;
    });
    const { result } = renderHook(() => useReportData(fetcher, []));
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.error).toBe(err);
    expect(result.current.data).toBeNull();
  });

  it('wraps non-Error rejections in an Error', async () => {
    const fetcher = vi.fn(async () => {
      throw 'string failure';
    });
    const { result } = renderHook(() => useReportData(fetcher, []));
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.error).toBeInstanceOf(Error);
    expect(result.current.error?.message).toBe('string failure');
  });

  it('re-runs when deps change', async () => {
    const fetcher = vi.fn(async (n: number) => n * 2);
    let dep = 1;
    const { result, rerender } = renderHook(() => useReportData(() => fetcher(dep), [dep]));
    await waitFor(() => expect(result.current.data).toBe(2));
    dep = 5;
    rerender();
    await waitFor(() => expect(result.current.data).toBe(10));
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it('reload re-runs the fetcher and clears a prior error', async () => {
    let shouldFail = true;
    const fetcher = vi.fn(async () => {
      if (shouldFail) throw new Error('fail');
      return 'ok';
    });
    const { result } = renderHook(() => useReportData(fetcher, []));
    await waitFor(() => expect(result.current.error).not.toBeNull());

    shouldFail = false;
    act(() => {
      result.current.reload();
    });
    await waitFor(() => expect(result.current.data).toBe('ok'));
    expect(result.current.error).toBeNull();
  });

  it('ignores a stale response when deps change mid-flight', async () => {
    const resolvers: Array<(v: string) => void> = [];
    const fetcher = vi.fn(
      () =>
        new Promise<string>((resolve) => {
          resolvers.push(resolve);
        }),
    );
    let dep = 1;
    const { result, rerender } = renderHook(() => useReportData(() => fetcher(), [dep]));
    dep = 2;
    rerender();
    // Resolve the second (latest) call first, then the stale first call.
    act(() => resolvers[1]('latest'));
    await waitFor(() => expect(result.current.data).toBe('latest'));
    act(() => resolvers[0]('stale'));
    // Stale resolution must not overwrite the latest data.
    expect(result.current.data).toBe('latest');
  });
});
