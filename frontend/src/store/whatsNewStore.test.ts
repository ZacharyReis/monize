import { describe, it, expect, beforeEach } from 'vitest';
import { useWhatsNewStore } from './whatsNewStore';

describe('whatsNewStore', () => {
  beforeEach(() => {
    useWhatsNewStore.setState({ isOpen: false, pausedForTour: false });
  });

  it('opens and closes the modal', () => {
    expect(useWhatsNewStore.getState().isOpen).toBe(false);

    useWhatsNewStore.getState().open();
    expect(useWhatsNewStore.getState().isOpen).toBe(true);

    useWhatsNewStore.getState().close();
    expect(useWhatsNewStore.getState().isOpen).toBe(false);
  });

  it('comes back after a tour it stepped aside for', () => {
    useWhatsNewStore.getState().open();
    useWhatsNewStore.getState().closeForTour();
    expect(useWhatsNewStore.getState().isOpen).toBe(false);

    useWhatsNewStore.getState().resumeAfterTour();
    expect(useWhatsNewStore.getState().isOpen).toBe(true);
    // One resume only: the next tour has to pause it again.
    useWhatsNewStore.getState().close();
    useWhatsNewStore.getState().resumeAfterTour();
    expect(useWhatsNewStore.getState().isOpen).toBe(false);
  });

  it('stays closed when the user closed it themselves', () => {
    useWhatsNewStore.getState().open();
    useWhatsNewStore.getState().close();

    useWhatsNewStore.getState().resumeAfterTour();
    expect(useWhatsNewStore.getState().isOpen).toBe(false);
  });

  it('clears a pending resume when the modal is reopened by hand', () => {
    useWhatsNewStore.getState().closeForTour();
    useWhatsNewStore.getState().open();
    expect(useWhatsNewStore.getState().pausedForTour).toBe(false);
  });
});
