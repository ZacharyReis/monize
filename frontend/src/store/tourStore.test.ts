import { describe, it, expect, beforeEach, vi } from 'vitest';

const saveProgress = vi.fn().mockResolvedValue({ saved: true });
vi.mock('@/lib/tours-api', () => ({
  toursApi: { saveProgress: (...args: unknown[]) => saveProgress(...args) },
}));

import { useTourStore } from './tourStore';
import type { TourDefinition } from '@/lib/tours/types';

const TOUR: TourDefinition = {
  id: 'test/basics',
  area: 'intro',
  i18nPrefix: 'intro.basics',
  steps: [
    { id: 'a', route: '/dashboard', anchorId: null },
    { id: 'b', route: '/accounts', anchorId: null, skipOnMobile: true },
    { id: 'c', route: '/settings', anchorId: null },
  ],
};

/** A tour with an in-form step, for the Back-navigation cases. */
const FORM_TOUR: TourDefinition = {
  id: 'test/form',
  area: 'transactions',
  i18nPrefix: 'intro.basics',
  steps: [
    { id: 'welcome', anchorId: null },
    { id: 'openForm', route: '/transactions', anchorId: 'transactions-new-button' },
    {
      id: 'fields',
      route: '/transactions',
      anchorId: 'transaction-fields',
      skipOnBack: true,
    },
    { id: 'bills', route: '/bills', anchorId: null },
  ],
};

function setDesktop(isDesktop: boolean) {
  window.matchMedia = vi.fn().mockImplementation((query: string) => ({
    matches: isDesktop, // min-width:640 matches on desktop
    media: query,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    addListener: vi.fn(),
    removeListener: vi.fn(),
    dispatchEvent: vi.fn(),
  }));
}

