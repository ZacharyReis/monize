import { create } from 'zustand';

/**
 * Set for exactly one auto-show check, by `authStore.login()`.
 *
 * The backend's `autoShow` is pure persisted state -- enabled, unacknowledged
 * version, notes exist -- with no notion of a session, so on its own it stays
 * true across every page load and the digest reopened on each refresh. Arming
 * it at the one moment a real login happens makes it login-scoped, which is
 * what the dialog's own "Show at next login" button promises.
 *
 * sessionStorage, not the store: the OIDC callback lands on a fresh document,
 * so in-memory state would be gone by the time the host reads it. Per-tab and
 * cleared with the tab, which is the closest the browser gets to "this login".
 */
const LOGIN_PENDING_KEY = 'monize:whats-new-login-pending';

export function markWhatsNewPendingForLogin(): void {
  try {
    window.sessionStorage.setItem(LOGIN_PENDING_KEY, '1');
  } catch {
    // Storage blocked (private mode, hardened settings): the digest just does
    // not auto-open. Never fail a login over a nicety.
  }
}

/** Reads and clears the flag, so only the first check after a login sees it. */
export function consumeWhatsNewPendingForLogin(): boolean {
  try {
    const pending = window.sessionStorage.getItem(LOGIN_PENDING_KEY) !== null;
    if (pending) window.sessionStorage.removeItem(LOGIN_PENDING_KEY);
    return pending;
  } catch {
    return false;
  }
}

/**
 * The last app version this browser auto-showed the digest for.
 *
 * The second way in: a session that never logs out would otherwise wait for a
 * login it never performs, so a deploy landing under an open session should
 * announce itself on the next refresh.
 *
 * localStorage rather than sessionStorage deliberately. Scoping this per tab
 * would announce the same deploy once in every open tab; per browser it is
 * announced once, whichever tab refreshes first. The backend's `autoShow` still
 * gates it, so this can only surface a version the user has neither
 * acknowledged nor disabled.
 */
const ANNOUNCED_VERSION_KEY = 'monize:whats-new-announced-version';

/**
 * Records `version` as announced and reports whether it differs from what was
 * recorded before -- i.e. whether this browser is seeing it for the first time.
 * Storage failures report false, leaving login as the only trigger.
 */
export function recordAnnouncedVersion(version: string | undefined): boolean {
  if (!version) return false;
  try {
    const previous = window.localStorage.getItem(ANNOUNCED_VERSION_KEY);
    if (previous === version) return false;
    window.localStorage.setItem(ANNOUNCED_VERSION_KEY, version);
    return true;
  } catch {
    return false;
  }
}

/**
 * Controls the "What's New" release-notes modal. Kept separate from the data
 * fetching (handled by WhatsNewHost) so any component -- notably the clickable
 * version labels on the login screen and in Settings -- can reopen the modal.
 */
interface WhatsNewState {
  isOpen: boolean;
  /**
   * The modal stepped aside for a guided tour started from its offer list, so
   * it should come back when that tour ends -- the remaining tours are listed
   * there and were otherwise unreachable afterwards. A plain `close()` (the X,
   * the backdrop, "Don't show this again") clears the flag, so a modal the user
   * really closed stays closed.
   */
  pausedForTour: boolean;
  open: () => void;
  close: () => void;
  /** Step aside for a tour launched from the offer list. */
  closeForTour: () => void;
  /** Bring a paused modal back; a no-op when it was not paused for a tour. */
  resumeAfterTour: () => void;
}

export const useWhatsNewStore = create<WhatsNewState>((set, get) => ({
  isOpen: false,
  pausedForTour: false,
  open: () => set({ isOpen: true, pausedForTour: false }),
  close: () => set({ isOpen: false, pausedForTour: false }),
  closeForTour: () => set({ isOpen: false, pausedForTour: true }),
  resumeAfterTour: () => {
    if (!get().pausedForTour) return;
    set({ isOpen: true, pausedForTour: false });
  },
}));
