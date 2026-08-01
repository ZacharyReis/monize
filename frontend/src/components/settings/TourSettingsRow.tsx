'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { ChevronRightIcon } from '@heroicons/react/20/solid';
import toast from 'react-hot-toast';
import { useTourStore } from '@/store/tourStore';
import { toursApi } from '@/lib/tours-api';
import { ALL_TOURS, INTRO_TOUR } from '@/lib/tours/registry';
import { createLogger } from '@/lib/logger';
import type { TourDefinition } from '@/lib/tours/types';

const logger = createLogger('Tours');

/**
 * Settings section for guided tours: every tour the app knows about, whether it
 * has been viewed, and a button to (re)start each one. Also resets all recorded
 * progress so completed/dismissed tours are offered afresh.
 *
 * Listing all tours here matters because the release tours are otherwise only
 * offered from the What's New modal, which is easy to dismiss and hard to find
 * again. Extracted from PreferencesSection to keep that file under the size
 * ceiling.
 *
 * Collapsed by default, with the tour count on the disclosure: every release
 * adds to the list, so left open it would grow into the longest block on the
 * Preferences page.
 */
export function TourSettingsRow() {
  const t = useTranslations('tours');
  const startTour = useTourStore((s) => s.startTour);
  const clearProgress = useTourStore((s) => s.clearProgress);
  const progress = useTourStore((s) => s.progress);
  const [resetting, setResetting] = useState(false);
  const [expanded, setExpanded] = useState(false);

  const handleReset = async () => {
    setResetting(true);
    try {
      await toursApi.resetProgress();
      clearProgress();
      toast.success(t('settings.resetSuccess'));
    } catch (error) {
      logger.debug('Failed to reset tour progress', error);
      toast.error(t('settings.resetError'));
    } finally {
      setResetting(false);
    }
  };

  // The evergreen introduction first, then the release tours in registry order.
  const tours: readonly TourDefinition[] = [
    INTRO_TOUR,
    ...ALL_TOURS.filter((tour) => tour.id !== INTRO_TOUR.id),
  ];

  return (
    <div className="flex flex-col gap-1">
      <span className="text-sm font-medium text-gray-900 dark:text-gray-100">
        {t('settings.title')}
      </span>
      <span className="text-xs text-gray-500 dark:text-gray-400">
        {t('settings.description')}
      </span>

      <button
        type="button"
        onClick={() => setExpanded((open) => !open)}
        aria-expanded={expanded}
        className="mt-2 flex w-fit items-center gap-1 rounded text-sm font-medium text-blue-600 hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 dark:text-blue-400"
      >
        <ChevronRightIcon
          className={`h-4 w-4 flex-shrink-0 transition-transform ${expanded ? 'rotate-90' : ''}`}
        />
        {expanded
          ? t('settings.hideList')
          : t('settings.showList', { count: tours.length })}
      </button>

      {expanded && (
        <>
          <ul className="mt-2 divide-y divide-gray-200 rounded-md border border-gray-200 dark:divide-gray-700 dark:border-gray-700">
            {tours.map((tour) => {
              const status = progress[tour.id]?.status;
              const viewed = status === 'completed';
              const title =
                tour.id === INTRO_TOUR.id
                  ? t('offer.introTitle')
                  : t(`${tour.i18nPrefix}.title`);
              return (
                <li
                  key={tour.id}
                  className="flex items-center justify-between gap-3 px-3 py-2"
                >
                  <div className="min-w-0">
                    <p className="truncate text-sm text-gray-800 dark:text-gray-200">
                      {title}
                    </p>
                    <p className="truncate text-xs text-gray-500 dark:text-gray-400">
                      {t(`areas.${tour.area}`)}
                      {' · '}
                      {viewed
                        ? t('offer.viewed')
                        : status === 'dismissed'
                          ? t('settings.statusDismissed')
                          : t('settings.statusNotViewed')}
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => startTour(tour)}
                    className="flex-shrink-0 text-sm font-medium text-blue-600 hover:underline dark:text-blue-400"
                  >
                    {status ? t('settings.restart') : t('settings.start')}
                  </button>
                </li>
              );
            })}
          </ul>

          <div className="mt-2">
            <button
              type="button"
              onClick={handleReset}
              disabled={resetting}
              className="text-sm font-medium text-gray-600 hover:underline disabled:opacity-50 dark:text-gray-300"
            >
              {t('settings.reset')}
            </button>
          </div>
        </>
      )}
    </div>
  );
}
