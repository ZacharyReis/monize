'use client';

import { useMemo } from 'react';
import { useTranslations } from 'next-intl';
import { MultiSelect, MultiSelectOption } from '@/components/ui/MultiSelect';
import { Account } from '@/types/account';
import { Category } from '@/types/category';
import { BillsPayeeOption } from '@/lib/bills-filters';
import { buildCategoryFilterOptions, resolveSelectedCategories } from '@/lib/categoryUtils';

interface BillsFilterPanelProps {
  filtersExpanded: boolean;
  setFiltersExpanded: (expanded: boolean) => void;
  nameSearch: string;
  setNameSearch: (term: string) => void;
  selectedPayeeIds: string[];
  setSelectedPayeeIds: (ids: string[]) => void;
  selectedAccountIds: string[];
  setSelectedAccountIds: (ids: string[]) => void;
  selectedCategoryIds: string[];
  setSelectedCategoryIds: (ids: string[]) => void;
  accounts: Account[];
  categories: Category[];
  payees: BillsPayeeOption[];
  activeFilterCount: number;
  onClearFilters: () => void;
}

export function BillsFilterPanel(props: BillsFilterPanelProps) {
  const t = useTranslations('scheduledTransactions');
  const {
    filtersExpanded,
    setFiltersExpanded,
    nameSearch,
    setNameSearch,
    selectedPayeeIds,
    setSelectedPayeeIds,
    selectedAccountIds,
    setSelectedAccountIds,
    selectedCategoryIds,
    setSelectedCategoryIds,
    accounts,
    categories,
    payees,
    activeFilterCount,
    onClearFilters,
  } = props;

  const accountOptions: MultiSelectOption[] = useMemo(
    () => accounts.map((a) => ({ value: a.id, label: a.name })),
    [accounts],
  );

  const payeeOptions: MultiSelectOption[] = useMemo(
    () => payees.map((p) => ({ value: p.id, label: p.name })),
    [payees],
  );

  const categoryOptions: MultiSelectOption[] = useMemo(
    () => buildCategoryFilterOptions(categories),
    [categories],
  );

  const selectedCategories = useMemo(
    () => resolveSelectedCategories(selectedCategoryIds, categories),
    [selectedCategoryIds, categories],
  );

  return (
    <div className="bg-white dark:bg-gray-800 shadow dark:shadow-gray-700/50 rounded-lg">
      {/* Filter header. The toggle and the Clear action are sibling buttons
          (not nested) so both are keyboard-operable. */}
      <div className="w-full flex items-center justify-between p-4">
        <button
          type="button"
          onClick={() => setFiltersExpanded(!filtersExpanded)}
          aria-expanded={filtersExpanded}
          className="flex flex-1 min-w-0 items-center gap-2 text-left"
        >
          <svg className="w-5 h-5 text-gray-500 dark:text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 4a1 1 0 011-1h16a1 1 0 011 1v2a1 1 0 01-.293.707L14 13.414V19a1 1 0 01-.553.894l-4 2A1 1 0 018 21v-7.586L3.293 6.707A1 1 0 013 6V4z" />
          </svg>
          <span className="text-sm font-medium text-gray-900 dark:text-gray-100">{t('filters.label')}</span>
          {activeFilterCount > 0 && (
            <span className="px-2 py-0.5 bg-blue-100 dark:bg-blue-900 text-blue-700 dark:text-blue-300 text-xs font-medium rounded-full">
              {activeFilterCount}
            </span>
          )}
        </button>
        <div className="flex items-center gap-2 pl-2">
          {activeFilterCount > 0 && (
            <button
              type="button"
              onClick={onClearFilters}
              className="text-sm text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200"
            >
              {t('filters.clear')}
            </button>
          )}
          <button
            type="button"
            onClick={() => setFiltersExpanded(!filtersExpanded)}
            aria-label={filtersExpanded ? t('filters.collapseAriaLabel') : t('filters.expandAriaLabel')}
            className="text-gray-500 dark:text-gray-400"
          >
            <svg
              className={`w-5 h-5 transition-transform ${filtersExpanded ? 'rotate-180' : ''}`}
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
            </svg>
          </button>
        </div>
      </div>

      {/* Active filter chips (collapsed view) */}
      {!filtersExpanded && activeFilterCount > 0 && (
        <div className="px-4 pb-4 flex flex-wrap gap-2">
          {nameSearch.trim() && (
            <span className="inline-flex items-center gap-1 px-2 py-1 bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-300 text-xs rounded-full">
              &quot;{nameSearch}&quot;
              <button onClick={() => setNameSearch('')} className="hover:text-gray-900 dark:hover:text-gray-100">
                <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
              </button>
            </span>
          )}
          {/* Always render a chip for every selected id so a selection that has
              dropped out of the derived list (e.g. its only schedule was
              deleted) stays removable rather than leaving an active filter the
              user cannot clear. */}
          {selectedPayeeIds.map((id) => {
            const payee = payees.find((p) => p.id === id);
            return (
              <span key={id} className="inline-flex items-center gap-1 px-2 py-1 bg-purple-100 dark:bg-purple-900/40 text-purple-700 dark:text-purple-300 text-xs rounded-full">
                {payee?.name ?? 'Unknown payee'}
                <button onClick={() => setSelectedPayeeIds(selectedPayeeIds.filter((p) => p !== id))} className="hover:text-purple-900 dark:hover:text-purple-100">
                  <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
                </button>
              </span>
            );
          })}
          {selectedAccountIds.map((id) => {
            const account = accounts.find((a) => a.id === id);
            return (
              <span key={id} className="inline-flex items-center gap-1 px-2 py-1 bg-emerald-100 dark:bg-emerald-900/40 text-emerald-700 dark:text-emerald-300 text-xs rounded-full">
                {account?.name ?? 'Unknown account'}
                <button onClick={() => setSelectedAccountIds(selectedAccountIds.filter((a) => a !== id))} className="hover:text-emerald-900 dark:hover:text-emerald-100">
                  <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
                </button>
              </span>
            );
          })}
          {selectedCategories.map((category) => (
            <span key={category.id} className="inline-flex items-center gap-1 px-2 py-1 bg-blue-100 dark:bg-blue-900/40 text-blue-700 dark:text-blue-300 text-xs rounded-full">
              {(category.effectiveColor ?? category.color) && (
                <span
                  className="w-2 h-2 rounded-full flex-shrink-0"
                  style={{ backgroundColor: (category.effectiveColor ?? category.color)! }}
                />
              )}
              {category.name}
              <button onClick={() => setSelectedCategoryIds(selectedCategoryIds.filter((c) => c !== category.id))} className="hover:text-blue-900 dark:hover:text-blue-100">
                <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
              </button>
            </span>
          ))}
        </div>
      )}

      {/* Expanded filter controls */}
      {filtersExpanded && (
        <div className="px-4 pb-4 space-y-4 border-t border-gray-200 dark:border-gray-700 pt-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">{t('filters.nameLabel')}</label>
              <input
                type="text"
                value={nameSearch}
                onChange={(e) => setNameSearch(e.target.value)}
                placeholder={t('filters.namePlaceholder')}
                className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100"
              />
            </div>
            <MultiSelect
              label={t('filters.payeesLabel')}
              options={payeeOptions}
              value={selectedPayeeIds}
              onChange={setSelectedPayeeIds}
              placeholder={t('filters.payeesPlaceholder')}
            />
            <MultiSelect
              label={t('filters.accountsLabel')}
              options={accountOptions}
              value={selectedAccountIds}
              onChange={setSelectedAccountIds}
              placeholder={t('filters.accountsPlaceholder')}
            />
            <MultiSelect
              label={t('filters.categoriesLabel')}
              options={categoryOptions}
              value={selectedCategoryIds}
              onChange={setSelectedCategoryIds}
              placeholder={t('filters.categoriesPlaceholder')}
            />
          </div>
        </div>
      )}
    </div>
  );
}
