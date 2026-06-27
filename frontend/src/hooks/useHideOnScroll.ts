'use client';

import { useState, useEffect, useRef } from 'react';

interface UseHideOnScroll<T extends HTMLElement> {
  /** Attach to the sticky element so its height bounds the hide distance. */
  ref: React.RefObject<T | null>;
  /**
   * How far (px) the element is currently slid up: 0 when fully visible,
   * its full height when fully hidden. Tracks the scroll delta 1:1, so the
   * header moves at exactly the speed the user scrolls.
   */
  offset: number;
}

/**
 * Slides a sticky header out of view as the user scrolls down and back in as
 * they scroll up, moving it in lockstep with the scroll position rather than
 * on a fixed-duration animation.
 *
 * Each scroll frame the offset accumulates the scroll delta, clamped between 0
 * (fully visible) and the element's height (fully hidden). Reads are batched
 * through requestAnimationFrame and the listener is passive to keep scrolling
 * smooth.
 */
export function useHideOnScroll<
  T extends HTMLElement = HTMLElement,
>(): UseHideOnScroll<T> {
  const ref = useRef<T>(null);
  const [offset, setOffset] = useState(0);
  const lastScrollY = useRef(0);

  useEffect(() => {
    lastScrollY.current = Math.max(0, window.scrollY);
    let ticking = false;

    const update = () => {
      ticking = false;
      const currentY = Math.max(0, window.scrollY);
      const delta = currentY - lastScrollY.current;
      lastScrollY.current = currentY;
      if (delta === 0) return;

      const max = ref.current?.offsetHeight ?? 0;
      setOffset((prev) => {
        const next = Math.min(max, Math.max(0, prev + delta));
        return next === prev ? prev : next;
      });
    };

    const onScroll = () => {
      if (!ticking) {
        ticking = true;
        window.requestAnimationFrame(update);
      }
    };

    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  return { ref, offset };
}
