import { I18nContext } from "nestjs-i18n";

/**
 * Translate a backend message key against the current request's locale.
 *
 * Backend strings reach the client as exception messages. Every call supplies
 * the English source string as `fallback`; it is returned verbatim whenever no
 * request context is active -- background jobs, schedulers, and unit tests all
 * run outside an HTTP request -- or when the key is missing from the loaded
 * catalogue. The English source is mirrored under `locales/en/*.json`, so the
 * catalogue and the inline fallback stay in lock-step and server responses are
 * always correct even before a translator has populated a locale.
 *
 * Interpolated values use `{{ name }}` placeholders in the catalogue; pass the
 * matching values as `args` (e.g. `tr("errors.account.notFoundId", `Account
 * ${id} not found`, { id })`).
 */
export function tr(
  key: string,
  fallback: string,
  args?: Record<string, unknown>,
): string {
  const ctx = I18nContext.current();
  if (!ctx) return fallback;
  const translated = ctx.t(key, { args, defaultValue: fallback }) as string;
  // nestjs-i18n returns the key itself when it cannot resolve and no
  // defaultValue path matched; guard against leaking a raw key to the client.
  return typeof translated === "string" && translated !== key
    ? translated
    : fallback;
}
