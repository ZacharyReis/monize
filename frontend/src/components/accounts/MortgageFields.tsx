'use client';

import { useState, useEffect, useCallback, useMemo } from 'react';
import { useTranslations } from 'next-intl';
import { UseFormRegister, UseFormSetValue, FieldErrors } from 'react-hook-form';
import { Input } from '@/components/ui/Input';
import { DateInput } from '@/components/ui/DateInput';
import { Select } from '@/components/ui/Select';
import { Combobox } from '@/components/ui/Combobox';
import { Account, MortgageAmortizationPreview, MortgagePaymentFrequency } from '@/types/account';
import { Category } from '@/types/category';
import { buildCategoryTree } from '@/lib/categoryUtils';
import { accountsApi } from '@/lib/accounts';
import { buildAccountDropdownOptions } from '@/lib/account-utils';
import { createLogger } from '@/lib/logger';
import { useDateFormat } from '@/hooks/useDateFormat';

const logger = createLogger('MortgageFields');

interface MortgageFieldsProps {
  watchedCurrency: string;
  openingBalance: number | undefined;
  interestRate: number | undefined;
  paymentStartDate: string | undefined;
  isCanadianMortgage: boolean | undefined;
  isVariableRate: boolean | undefined;
  termMonths: number | undefined;
  amortizationMonths: number | undefined;
  mortgagePaymentFrequency: MortgagePaymentFrequency | undefined;
  setValue: UseFormSetValue<any>;
  register: UseFormRegister<any>;
  errors: FieldErrors<any>;
  accounts: Account[];
  categories: Category[];
  formatCurrency: (amount: number, currency?: string) => string;
  isEditing: boolean;
  selectedInterestCategoryId: string;
  handleInterestCategoryChange: (categoryId: string) => void;
}

