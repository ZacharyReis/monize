/**
 * Best-effort detection of the currency a new user most likely wants, derived
 * from the locales their browser reports. Used to pre-fill the onboarding
 * currency picker so a first-time user is not handed USD regardless of where
 * they are; the picker stays editable, so a wrong guess costs one click.
 *
 * The mapped codes are deliberately restricted to the curated currency catalog
 * the backend serves (`backend/src/currencies/currency-metadata.ts`), so every
 * detection result is offered by the picker.
 */

/** Used when nothing can be detected, matching the backend's default. */
export const FALLBACK_CURRENCY = "USD";

/**
 * ISO 3166-1 alpha-2 region -> ISO 4217 currency. Only regions whose currency
 * is in the curated catalog are listed; anything else falls through to the
 * caller's fallback rather than being guessed at.
 */
const REGION_CURRENCY: Readonly<Record<string, string>> = {
  // US dollar (issuing country plus the territories and dollarized economies
  // that use it as their everyday currency)
  US: "USD",
  AS: "USD",
  BQ: "USD",
  EC: "USD",
  FM: "USD",
  GU: "USD",
  IO: "USD",
  MH: "USD",
  MP: "USD",
  PA: "USD",
  PR: "USD",
  PW: "USD",
  SV: "USD",
  TC: "USD",
  TL: "USD",
  UM: "USD",
  VG: "USD",
  VI: "USD",

  // Euro (eurozone members plus the microstates and overseas regions using it)
  AD: "EUR",
  AT: "EUR",
  AX: "EUR",
  BE: "EUR",
  BL: "EUR",
  CY: "EUR",
  DE: "EUR",
  EE: "EUR",
  ES: "EUR",
  FI: "EUR",
  FR: "EUR",
  GF: "EUR",
  GP: "EUR",
  GR: "EUR",
  HR: "EUR",
  IE: "EUR",
  IT: "EUR",
  LT: "EUR",
  LU: "EUR",
  LV: "EUR",
  MC: "EUR",
  ME: "EUR",
  MF: "EUR",
  MQ: "EUR",
  MT: "EUR",
  NL: "EUR",
  PM: "EUR",
  PT: "EUR",
  RE: "EUR",
  SI: "EUR",
  SK: "EUR",
  SM: "EUR",
  VA: "EUR",
  XK: "EUR",
  YT: "EUR",

  // Pound sterling
  GB: "GBP",
  GG: "GBP",
  GS: "GBP",
  IM: "GBP",
  JE: "GBP",

  // Dollar blocs
  AU: "AUD",
  CC: "AUD",
  CX: "AUD",
  HM: "AUD",
  KI: "AUD",
  NF: "AUD",
  NR: "AUD",
  TV: "AUD",
  NZ: "NZD",
  CK: "NZD",
  NU: "NZD",
  PN: "NZD",
  TK: "NZD",
  CA: "CAD",
  HK: "HKD",
  SG: "SGD",
  TW: "TWD",

  // Nordics
  DK: "DKK",
  FO: "DKK",
  GL: "DKK",
  NO: "NOK",
  BV: "NOK",
  SJ: "NOK",
  SE: "SEK",

  // Rest of Europe
  CH: "CHF",
  LI: "CHF",
  CZ: "CZK",
  HU: "HUF",
  PL: "PLN",
  RU: "RUB",
  TR: "TRY",

  // Asia-Pacific
  BD: "BDT",
  CN: "CNY",
  ID: "IDR",
  IN: "INR",
  JP: "JPY",
  KR: "KRW",
  MY: "MYR",
  PH: "PHP",
  PK: "PKR",
  TH: "THB",
  VN: "VND",

  // Middle East and Africa
  AE: "AED",
  BH: "BHD",
  EG: "EGP",
  IL: "ILS",
  PS: "ILS",
  KW: "KWD",
  NG: "NGN",
  OM: "OMR",
  SA: "SAR",
  ZA: "ZAR",

  // Latin America
  AR: "ARS",
  BR: "BRL",
  CL: "CLP",
  CO: "COP",
  MX: "MXN",
  PE: "PEN",
};

/** Explicit region subtag of a BCP 47 tag (`en-CA` -> `CA`), if it has one. */
function explicitRegion(tag: string): string | undefined {
  try {
    const region = new Intl.Locale(tag).region;
    if (region) return region.toUpperCase();
  } catch {
    // Malformed tag: fall through to the textual match below.
  }
  // Intl.Locale is available everywhere we run, but a tag it rejects may still
  // carry a usable region (e.g. the underscore form some environments emit).
  const match = /^[A-Za-z]{2,3}[-_](?:[A-Za-z]{4}[-_])?([A-Za-z]{2})(?:$|[-_])/.exec(
    tag,
  );
  return match ? match[1].toUpperCase() : undefined;
}

/** Region CLDR considers most likely for a tag (`de` -> `DE`, `en` -> `US`). */
function likelyRegion(tag: string): string | undefined {
  try {
    return new Intl.Locale(tag).maximize().region?.toUpperCase();
  } catch {
    return undefined;
  }
}

/**
 * The currency implied by an ordered list of BCP 47 tags, or `undefined` when
 * none of them maps to a catalog currency.
 *
 * Tags carrying an explicit region win over tags that only imply one: a browser
 * listing `["en", "en-CA"]` means Canada, not the `en` -> US likely-subtag
 * expansion.
 */
export function currencyForLocales(
  tags: readonly string[],
): string | undefined {
  for (const tag of tags) {
    const region = explicitRegion(tag);
    if (region && REGION_CURRENCY[region]) return REGION_CURRENCY[region];
  }
  for (const tag of tags) {
    const region = likelyRegion(tag);
    if (region && REGION_CURRENCY[region]) return REGION_CURRENCY[region];
  }
  return undefined;
}

/**
 * The currency implied by the current browser's language settings. Returns
 * `undefined` off the client (no `navigator`) or when nothing maps.
 */
export function detectBrowserCurrency(): string | undefined {
  if (typeof navigator === "undefined") return undefined;
  const tags: string[] =
    navigator.languages && navigator.languages.length > 0
      ? [...navigator.languages]
      : navigator.language
        ? [navigator.language]
        : [];
  // The resolved Intl locale is a last resort: in some browsers it reflects the
  // OS regional format setting, which can name a region the language list does
  // not (a US-English UI configured for Canadian formats).
  try {
    const resolved = new Intl.DateTimeFormat().resolvedOptions().locale;
    if (resolved) tags.push(resolved);
  } catch {
    // No usable Intl resolution: the language list alone has to do.
  }
  return currencyForLocales(tags);
}
