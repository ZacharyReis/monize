'use client';

import { useCallback } from 'react';
import { useTranslations } from 'next-intl';
import { getMainAccountName } from '@/lib/account-utils';

/**
 * Returns a stable function that strips the " - Brokerage"/" - Cash" suffix
 * from a linked investment account name. Investment pair names are generated
 * server-side with a localized suffix, so the stripper uses the current
 * locale's translated words; the English originals are always stripped too so
 * accounts created in English (or before localization) still resolve.
 */
export function useMainAccountName(): (name: string) => string {
  const t = useTranslations('accounts');
  return useCallback(
    (name: string) =>
      getMainAccountName(name, [
        t('nameSuffix.brokerage'),
        t('nameSuffix.cash'),
      ]),
    [t],
  );
}