export function MortgageFields({
  watchedCurrency,
  openingBalance,
  interestRate,
  paymentStartDate,
  isCanadianMortgage,
  isVariableRate,
  termMonths,
  amortizationMonths,
  mortgagePaymentFrequency,
  setValue,
  register,
  errors,
  accounts,
  categories,
  formatCurrency,
  isEditing,
  selectedInterestCategoryId,
  handleInterestCategoryChange,
}: MortgageFieldsProps) {
  const t = useTranslations('accounts');
  const { formatDate } = useDateFormat();

  const mortgagePaymentFrequencyOptions = [
    { value: 'MONTHLY', label: t('mortgageFields.frequencyOptions.monthly') },
    { value: 'SEMI_MONTHLY', label: t('mortgageFields.frequencyOptions.semiMonthly') },
    { value: 'BIWEEKLY', label: t('mortgageFields.frequencyOptions.biweekly') },
    { value: 'ACCELERATED_BIWEEKLY', label: t('mortgageFields.frequencyOptions.acceleratedBiweekly') },
    { value: 'WEEKLY', label: t('mortgageFields.frequencyOptions.weekly') },
    { value: 'ACCELERATED_WEEKLY', label: t('mortgageFields.frequencyOptions.acceleratedWeekly') },
  ];
  const [mortgagePreview, setMortgagePreview] = useState<MortgageAmortizationPreview | null>(null);
  const [isLoadingPreview, setIsLoadingPreview] = useState(false);

  // Local string state for years+months inputs
  const [termYears, setTermYears] = useState<string>(() => {
    if (termMonths != null && termMonths > 0) return String(Math.floor(termMonths / 12));
    return '';
  });
  const [termRemainder, setTermRemainder] = useState<string>(() => {
    if (termMonths != null && termMonths > 0) return String(termMonths % 12);
    return '';
  });
  const [amortYears, setAmortYears] = useState<string>(() => {
    if (amortizationMonths != null && amortizationMonths > 0) return String(Math.floor(amortizationMonths / 12));
    return '';
  });
  const [amortRemainder, setAmortRemainder] = useState<string>(() => {
    if (amortizationMonths != null && amortizationMonths > 0) return String(amortizationMonths % 12);
    return '';
  });

  // Sync local state when termMonths/amortizationMonths change externally (e.g. form reset)
  useEffect(() => {
    if (termMonths != null && termMonths > 0) {
      setTermYears(String(Math.floor(termMonths / 12)));
      setTermRemainder(String(termMonths % 12));
    }
  }, [termMonths]);

  useEffect(() => {
    if (amortizationMonths != null && amortizationMonths > 0) {
      setAmortYears(String(Math.floor(amortizationMonths / 12)));
      setAmortRemainder(String(amortizationMonths % 12));
    }
  }, [amortizationMonths]);

  const updateTermMonths = (years: string, months: string) => {
    const y = years === '' ? 0 : parseInt(years, 10);
    const m = months === '' ? 0 : parseInt(months, 10);
    if (isNaN(y) || isNaN(m)) return;
    const total = y * 12 + m;
    setValue('termMonths', total, { shouldValidate: true, shouldDirty: true });
  };

  const updateAmortizationMonths = (years: string, months: string) => {
    const y = years === '' ? 0 : parseInt(years, 10);
    const m = months === '' ? 0 : parseInt(months, 10);
    if (isNaN(y) || isNaN(m)) return;
    const total = y * 12 + m;
    setValue('amortizationMonths', total > 0 ? total : undefined, { shouldValidate: true, shouldDirty: true });
  };

  const handleTermYearsChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const val = e.target.value;
    if (val !== '' && (parseInt(val, 10) < 0 || parseInt(val, 10) > 99)) return;
    setTermYears(val);
    updateTermMonths(val, termRemainder);
  };

  const handleTermMonthsChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const val = e.target.value;
    if (val !== '' && (parseInt(val, 10) < 0 || parseInt(val, 10) > 11)) return;
    setTermRemainder(val);
    updateTermMonths(termYears, val);
  };

  const handleAmortYearsChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const val = e.target.value;
    if (val !== '' && (parseInt(val, 10) < 0 || parseInt(val, 10) > 99)) return;
    setAmortYears(val);
    updateAmortizationMonths(val, amortRemainder);
  };

  const handleAmortMonthsChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const val = e.target.value;
    if (val !== '' && (parseInt(val, 10) < 0 || parseInt(val, 10) > 11)) return;
    setAmortRemainder(val);
    updateAmortizationMonths(amortYears, val);
  };

  const calculateMortgagePreview = useCallback(async () => {
    if (isEditing || !openingBalance || !interestRate || !amortizationMonths || !mortgagePaymentFrequency || !paymentStartDate) {
      setMortgagePreview(null);
      return;
    }

    setIsLoadingPreview(true);
    try {
      const preview = await accountsApi.previewMortgageAmortization({
        mortgageAmount: openingBalance,
        interestRate,
        amortizationMonths,
        paymentFrequency: mortgagePaymentFrequency,
        paymentStartDate,
        isCanadian: isCanadianMortgage || false,
        isVariableRate: isVariableRate || false,
      });
      setMortgagePreview(preview);
    } catch (error) {
      logger.error('Failed to calculate mortgage preview:', error);
      setMortgagePreview(null);
    } finally {
      setIsLoadingPreview(false);
    }
  }, [isEditing, openingBalance, interestRate, amortizationMonths, mortgagePaymentFrequency, paymentStartDate, isCanadianMortgage, isVariableRate]);

  useEffect(() => {
    const timer = setTimeout(() => {
      calculateMortgagePreview();
    }, 500);
    return () => clearTimeout(timer);
  }, [calculateMortgagePreview]);

  const interestCategoryOptions = useMemo(() =>
    buildCategoryTree(categories).map(({ category }) => {
      const parentCategory = category.parentId
        ? categories.find(c => c.id === category.parentId)
        : null;
      return {
        value: category.id,
        label: parentCategory ? `${parentCategory.name}: ${category.name}` : category.name,
      };
    }),
  [categories]);

  const initialInterestCategoryName = useMemo(() => {
    if (!selectedInterestCategoryId) return '';
    const cat = categories.find(c => c.id === selectedInterestCategoryId);
    if (!cat) return '';
    const parent = cat.parentId ? categories.find(c => c.id === cat.parentId) : null;
    return parent ? `${parent.name}: ${cat.name}` : cat.name;
  }, [selectedInterestCategoryId, categories]);

  return (
    <div className="space-y-4 p-4 bg-purple-50 dark:bg-purple-900/20 rounded-lg border border-purple-200 dark:border-purple-800">
      <h3 className="text-sm font-medium text-gray-900 dark:text-gray-100">
        {t('mortgageFields.title')}
      </h3>

      {/* Canadian Mortgage and Variable Rate checkboxes */}
      <div className="grid grid-cols-2 gap-4">
        <div className="flex items-start gap-3">
          <input
            type="checkbox"
            id="isCanadianMortgage"
            className="mt-1 h-4 w-4 rounded border-gray-300 text-purple-600 focus:ring-purple-500"
            {...register('isCanadianMortgage')}
          />
          <label htmlFor="isCanadianMortgage" className="flex-1">
            <span className="block text-sm font-medium text-gray-900 dark:text-gray-100">
              {t('mortgageFields.canadianMortgage')}
            </span>
            <span className="block text-xs text-gray-500 dark:text-gray-400">
              {t('mortgageFields.canadianMortgageDesc')}
            </span>
          </label>
        </div>

        <div className="flex items-start gap-3">
          <input
            type="checkbox"
            id="isVariableRate"
            className="mt-1 h-4 w-4 rounded border-gray-300 text-purple-600 focus:ring-purple-500"
            {...register('isVariableRate')}
          />
          <label htmlFor="isVariableRate" className="flex-1">
            <span className="block text-sm font-medium text-gray-900 dark:text-gray-100">
              {t('mortgageFields.variableRate')}
            </span>
            <span className="block text-xs text-gray-500 dark:text-gray-400">
              {t('mortgageFields.variableRateDesc')}
            </span>
          </label>
        </div>
      </div>

      {/* Hidden inputs for form registration */}
      <input type="hidden" {...register('termMonths', { valueAsNumber: true })} />
      <input type="hidden" {...register('amortizationMonths', { valueAsNumber: true })} />

      {/* Term Length - years + months inputs */}
      <div>
        <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
          {t('mortgageFields.termLength')}
        </label>
        <div className="grid grid-cols-2 gap-4">
          <Input
            label={t('mortgageFields.years')}
            type="number"
            min={0}
            max={99}
            value={termYears}
            onChange={handleTermYearsChange}
            error={errors.termMonths?.message as string | undefined}
          />
          <Input
            label={t('mortgageFields.months')}
            type="number"
            min={0}
            max={11}
            value={termRemainder}
            onChange={handleTermMonthsChange}
          />
        </div>
        <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
          {t('mortgageFields.termLengthNoTerm')}
        </p>
      </div>

      {/* Amortization Period - years + months inputs */}
      <div>
        <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
          {t('mortgageFields.amortizationPeriod')}
        </label>
        <div className="grid grid-cols-2 gap-4">
          <Input
            label={t('mortgageFields.years')}
            type="number"
            min={0}
            max={99}
            value={amortYears}
            onChange={handleAmortYearsChange}
            error={errors.amortizationMonths?.message as string | undefined}
          />
          <Input
            label={t('mortgageFields.months')}
            type="number"
            min={0}
            max={11}
            value={amortRemainder}
            onChange={handleAmortMonthsChange}
          />
        </div>
      </div>

      {!isEditing && (
        <>
          <div className="grid grid-cols-2 gap-4">
            <Select
              label={t('mortgageFields.paymentFrequency')}
              options={[
                { value: '', label: t('mortgageFields.selectFrequency') },
                ...mortgagePaymentFrequencyOptions,
              ]}
              error={errors.mortgagePaymentFrequency?.message as string | undefined}
              {...register('mortgagePaymentFrequency')}
            />

            <DateInput
              label={t('mortgageFields.firstPaymentDate')}
              error={errors.paymentStartDate?.message as string | undefined}
              onDateChange={(date) => setValue('paymentStartDate', date, { shouldDirty: true, shouldValidate: true })}
              {...register('paymentStartDate')}
            />
          </div>

          <div className="grid grid-cols-2 gap-4">
            <Select
              label={t('mortgageFields.paymentFromAccount')}
              options={[
                { value: '', label: t('mortgageFields.selectAccount') },
                ...buildAccountDropdownOptions(
                  accounts,
                  () => true,
                  (a) => `${a.name} (${a.currencyCode})`,
                ),
              ]}
              error={errors.sourceAccountId?.message as string | undefined}
              {...register('sourceAccountId')}
            />

            <Combobox
              label={t('mortgageFields.interestCategory')}
              placeholder={t('mortgageFields.selectCategory')}
              options={interestCategoryOptions}
              value={selectedInterestCategoryId}
              initialDisplayValue={initialInterestCategoryName}
              onChange={handleInterestCategoryChange}
              error={errors.interestCategoryId?.message as string | undefined}
            />
          </div>

          {/* Mortgage Amortization Preview */}
          {mortgagePreview && (
            <div className="p-3 bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700">
              <h4 className="text-xs font-medium text-gray-500 dark:text-gray-400 mb-2">
                {t('mortgageFields.previewTitle')}
              </h4>
              <div className="grid grid-cols-2 gap-2 text-sm">
                <div>
                  <span className="text-gray-500 dark:text-gray-400">{t('mortgageFields.previewPaymentAmount')}</span>{' '}
                  <span className="font-medium">{formatCurrency(mortgagePreview.paymentAmount, watchedCurrency)}</span>
                </div>
                <div>
                  <span className="text-gray-500 dark:text-gray-400">{t('mortgageFields.previewEffectiveRate')}</span>{' '}
                  <span className="font-medium">{mortgagePreview.effectiveAnnualRate.toFixed(2)}%</span>
                </div>
                <div>
                  <span className="text-gray-500 dark:text-gray-400">{t('mortgageFields.previewFirstPrincipal')}</span>{' '}
                  <span className="font-medium">{formatCurrency(mortgagePreview.principalPayment, watchedCurrency)}</span>
                </div>
                <div>
                  <span className="text-gray-500 dark:text-gray-400">{t('mortgageFields.previewFirstInterest')}</span>{' '}
                  <span className="font-medium">{formatCurrency(mortgagePreview.interestPayment, watchedCurrency)}</span>
                </div>
                <div>
                  <span className="text-gray-500 dark:text-gray-400">{t('mortgageFields.previewTotalPayments')}</span>{' '}
                  <span className="font-medium">
                    {mortgagePreview.totalPayments > 0 ? mortgagePreview.totalPayments : t('mortgageFields.previewNA')}
                  </span>
                </div>
                <div>
                  <span className="text-gray-500 dark:text-gray-400">{t('mortgageFields.previewTotalInterest')}</span>{' '}
                  <span className="font-medium">
                    {mortgagePreview.totalInterest > 0 ? formatCurrency(mortgagePreview.totalInterest, watchedCurrency) : t('mortgageFields.previewNA')}
                  </span>
                </div>
                <div className="col-span-2">
                  <span className="text-gray-500 dark:text-gray-400">{t('mortgageFields.previewPayoffDate')}</span>{' '}
                  <span className="font-medium">
                    {mortgagePreview.totalPayments > 0
                      ? formatDate(new Date(mortgagePreview.endDate))
                      : t('mortgageFields.previewNA')}
                  </span>
                </div>
              </div>
            </div>
          )}
          {isLoadingPreview && (
            <div className="text-sm text-gray-500 dark:text-gray-400">
              {t('mortgageFields.calculatingPreview')}
            </div>
          )}
        </>
      )}
    </div>
  );
}
