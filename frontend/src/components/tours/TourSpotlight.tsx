'use client';

import { createPortal } from 'react-dom';
import { inflateRect, type Rect } from '@/lib/tours/positioning';

interface TourSpotlightProps {
  /** The anchor rect to cut out, or null for a centered step (full backdrop). */
  rect: Rect | null;
  /** Interactive steps leave the hole clickable (no blocker over it). */
  interactive: boolean;
  /**
   * Make the dimmed area click-through too, not just the hole. Needed by steps
   * that ask the user to fill in the spotlit control, because a field's popup
   * (a combobox list, a date picker) renders outside the cutout and would
   * otherwise sit under the dim and be unclickable.
   */
  passThrough?: boolean;
  /**
   * Whether to darken the page at all. `false` keeps just the ring around the
   * anchor (and renders nothing for an anchorless step), for steps that are
   * introducing a whole screen the user should be able to read and use.
   */
  dim?: boolean;
  /** Disable the cutout animation for reduced-motion users. */
  reducedMotion: boolean;
}

/** Padding around the anchor inside the spotlight cutout. */
const HOLE_PADDING = 6;

const DIM = 'bg-black/50';

/**
 * The dimming overlay with a cutout around the current anchor. Rendered above
 * the Modal backdrop (z-50) at z-[60]. Four dimming panels frame the hole so
 * the highlighted control stays fully lit; a ring outlines it. Passive steps
 * add a transparent blocker over the hole so the page cannot be clicked
 * mid-explanation; interactive steps omit it so only the anchor is clickable.
 * Clicks on the dimmed area are inert by default (they neither pass through nor
 * dismiss); `passThrough` makes the dim visual-only for form-filling steps,
 * whose field popups open outside the cutout.
 */
export function TourSpotlight({
  rect,
  interactive,
  passThrough = false,
  dim = true,
  reducedMotion,
}: TourSpotlightProps) {
  const stop = (e: React.MouseEvent) => e.stopPropagation();
  const transition = reducedMotion ? '' : 'transition-all duration-200';
  // Dimming panels normally swallow clicks to keep the page inert; a
  // pass-through step dims visually only.
  const panelEvents = passThrough ? '' : 'pointer-events-auto';
  const onPanelClick = passThrough ? undefined : stop;

  // Undimmed: ring the anchor so the step still points somewhere, and leave
  // the page fully visible and usable. An anchorless step has nothing to ring.
  if (!dim) {
    if (!rect) return null;
    const ring = inflateRect(rect, HOLE_PADDING);
    return createPortal(
      <div
        className={`pointer-events-none fixed rounded-md ring-2 ring-blue-500 ${transition}`}
        style={{
          top: ring.top,
          left: ring.left,
          width: ring.width,
          height: ring.height,
          zIndex: 60,
        }}
        aria-hidden="true"
      />,
      document.body,
    );
  }

  if (!rect) {
    // Interactive centered steps (e.g. "close the form to continue") must let
    // clicks reach the page beneath, so the dim is visual-only there.
    return createPortal(
      <div
        className={`fixed inset-0 z-[60] ${DIM} ${
          interactive ? 'pointer-events-none' : ''
        }`}
        onClick={interactive ? undefined : stop}
        aria-hidden="true"
      />,
      document.body,
    );
  }

  const hole = inflateRect(rect, HOLE_PADDING);
  const holeRight = hole.left + hole.width;
  const holeBottom = hole.top + hole.height;

  return createPortal(
    <div className="fixed inset-0 z-[60] pointer-events-none" aria-hidden="true">
      {/* Top */}
      <div
        className={`fixed left-0 top-0 w-full ${DIM} ${transition} ${panelEvents}`}
        style={{ height: Math.max(0, hole.top) }}
        onClick={onPanelClick}
      />
      {/* Bottom */}
      <div
        className={`fixed left-0 w-full ${DIM} ${transition} ${panelEvents}`}
        style={{ top: holeBottom, bottom: 0 }}
        onClick={onPanelClick}
      />
      {/* Left */}
      <div
        className={`fixed left-0 ${DIM} ${transition} ${panelEvents}`}
        style={{ top: hole.top, height: hole.height, width: Math.max(0, hole.left) }}
        onClick={onPanelClick}
      />
      {/* Right */}
      <div
        className={`fixed ${DIM} ${transition} ${panelEvents}`}
        style={{ top: hole.top, height: hole.height, left: holeRight, right: 0 }}
        onClick={onPanelClick}
      />
      {/* Ring around the hole */}
      <div
        className={`fixed rounded-md ring-2 ring-blue-500 ${transition}`}
        style={{
          top: hole.top,
          left: hole.left,
          width: hole.width,
          height: hole.height,
        }}
      />
      {/* Passive hole blocker: swallows clicks so the page is inert while the
          engine explains the control. Interactive steps omit this. */}
      {!interactive && (
        <div
          className="fixed pointer-events-auto"
          style={{
            top: hole.top,
            left: hole.left,
            width: hole.width,
            height: hole.height,
          }}
          onClick={stop}
        />
      )}
    </div>,
    document.body,
  );
}
