'use client';

import Image from 'next/image';
import { useLocale, useTranslations } from 'next-intl';
import { OnboardingPreferences } from './OnboardingPreferences';

interface OnboardingPreferencesScreenProps {
  /** See `OnboardingPreferences.onComplete`. */
  onComplete: (result?: { localeChanged: boolean }) => void;
}

/**
 * Full-page framing for the first-run language/currency step, shared by the
 * two paths that reach it: the end of local registration, and the first login
 * of an account an identity provider just provisioned. Both show the same
 * copy, so the strings stay under `auth.register.preferences`.
 */
export function OnboardingPreferencesScreen({
  onComplete,
}: OnboardingPreferencesScreenProps) {
  const t = useTranslations('auth.register.preferences');
  const locale = useLocale();

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50 dark:bg-gray-900 py-12 px-4 sm:px-6 lg:px-8">
      <div className="max-w-md w-full space-y-8">
        <div className="text-center">
          <Image
            src="/icons/monize-logo.svg"
            alt="Monize"
            width={96}
            height={96}
            className="mx-auto rounded-xl"
            priority
          />
          <h2 className="mt-4 text-3xl font-extrabold text-gray-900 dark:text-gray-100">
            {t('title')}
          </h2>
          <p className="mt-2 text-sm text-gray-600 dark:text-gray-400">
            {t('subtitle')}
          </p>
        </div>
        <OnboardingPreferences initialLanguage={locale} onComplete={onComplete} />
      </div>
    </div>
  );
}
