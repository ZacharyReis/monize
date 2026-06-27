import { tr } from "../i18n/translate";

/**
 * Localized suffix words appended to the two halves of a linked investment
 * account pair (e.g. "TFSA - Cash" / "TFSA - Brokerage"). Resolved against the
 * current request locale so generated names read naturally in the user's
 * language; outside an HTTP context they fall back to English.
 */
export function cashSuffix(): string {
  return tr("common.accountSuffix.cash", "Cash");
}

export function brokerageSuffix(): string {
  return tr("common.accountSuffix.brokerage", "Brokerage");
}

/**
 * Strip a trailing " - <Brokerage>" suffix from a brokerage account name to
 * recover the main account name. Removes both the current locale's translated
 * word and the English original, so accounts created in any language (or before
 * localization) resolve correctly.
 */
export function stripBrokerageSuffix(name: string): string {
  const suffixes = [...new Set(["Brokerage", brokerageSuffix()])].map((s) =>
    s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"),
  );
  return name.replace(new RegExp(` - (${suffixes.join("|")})$`), "");
}
