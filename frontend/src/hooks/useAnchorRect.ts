import { useEffect, useRef, useState } from 'react';
import type { Rect } from '@/lib/tours/positioning';

/** How often to re-check for rect changes no observer or event reports. */
const POLL_MS = 250;

function toRect(domRect: DOMRect): Rect {
  return {
    top: domRect.top,
    left: domRect.left,
    width: domRect.width,
    height: domRect.height,
  };
}

function sameRect(a: Rect | null, b: Rect): boolean {
  return (
    !!a &&
    a.top === b.top &&
    a.left === b.left &&
    a.width === b.width &&
    a.height === b.height
  );
}

/**
 * Track the live viewport rect of an element, updating on resize and on
 * scroll/window-resize (rAF-throttled so a scroll never floods layout work).
 * Returns null when there is no element (e.g. a centered tour step).
 *
 * A ResizeObserver fires only when the element's own box changes size, and
 * scroll events only cover scrolling, so an ordinary reflow that *moves* the
 * element would go unnoticed -- a vertical scrollbar appearing once a list
 * finishes loading shifts a right-aligned button sideways, leaving the
 * spotlight ringing empty space beside it. A cheap poll covers that: it
 * re-measures and re-renders only when the rect actually changed.
 */
export function useAnchorRect(element: HTMLElement | null): Rect | null {
  const [rect, setRect] = useState<Rect | null>(null);
  // Mirrors the state, so the poll can compare without re-subscribing.
  const latest = useRef<Rect | null>(null);

  // Drop the previous element's rect immediately when the target changes.
  const [prevElement, setPrevElement] = useState(element);
  if (element !== prevElement) {
    setPrevElement(element);
    setRect(null);
  }

  useEffect(() => {
    // Effect, not render: the comparison baseline belongs to this element, and
    // refs must not be written while rendering.
    latest.current = null;
    if (!element) return;

    let raf = 0;
    const measure = () => {
      const next = toRect(element.getBoundingClientRect());
      if (sameRect(latest.current, next)) return;
      latest.current = next;
      setRect(next);
    };
    const schedule = () => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(measure);
    };

    const observer = new ResizeObserver(schedule);
    observer.observe(element);
    window.addEventListener('scroll', schedule, true);
    window.addEventListener('resize', schedule);
    const poll = setInterval(schedule, POLL_MS);
    schedule();

    return () => {
      cancelAnimationFrame(raf);
      clearInterval(poll);
      observer.disconnect();
      window.removeEventListener('scroll', schedule, true);
      window.removeEventListener('resize', schedule);
    };
  }, [element]);

  return rect;
}
