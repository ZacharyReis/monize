import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useAnchorRect } from './useAnchorRect';

/** An element whose reported rect can be moved and resized from a test. */
function anchorWithRect(rect: { top: number; left: number; width: number; height: number }) {
  const el = document.createElement('div');
  const current = { ...rect };
  el.getBoundingClientRect = () =>
    ({
      ...current,
      right: current.left + current.width,
      bottom: current.top + current.height,
      x: current.left,
      y: current.top,
      toJSON: () => current,
    }) as DOMRect;
  document.body.appendChild(el);
  return { el, moveTo: (next: Partial<typeof current>) => Object.assign(current, next) };
}

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
  document.body.replaceChildren();
});

describe('useAnchorRect', () => {
  it('reports nothing without an element', () => {
    const { result } = renderHook(() => useAnchorRect(null));
    expect(result.current).toBeNull();
  });

  it('measures the element it is given', () => {
    const { el } = anchorWithRect({ top: 10, left: 20, width: 100, height: 40 });
    const { result } = renderHook(() => useAnchorRect(el));

    act(() => {
      vi.advanceTimersByTime(50);
    });
    expect(result.current).toEqual({ top: 10, left: 20, width: 100, height: 40 });
  });

  it('follows a move that changes no size and fires no event', () => {
    // A scrollbar appearing when a list finishes loading shifts a right-aligned
    // button sideways: no resize, no scroll, so only the poll catches it.
    const { el, moveTo } = anchorWithRect({
      top: 10,
      left: 300,
      width: 100,
      height: 40,
    });
    const { result } = renderHook(() => useAnchorRect(el));
    act(() => {
      vi.advanceTimersByTime(50);
    });

    moveTo({ left: 284 });
    act(() => {
      vi.advanceTimersByTime(400);
    });
    expect(result.current!.left).toBe(284);
  });

  it('does not re-render while the rect is unchanged', () => {
    const { el } = anchorWithRect({ top: 10, left: 20, width: 100, height: 40 });
    const { result } = renderHook(() => useAnchorRect(el));
    act(() => {
      vi.advanceTimersByTime(50);
    });

    const measured = result.current;
    act(() => {
      vi.advanceTimersByTime(1000);
    });
    // Same object: the poll re-measured but never set state.
    expect(result.current).toBe(measured);
  });
});
