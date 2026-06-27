'use client';

import { useEffect, useState } from 'react';
import { usePathname } from 'next/navigation';
import dynamic from 'next/dynamic';
import { useTranslations } from 'next-intl';
import { usePreferencesStore } from '@/store/preferencesStore';
import { useIsMobile } from '@/hooks/useIsMobile';
import { LoadingSpinner } from '@/components/ui/LoadingSpinner';

// The chat pulls in markdown/chart dependencies, so load it only when the
// bubble is actually opened (and never on the server) to keep it out of the
// global bundle that ships on every authenticated page.
const ChatInterface = dynamic(
  () => import('./ChatInterface').then((m) => m.ChatInterface),
  {
    ssr: false,
    loading: () => (
      <div className="flex flex-1 items-center justify-center">
        <LoadingSpinner />
      </div>
    ),
  },
);

// Routes where the bubble is suppressed. The dedicated full-page chat already
// renders ChatInterface, so a bubble there would duplicate it.
const HIDE_ON = ['/ai'];

type View = 'closed' | 'sheet' | 'full';

/**
 * App-wide floating AI assistant. A corner launcher opens a bottom sheet that
 * can expand to full screen in place and collapse back. It renders the same
 * <ChatInterface /> as the /ai page; because that component is backed by the
 * singleton aiChatStore, the conversation is shared between the two surfaces.
 *
 * Mounted once in SwipeShell's authenticated branch, so it self-gates on the
 * opt-in preference and the current route.
 */
export function AiChatBubble() {
  const t = useTranslations('ai.bubble');
  const pathname = usePathname();
  const enabled = usePreferencesStore((s) => s.preferences?.aiBubbleEnabled);
  const isMobile = useIsMobile();
  const [view, setView] = useState<View>('closed');

  // Collapse the assistant whenever the route changes (setState during render
  // pattern; a useEffect here would trip react-hooks/set-state-in-effect).
  // Exception: a desktop corner sheet (open, not full-screen) stays open so it
  // persists across pages -- it is non-blocking, so the user can keep chatting
  // while navigating. The full-screen overlay and the mobile bottom sheet (which
  // covers the page behind a scrim) still collapse on navigation.
  const [prevPath, setPrevPath] = useState(pathname);
  if (pathname !== prevPath) {
    setPrevPath(pathname);
    const keepDesktopSheetOpen = view === 'sheet' && !isMobile;
    if (view !== 'closed' && !keepDesktopSheetOpen) setView('closed');
  }

  // Escape steps down one level: full -> sheet -> closed.
  useEffect(() => {
    if (view === 'closed') return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setView((v) => (v === 'full' ? 'sheet' : 'closed'));
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [view]);

  // Lock background scroll only when fully maximized (it covers the viewport).
  useEffect(() => {
    if (view !== 'full') return;
    const previous = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = previous;
    };
  }, [view]);

  if (!enabled) return null;
  if (pathname && HIDE_ON.includes(pathname)) return null;

  if (view === 'closed') {
    return (
      <button
        type="button"
        onClick={() => setView('sheet')}
        aria-label={t('launcherAriaLabel')}
        className="fixed bottom-4 right-4 z-30 flex h-14 w-14 items-center justify-center rounded-full bg-blue-600 text-white shadow-lg transition-colors hover:bg-blue-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-2 dark:focus-visible:ring-offset-gray-900"
      >
        <ChatIcon className="h-6 w-6" />
      </button>
    );
  }

  const isFull = view === 'full';

  const panelClass = isFull
    ? 'fixed inset-0 z-50 flex flex-col bg-white dark:bg-gray-800'
    : [
        'fixed z-40 flex flex-col bg-white dark:bg-gray-800 shadow-2xl',
        'inset-x-0 bottom-0 h-[75dvh] rounded-t-2xl border-t border-gray-200 dark:border-gray-700',
        'sm:inset-x-auto sm:right-4 sm:bottom-4 sm:h-[600px] sm:max-h-[calc(100dvh-6rem)] sm:w-[420px] sm:rounded-2xl sm:border',
      ].join(' ');

  return (
    <>
      {/* Mobile-only scrim for the bottom sheet; the desktop corner panel is
          non-blocking so the user can keep working behind it. */}
      {!isFull && (
        <div
          className="fixed inset-0 z-40 bg-black/30 sm:hidden"
          aria-hidden="true"
          onClick={() => setView('closed')}
        />
      )}

      <div
        role="dialog"
        aria-modal={isFull || undefined}
        aria-label={t('title')}
        className={panelClass}
      >
        {/* Header */}
        <div className="flex items-center justify-between border-b border-gray-200 px-4 py-3 dark:border-gray-700">
          <h2 className="text-sm font-semibold text-gray-900 dark:text-gray-100">
            {t('title')}
          </h2>
          <div className="flex items-center gap-1">
            {isFull ? (
              <button
                type="button"
                onClick={() => setView('sheet')}
                aria-label={t('collapse')}
                title={t('collapse')}
                className="rounded-md p-1.5 text-gray-500 transition-colors hover:bg-gray-100 hover:text-gray-700 dark:text-gray-400 dark:hover:bg-gray-700 dark:hover:text-gray-200"
              >
                <CollapseIcon className="h-5 w-5" />
              </button>
            ) : (
              <button
                type="button"
                onClick={() => setView('full')}
                aria-label={t('expand')}
                title={t('expand')}
                className="rounded-md p-1.5 text-gray-500 transition-colors hover:bg-gray-100 hover:text-gray-700 dark:text-gray-400 dark:hover:bg-gray-700 dark:hover:text-gray-200"
              >
                <ExpandIcon className="h-5 w-5" />
              </button>
            )}
            <button
              type="button"
              onClick={() => setView('closed')}
              aria-label={t('close')}
              title={t('close')}
              className="rounded-md p-1.5 text-gray-500 transition-colors hover:bg-gray-100 hover:text-gray-700 dark:text-gray-400 dark:hover:bg-gray-700 dark:hover:text-gray-200"
            >
              <CloseIcon className="h-5 w-5" />
            </button>
          </div>
        </div>

        {/* Body: the shared chat. ChatInterface is h-full min-h-0 so it fills
            whatever container we give it. Centred and width-capped when full. */}
        <div
          className={`flex min-h-0 w-full flex-1 flex-col pb-3 ${
            isFull ? 'mx-auto max-w-3xl px-4' : 'px-3'
          }`}
        >
          <ChatInterface />
        </div>
      </div>
    </>
  );
}

