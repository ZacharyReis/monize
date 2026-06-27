import { I18nService } from "nestjs-i18n";

/**
 * Translator passed into the email template builders. Emails are rendered
 * outside any HTTP request (cron jobs, auth flows that fire-and-forget), so the
 * locale cannot come from the request context the way `tr()` resolves it --
 * it must be the recipient's stored preference. Each call supplies the English
 * source as `fallback`; that value is returned when the catalogue has no entry
 * (every `en` send today) so email copy is always correct before a translator
 * has populated a locale. Interpolated values use `{{ name }}` placeholders.
 */
export type EmailT = (
  key: string,
  fallback: string,
  args?: Record<string, unknown>,
) => string;

/**
 * Default translator used when a template is called without one (e.g. unit
 * tests that render a template directly). It simply returns the English source.
 */
export const englishEmailT: EmailT = (_key, fallback) => fallback;

/**
 * Build an {@link EmailT} bound to a recipient locale, backed by nestjs-i18n.
 * Pass the recipient's `language` preference (falling back to the default
 * locale when unset). Missing catalogue keys resolve to the English `fallback`.
 */
export function emailTranslator(i18n: I18nService, lang: string): EmailT {
  return (key, fallback, args) => {
    const translated = i18n.translate(key, {
      lang,
      args,
      defaultValue: fallback,
    }) as string;
    return typeof translated === "string" && translated !== key
      ? translated
      : fallback;
  };
}
