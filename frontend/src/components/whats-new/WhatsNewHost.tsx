'use client';

import { useEffect, useState } from 'react';
import { useAuthStore } from '@/store/authStore';
import { useTourStore } from '@/store/tourStore';
import {
  useWhatsNewStore,
  consumeWhatsNewPendingForLogin,
  recordAnnouncedVersion,
} from '@/store/whatsNewStore';
import { whatsNewApi, type ReleaseNotes } from '@/lib/whats-new';
import { createLogger } from '@/lib/logger';
import { WhatsNewModal } from './WhatsNewModal';

const logger = createLogger('WhatsNew');

/**
 * Drives the "What's New" release-notes modal. Mounted once in the root layout
 * so it is present on every route, including the login screen.
 *
 * On load it fetches the current version's notes: authenticated users get the
 * per-user status (the backend suppresses it for acknowledged versions,
 * disabled preference, and demo instances); unauthenticated visitors get the
 * public notes so the login screen's version label can still open the modal
 * manually.
 *
 * The modal auto-opens only when the backend says the user is due this version
 * *and* this page load is a moment to deliver it: either it followed a login
 * (`markWhatsNewPendingForLogin`), or the version is one this browser has not
 * announced yet (`recordAnnouncedVersion`), which covers a deploy landing under
 * a session that never logs out. The backend status alone is version-scoped,
 * not session-scoped, so gating on it alone reopened the modal on every refresh
 * until acknowledged.
 */
export function WhatsNewHost() {
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);
  const isOpen = useWhatsNewStore((s) => s.isOpen);
  const open = useWhatsNewStore((s) => s.open);
  const close = useWhatsNewStore((s) => s.close);
  const closeForTour = useWhatsNewStore((s) => s.closeForTour);
  const resumeAfterTour = useWhatsNewStore((s) => s.resumeAfterTour);

  const [notes, setNotes] = useState<ReleaseNotes | null>(null);
  const [currentVersion, setCurrentVersion] = useState<string | undefined>(
    undefined,
  );
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;

    const request = isAuthenticated
      ? whatsNewApi.getWhatsNew()
      : whatsNewApi.getReleaseNotes();

    request
      .then((res) => {
        if (cancelled) return;
        setNotes(res.notes);
        setCurrentVersion(
          'currentVersion' in res ? res.currentVersion : res.version,
        );
        // `autoShow` says the user is *due* this version's digest; the two
        // client-side triggers say this page load is a moment to deliver it --
        // a fresh login, or a version this browser has not announced yet (so a
        // deploy under a long-lived session lands on the next refresh).
        // Without one of them the modal reopened on every refresh for as long
        // as the version stayed unacknowledged.
        //
        // Both are evaluated, never short-circuited: the login flag has to be
        // spent and the version recorded on every authenticated check, or a
        // load with nothing to show leaves a trigger armed for a later refresh.
        if ('autoShow' in res) {
          const cameFromLogin = consumeWhatsNewPendingForLogin();
          const isNewToThisBrowser = recordAnnouncedVersion(res.currentVersion);
          if ((cameFromLogin || isNewToThisBrowser) && res.autoShow && res.notes) {
            open();
          }
        }
      })
      .catch((error) => {
        // Non-fatal: the digest is a nicety, never block the app on it.
        logger.debug('Failed to load release notes', error);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [isAuthenticated, open]);

  // A tour started from the offer list has to have the modal out of its way (it
  // drives the app underneath), so bring the modal back once the tour is done --
  // with the tour just taken marked as viewed and the rest still on offer.
  // Without this, finishing a tour left no way back to the list short of
  // hunting through Settings.
  //
  // Only for a tour the user saw through to the end. A dismissal is the user
  // leaving, and one of its causes is a browser Back press during the tour
  // (TourHost treats unexpected navigation as a dismissal) -- reopening a
  // `pushHistory` modal on top of that would answer their Back with another
  // history entry. Anything else just drops the pending resume.
  useEffect(
    () =>
      useTourStore.subscribe((state, previous) => {
        const finished = previous.active?.tour.id;
        if (!finished || state.active) return;
        if (state.progress[finished]?.status === 'completed') {
          resumeAfterTour();
        } else {
          close();
        }
      }),
    [resumeAfterTour, close],
  );

  const handleDontShowAgain = () => {
    whatsNewApi.markSeen().catch((error) => {
      logger.debug('Failed to record release notes as seen', error);
    });
    close();
  };

  const handleShowNextLogin = () => {
    whatsNewApi.remindNextLogin().catch((error) => {
      logger.debug('Failed to reset release notes reminder', error);
    });
    close();
  };

  return (
    <WhatsNewModal
      isOpen={isOpen}
      notes={notes}
      loading={loading}
      authenticated={isAuthenticated}
      currentVersion={currentVersion}
      onClose={close}
      onTourStart={closeForTour}
      onShowNextLogin={handleShowNextLogin}
      onDontShowAgain={handleDontShowAgain}
    />
  );
}
