'use client';

import { useEffect, useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { Button } from '@/components/ui/Button';
import { Modal } from '@/components/ui/Modal';
import { Select } from '@/components/ui/Select';
import { categoriesApi, type ImportDefaultsOptions } from '@/lib/categories';
import { SUPPORTED_LOCALES } from '@/i18n/config';
import { createLogger } from '@/lib/logger';

const logger = createLogger('ImportDefaultCategories');

/** Sentinel for "no country" -- the country-neutral catalog. */
export const GENERIC_COUNTRY = '';

/**
 * Country name in the user's own language, e.g. `CA` -> "Canada"/"Kanada".
 * Falls back to the raw code where Intl.DisplayNames is unavailable.
 */
function countryLabel(code: string, locale: string): string {
  try {
    return new Intl.DisplayNames([locale], { type: 'region' }).of(code) ?? code;
  } catch {
    return code;
  }
}

/**
 * Best guess at the user's country: the region of their app language when it
 * carries one (en-CA -> CA), otherwise the region of the browser's locale.
 * Only codes the backend actually offers are used.
 */
export function guessCountry(locale: string, available: string[]): string {
  const candidates = [locale];
  if (typeof navigator !== 'undefined') {
    candidates.push(...(navigator.languages ?? []), navigator.language);
  }
  for (const candidate of candidates) {
    if (!candidate) continue;
    const region = candidate.split('-')[1]?.toUpperCase();
    if (region && available.includes(region)) return region;
  }
  return GENERIC_COUNTRY;
}

interface ImportDefaultCategoriesDialogProps {
  isOpen: boolean;
  isImporting?: boolean;
  onClose: () => void;
  onConfirm: (options: ImportDefaultsOptions) => void;
}

export function ImportDefaultCategoriesDialog({
  isOpen,
  isImporting = false,
  onClose,
  onConfirm,
}: ImportDefaultCategoriesDialogProps) {
  const t = useTranslations('categories.importDialog');
  const tc = useTranslations('common');
  const locale = useLocale();
  const [countries, setCountries] = useState<string[]>([]);
  const [country, setCountry] = useState<string>(GENERIC_COUNTRY);
  const [language, setLanguage] = useState<string>(locale);

  // Reset the language to the user's current one each time the dialog opens.
  // Uses the "info from previous render" pattern rather than an effect (see
  // react-hooks/set-state-in-effect).
  const [wasOpen, setWasOpen] = useState(isOpen);
  if (isOpen !== wasOpen) {
    setWasOpen(isOpen);
    if (isOpen) setLanguage(locale);
  }

  // Load the country list when the dialog opens. The state updates live in the
  // promise callbacks so the effect body itself stays free of setState.
  useEffect(() => {
    if (!isOpen) return;
    let cancelled = false;
    categoriesApi
      .getDefaultCountries()
      .then((available) => {
        if (cancelled) return;
        setCountries(available);
        setCountry(guessCountry(locale, available));
      })
      .catch((error) => {
        // The country list is an enhancement: without it the generic catalog
        // is still importable, so this failure stays silent to the user.
        if (cancelled) return;
        logger.error(error);
        setCountries([]);
      });
    return () => {
      cancelled = true;
    };
  }, [isOpen, locale]);

  const countryOptions = [
    { value: GENERIC_COUNTRY, label: t('genericCountry') },
    ...countries
      .map((code) => ({ value: code, label: countryLabel(code, locale) }))
      .sort((a, b) => a.label.localeCompare(b.label, locale)),
  ];

  const languageOptions = SUPPORTED_LOCALES.map((l) => ({
    value: l.code,
    label: l.label,
  }));

  return (
    <Modal isOpen={isOpen} onClose={onClose} maxWidth="md" className="p-6" pushHistory>
      <h2 className="text-xl font-bold text-gray-900 dark:text-gray-100">
        {t('title')}
      </h2>
      <p className="mt-2 text-sm text-gray-500 dark:text-gray-400">
        {t('description')}
      </p>

      <div className="mt-6 space-y-4">
        <div>
          <Select
            label={t('countryLabel')}
            options={countryOptions}
            value={country}
            onChange={(e) => setCountry(e.target.value)}
            disabled={isImporting}
          />
          <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
            {t('countryHelp')}
          </p>
        </div>

        <div>
          <Select
            label={t('languageLabel')}
            options={languageOptions}
            value={language}
            onChange={(e) => setLanguage(e.target.value)}
            disabled={isImporting}
          />
          <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
            {t('languageHelp')}
          </p>
        </div>
      </div>

      <div className="mt-6 flex justify-end gap-3">
        <Button variant="outline" onClick={onClose} disabled={isImporting}>
          {tc('cancel')}
        </Button>
        <Button
          onClick={() =>
            onConfirm({
              ...(country ? { country } : {}),
              language,
            })
          }
          isLoading={isImporting}
          disabled={isImporting}
        >
          {t('submit')}
        </Button>
      </div>
    </Modal>
  );
}
