'use client';

import { useLocale, useTranslations } from 'next-intl';
import { useRouter } from 'next/navigation';
import Cookies from 'js-cookie';
import { Select } from '@/components/ui/Select';
import { LOCALE_COOKIE, SUPPORTED_LOCALES } from '@/i18n/config';
import { rememberPreLoginLocale } from '@/lib/pre-login-locale';

/**
 * Explicit language picker for unauthenticated screens (login/register): a
 * labelled dropdown shown inline in the form. Visitors on a shared machine
 * would otherwise be stuck with the locale cookie left behind by the previous
 * user. The choice is persisted in the cookie only -- it is never written to
 * the account, so a shared demo account is not changed for the next visitor.
 * Once a real user registers, OnboardingPreferences saves it to their
 * preferences.
 */
export function AuthLanguagePicker({ className }: { className?: string }) {
  const t = useTranslations('auth.languageSwitcher');
  const locale = useLocale();
  const router = useRouter();

  const options = SUPPORTED_LOCALES.map((l) => ({
    value: l.code,
    label: l.label,
  }));

  const selectLocale = (next: string) => {
    if (next === locale) return;
    Cookies.set(LOCALE_COOKIE, next, { sameSite: 'lax', expires: 365 });
    // Marks the choice as deliberate so the post-login preference sync
    // saves it to the user's preferences instead of reverting to them.
    rememberPreLoginLocale(next);
    router.refresh();
  };

  return (
    <div className={className}>
      <Select
        label={t('label')}
        options={options}
        value={locale}
        onChange={(e) => selectLocale(e.target.value)}
      />
    </div>
  );
}