describe('tourStore', () => {
  beforeEach(() => {
    useTourStore.setState({ active: null, progress: {}, progressLoaded: false });
    saveProgress.mockClear();
    setDesktop(true);
  });

  it('starts a tour at step 0 in the navigating phase', () => {
    useTourStore.getState().startTour(TOUR);
    const active = useTourStore.getState().active!;
    expect(active.stepIndex).toBe(0);
    expect(active.phase).toBe('navigating');
    expect(active.steps).toHaveLength(3);
  });

  it('filters skipOnMobile steps at start on a narrow viewport', () => {
    setDesktop(false);
    useTourStore.getState().startTour(TOUR);
    expect(useTourStore.getState().active!.steps).toHaveLength(2);
  });

  it('advances and goes back within bounds', () => {
    const store = useTourStore.getState();
    store.startTour(TOUR);
    store.next();
    expect(useTourStore.getState().active!.stepIndex).toBe(1);
    store.back();
    expect(useTourStore.getState().active!.stepIndex).toBe(0);
    // Back at 0 is a no-op.
    store.back();
    expect(useTourStore.getState().active!.stepIndex).toBe(0);
  });

  it('does not advance past the last step', () => {
    const store = useTourStore.getState();
    store.startTour(TOUR);
    store.next();
    store.next();
    store.next(); // already last
    expect(useTourStore.getState().active!.stepIndex).toBe(2);
  });

  it('finish completes and persists when nothing was skipped', () => {
    const store = useTourStore.getState();
    store.startTour(TOUR);
    store.finish();
    expect(useTourStore.getState().active).toBeNull();
    expect(useTourStore.getState().progress['test/basics'].status).toBe(
      'completed',
    );
    expect(saveProgress).toHaveBeenCalledWith('test/basics', 'completed');
  });

  it('skip records skipped steps and shows the outro at the end', () => {
    const store = useTourStore.getState();
    store.startTour(TOUR);
    store.skip(); // skip a -> index 1, skippedCount 1
    store.skip(); // skip b -> index 2, skippedCount 2
    store.skip(); // skip c (last) -> finish -> outro
    const active = useTourStore.getState().active!;
    expect(active.showSkippedOutro).toBe(true);
    expect(active.skippedCount).toBe(3);
    // The tour is still active (showing the outro), not yet persisted.
    expect(saveProgress).not.toHaveBeenCalled();

    // Done on the outro completes the tour.
    store.finish();
    expect(useTourStore.getState().active).toBeNull();
    expect(saveProgress).toHaveBeenCalledWith('test/basics', 'completed');
  });

  it('fast-forwards while skipping and stops once a step goes active', () => {
    const store = useTourStore.getState();
    store.startTour(TOUR);
    expect(useTourStore.getState().active!.fastForward).toBe(false);

    // Skipping arms the short anchor grace period for the next step...
    store.skip();
    expect(useTourStore.getState().active!.fastForward).toBe(true);
    // ...and it stays armed across a run of unreachable steps.
    store.skip();
    expect(useTourStore.getState().active!.fastForward).toBe(true);

    // Landing on a step that resolves ends the fast-forward.
    useTourStore.getState().setPhase('active');
    expect(useTourStore.getState().active!.fastForward).toBe(false);
  });

  it('clears fast-forward when the user drives the tour with Next or Back', () => {
    const store = useTourStore.getState();
    store.startTour(TOUR);
    store.skip();
    expect(useTourStore.getState().active!.fastForward).toBe(true);

    useTourStore.getState().next();
    expect(useTourStore.getState().active!.fastForward).toBe(false);

    useTourStore.getState().skip();
    useTourStore.getState().back();
    expect(useTourStore.getState().active!.fastForward).toBe(false);
  });

  it('back walks past steps whose transient UI is gone', () => {
    const store = useTourStore.getState();
    store.startTour(FORM_TOUR);
    store.next(); // openForm
    store.next(); // fields (in-form)
    store.next(); // bills
    expect(useTourStore.getState().active!.stepIndex).toBe(3);

    // The form has been closed, so the in-form step cannot be shown again:
    // Back has to land on the step that reopens it, not inside it.
    useTourStore.getState().back();
    expect(useTourStore.getState().active!.stepIndex).toBe(1);
  });

  it('back returns to an in-form step while the form is still open', () => {
    const anchor = document.createElement('div');
    anchor.setAttribute('data-tour-id', 'transaction-fields');
    document.body.appendChild(anchor);
    try {
      const store = useTourStore.getState();
      store.startTour(FORM_TOUR);
      store.next();
      store.next();
      store.next(); // bills, with the form still on screen
      useTourStore.getState().back();
      expect(useTourStore.getState().active!.stepIndex).toBe(2);
    } finally {
      anchor.remove();
    }
  });

  it('omit advances without counting the step as skipped', () => {
    const store = useTourStore.getState();
    store.startTour(TOUR);
    store.omit();

    const active = useTourStore.getState().active!;
    expect(active.stepIndex).toBe(1);
    // Deliberate omission, so the tour must not end on the degraded outro.
    expect(active.skippedCount).toBe(0);
    // A run of omissions should not each wait out an anchor timeout.
    expect(active.fastForward).toBe(true);

    useTourStore.getState().finish();
    expect(useTourStore.getState().active).toBeNull();
    expect(saveProgress).toHaveBeenCalledWith('test/basics', 'completed');
  });

  it('endTour dismissed persists a dismissal', () => {
    const store = useTourStore.getState();
    store.startTour(TOUR);
    store.endTour('dismissed');
    expect(useTourStore.getState().active).toBeNull();
    expect(saveProgress).toHaveBeenCalledWith('test/basics', 'dismissed');
    expect(useTourStore.getState().progress['test/basics'].status).toBe(
      'dismissed',
    );
  });

  it('setProgress marks progress as loaded', () => {
    useTourStore
      .getState()
      .setProgress({ 'x/y': { status: 'completed', updatedAt: 'now' } });
    expect(useTourStore.getState().progressLoaded).toBe(true);
    expect(useTourStore.getState().progress['x/y'].status).toBe('completed');
  });

  it('setPhase and setExpectedRoute update the active tour', () => {
    const store = useTourStore.getState();
    store.startTour(TOUR);
    store.setPhase('active');
    store.setExpectedRoute('/accounts');
    const active = useTourStore.getState().active!;
    expect(active.phase).toBe('active');
    expect(active.expectedRoute).toBe('/accounts');
  });

  it('ignores actions when no tour is active', () => {
    const store = useTourStore.getState();
    store.next();
    store.back();
    store.skip();
    store.finish();
    store.endTour('completed');
    store.setPhase('active');
    expect(useTourStore.getState().active).toBeNull();
    expect(saveProgress).not.toHaveBeenCalled();
  });
});
