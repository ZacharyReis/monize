'use client';

import { useEffect, useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import { useMainAccountName } from '@/hooks/useMainAccountName';
import { MultiSelect } from '@/components/ui/MultiSelect';
import { Account } from '@/types/account';

// Rapid checkbox toggles (the typical multi-account selection flow) should
// collapse into a single reload once the user pauses, matching the debounce in
// DividendIncomeReport. Without it, every checkbox click immediately re-renders
// the host report into its loading skeleton, unmounting this dropdown and
// forcing the user to re-open it for each account.
const ACCOUNT_DEBOUNCE_MS = 350;

interface ReportAccountMultiSelectProps {
  accounts: Account[];
  value: string[];
  onChange: (values: string[]) => void;
  /**
   * Which accounts to offer. Defaults to the set used by the transaction-based
   * reports (every investment account except the brokerage sub-account, whose
   * sibling cash account represents the holding). Portfolio-summary reports
   * pass a predicate that excludes the cash sub-account instead.
   */
  filter?: (account: Account) => boolean;
  className?: string;
}

const defaultFilter = (account: Account) =>
  account.accountSubType !== 'INVESTMENT_BROKERAGE';

const sameIds = (a: string[], b: string[]) =>
  a.length === b.length && a.every((id, i) => id === b[i]);

export function ReportAccountMultiSelect({
  accounts,
  value,
  onChange,
  filter = defaultFilter,
  className = 'w-48',
}: ReportAccountMultiSelectProps) {
  const t = useTranslations('reports');
  const mainAccountName = useMainAccountName();
  const options = accounts
    .filter(filter)
    .slice()
    .sort((a, b) => a.name.localeCompare(b.name))
    .map((account) => ({
      value: account.id,
      label: mainAccountName(account.name),
    }));

  // Local draft so checkbox toggles render instantly and the dropdown stays
  // open while selecting. The host report (which reloads its data from this
  // selection) is only notified after the user pauses.
  const [draft, setDraft] = useState(value);
  const [syncedValue, setSyncedValue] = useState(value);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Adopt external value changes (e.g. a reset) without a setState-in-effect.
  if (value !== syncedValue && !sameIds(value, syncedValue)) {
    setSyncedValue(value);
    setDraft(value);
  }

  // Cancel any pending debounced notification whenever the parent pushes a new
  // value. This covers the external-reset case: without it, a toggle made just
  // before the reset would still fire its (now stale) onChange after the reset
  // and clobber it. When our own debounce commits, the timer has already
  // cleared itself, so this is a no-op in the common path.
  useEffect(() => {
    if (debounceRef.current) {
      clearTimeout(debounceRef.current);
      debounceRef.current = null;
    }
  }, [value]);

  useEffect(
    () => () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    },
    [],
  );

  const handleChange = (next: string[]) => {
    setDraft(next);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      debounceRef.current = null;
      onChange(next);
    }, ACCOUNT_DEBOUNCE_MS);
  };

  return (
    <div className={className}>
      <MultiSelect
        ariaLabel={t('reportAccountMultiSelect.ariaLabel')}
        placeholder={t('reportAccountMultiSelect.placeholder')}
        options={options}
        value={draft}
        onChange={handleChange}
      />
    </div>
  );
}
