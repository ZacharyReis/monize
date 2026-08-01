import { findTourAnchor } from './anchors';
import type { TourStep } from './types';

/**
 * Whether a step can be shown again right now, i.e. whether it would stay on
 * screen if Back landed on it.
 *
 * Two ways it would not:
 *  - A step waiting for something to *appear* whose target is already on the
 *    page advances again the frame it is shown -- Back onto the step that opens
 *    the transaction form, while that form is still open, would bounce straight
 *    forward and read as a dead button.
 *  - A `skipOnBack` step depends on transient UI it does not open itself (the
 *    fields of a form), so it is replayable only while that UI -- its anchor --
 *    is still on the page.
 *
 * Everything else is: a centered step needs nothing, and an ordinary anchored
 * step gets its screen navigated to and its anchor waited for.
 */
function isReplayable(step: TourStep): boolean {
  if (
    step.advance?.type === 'appear' &&
    findTourAnchor(step.advance.anchorId)
  ) {
    return false;
  }
  if (!step.skipOnBack) return true;
  return step.anchorId === null || !!findTourAnchor(step.anchorId);
}

/**
 * The step Back should land on, or null when nothing behind the current step
 * can be replayed (so Back is not offered at all).
 */
export function backTargetIndex(
  steps: readonly TourStep[],
  stepIndex: number,
): number | null {
  for (let i = stepIndex - 1; i >= 0; i -= 1) {
    if (isReplayable(steps[i])) return i;
  }
  return null;
}
