/**
 * Remembers a language deliberately chosen on an unauthenticated screen
 * (login/register) so the post-login preference sync can persist it to the
 * user's stored preferences instead of reverting to them.
 *
 * sessionStorage scopes the signal to the current tab and visit: a locale
 * cookie merely left behind by a previous user carries no flag, so it is
 * still corrected to the signed-in user's stored preference.
 */
const PRE_LOGIN_LOCALE_KEY = 'preLoginLocale';

export function rememberPreLoginLocale(locale: string): void {
  try {
    sessionStorage.setItem(PRE_LOGIN_LOCALE_KEY, locale);
  } catch {
    // Storage unavailable (private mode etc). The choice still applies for
    // this visit via the cookie; it just will not be persisted after login.
  }
}

export function consumePreLoginLocale(): string | null {
  try {
    const value = sessionStorage.getItem(PRE_LOGIN_LOCALE_KEY);
    if (value !== null) {
      sessionStorage.removeItem(PRE_LOGIN_LOCALE_KEY);
    }
    return value;
  } catch {
    return null;
  }
}
