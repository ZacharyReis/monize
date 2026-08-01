import { describe, it, expect, afterEach, vi } from 'vitest';
import {
  currencyForLocales,
  detectBrowserCurrency,
  FALLBACK_CURRENCY,
} from './locale-currency';

/** Swap navigator.languages for one assertion; restored in afterEach. */
function setBrowserLanguages(languages: string[] | undefined) {
  Object.defineProperty(window.navigator, 'languages', {
    value: languages,
    configurable: true,
  });
  Object.defineProperty(window.navigator, 'language', {
    value: languages?.[0],
    configurable: true,
  });
}

describe('currencyForLocales', () => {
  it('maps an explicit region to its currency', () => {
    expect(currencyForLocales(['en-CA'])).toBe('CAD');
    expect(currencyForLocales(['fr-FR'])).toBe('EUR');
    expect(currencyForLocales(['pt-BR'])).toBe('BRL');
    expect(currencyForLocales(['en-GB'])).toBe('GBP');
    expect(currencyForLocales(['ja-JP'])).toBe('JPY');
  });

  it('falls back to the likely region of a language-only tag', () => {
    expect(currencyForLocales(['de'])).toBe('EUR');
    expect(currencyForLocales(['pl'])).toBe('PLN');
    expect(currencyForLocales(['ko'])).toBe('KRW');
    expect(currencyForLocales(['en'])).toBe('USD');
  });

  it('prefers an explicit region over a language-only tag listed first', () => {
    // A browser configured as "English, then English (Canada)" means Canada;
    // expanding the bare `en` first would wrongly land on USD.
    expect(currencyForLocales(['en', 'en-CA'])).toBe('CAD');
  });

  it('uses the first tag that maps, in order', () => {
    expect(currencyForLocales(['en-CA', 'en-US'])).toBe('CAD');
    expect(currencyForLocales(['en-US', 'en-CA'])).toBe('USD');
  });

  it('skips regions with no catalog currency', () => {
    // Ghana (GHS) is outside the curated catalog, so the next tag decides.
    expect(currencyForLocales(['en-GH', 'en-GB'])).toBe('GBP');
  });

  it('returns undefined when nothing maps', () => {
    expect(currencyForLocales([])).toBeUndefined();
    expect(currencyForLocales(['en-GH'])).toBeUndefined();
  });

  it('ignores malformed tags instead of throwing', () => {
    expect(currencyForLocales(['not a locale', '', 'en-CA'])).toBe('CAD');
    expect(currencyForLocales(['???'])).toBeUndefined();
  });

  it('accepts the underscore form some environments emit', () => {
    expect(currencyForLocales(['en_CA'])).toBe('CAD');
  });

  it('is case-insensitive about the region subtag', () => {
    expect(currencyForLocales(['en-ca'])).toBe('CAD');
  });
});

describe('detectBrowserCurrency', () => {
  const originalLanguages = window.navigator.languages;
  const originalLanguage = window.navigator.language;

  afterEach(() => {
    Object.defineProperty(window.navigator, 'languages', {
      value: originalLanguages,
      configurable: true,
    });
    Object.defineProperty(window.navigator, 'language', {
      value: originalLanguage,
      configurable: true,
    });
    vi.restoreAllMocks();
  });

  it('reads the browser language list', () => {
    setBrowserLanguages(['fr-CA', 'fr']);
    expect(detectBrowserCurrency()).toBe('CAD');
  });

  it('falls back to navigator.language when the list is empty', () => {
    setBrowserLanguages([]);
    Object.defineProperty(window.navigator, 'language', {
      value: 'de-DE',
      configurable: true,
    });
    expect(detectBrowserCurrency()).toBe('EUR');
  });

  it('falls back to the resolved Intl locale when the languages say nothing', () => {
    setBrowserLanguages(['en-GH']);
    vi.spyOn(Intl.DateTimeFormat.prototype, 'resolvedOptions').mockReturnValue({
      locale: 'en-AU',
    } as Intl.ResolvedDateTimeFormatOptions);
    expect(detectBrowserCurrency()).toBe('AUD');
  });

  it('returns undefined when no region can be resolved', () => {
    setBrowserLanguages(['en-GH']);
    vi.spyOn(Intl.DateTimeFormat.prototype, 'resolvedOptions').mockReturnValue({
      locale: 'en-GH',
    } as Intl.ResolvedDateTimeFormatOptions);
    expect(detectBrowserCurrency()).toBeUndefined();
  });
});

describe('FALLBACK_CURRENCY', () => {
  it('matches the backend default so skipping onboarding is consistent', () => {
    expect(FALLBACK_CURRENCY).toBe('USD');
  });
});