function ChatIcon({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      fill="none"
      viewBox="0 0 24 24"
      strokeWidth={1.8}
      stroke="currentColor"
      aria-hidden="true"
    >
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M8.625 9.75a.375.375 0 11-.75 0 .375.375 0 01.75 0zm0 0H8.25m4.125 0a.375.375 0 11-.75 0 .375.375 0 01.75 0zm0 0H12m4.125 0a.375.375 0 11-.75 0 .375.375 0 01.75 0zm0 0h-.375m-13.5 3.01c0 1.6 1.123 2.994 2.707 3.227 1.087.16 2.185.283 3.293.369V21l4.184-4.183a1.14 1.14 0 01.778-.332 48.294 48.294 0 005.83-.498c1.585-.233 2.708-1.626 2.708-3.228V6.741c0-1.602-1.123-2.995-2.707-3.228A48.394 48.394 0 0012 3c-2.392 0-4.744.175-7.043.513C3.373 3.746 2.25 5.14 2.25 6.741v6.018z"
      />
    </svg>
  );
}

function ExpandIcon({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      fill="none"
      viewBox="0 0 24 24"
      strokeWidth={1.8}
      stroke="currentColor"
      aria-hidden="true"
    >
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M3.75 3.75v4.5m0-4.5h4.5m-4.5 0L9 9M3.75 20.25v-4.5m0 4.5h4.5m-4.5 0L9 15M20.25 3.75h-4.5m4.5 0v4.5m0-4.5L15 9m5.25 11.25h-4.5m4.5 0v-4.5m0 4.5L15 15"
      />
    </svg>
  );
}

function CollapseIcon({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      fill="none"
      viewBox="0 0 24 24"
      strokeWidth={1.8}
      stroke="currentColor"
      aria-hidden="true"
    >
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M9 9V4.5M9 9H4.5M9 9 3.75 3.75M9 15v4.5M9 15H4.5M9 15l-5.25 5.25M15 9h4.5M15 9V4.5M15 9l5.25-5.25M15 15h4.5M15 15v4.5m0-4.5 5.25 5.25"
      />
    </svg>
  );
}

function CloseIcon({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      fill="none"
      viewBox="0 0 24 24"
      strokeWidth={1.8}
      stroke="currentColor"
      aria-hidden="true"
    >
      <path strokeLinecap="round" strokeLinejoin="round" d="M6 18 18 6M6 6l12 12" />
    </svg>
  );
}
