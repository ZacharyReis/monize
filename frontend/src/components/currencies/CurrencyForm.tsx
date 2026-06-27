'use client';

import { useState, useCallback, MutableRefObject } from 'react';
import { useForm, Resolver } from 'react-hook-form';
import '@/lib/zodConfig';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import toast from 'react-hot-toast';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { CurrencyInfo, CreateCurrencyData } from '@/lib/exchange-rates';
import { exchangeRatesApi } from '@/lib/exchange-rates';
import { createLogger } from '@/lib/logger';
import { useTranslations } from 'next-intl';
import { useFormSubmitRef } from '@/hooks/useFormSubmitRef';
import { useFormDirtyNotify } from '@/hooks/useFormDirtyNotify';
import { FormActions } from '@/components/ui/FormActions';

const logger = createLogger('CurrencyForm');

const buildCurrencySchema = (t: (key: string) => string) => z.object({
  code: z.string().length(3, t('validation.codeLength')),
  name: z.string().min(1, t('validation.nameRequired')).max(100, t('validation.nameMax')),
  symbol: z.string().min(1, t('validation.symbolRequired')).max(10, t('validation.symbolMax')),
  decimalPlaces: z.coerce.number().int().min(0).max(4).default(2),
});

type CurrencyFormData = z.infer<ReturnType<typeof buildCurrencySchema>>;

interface CurrencyFormProps {
  currency?: CurrencyInfo;
  onSubmit: (data: CreateCurrencyData) => Promise<void>;
  onCancel: () => void;
  onDirtyChange?: (isDirty: boolean) => void;
  submitRef?: MutableRefObject<(() => void) | null>;
}

export function CurrencyForm({ currency, onSubmit, onCancel, onDirtyChange, submitRef }: CurrencyFormProps) {
  const t = useTranslations('currencies');
  const [isLookingUp, setIsLookingUp] = useState(false);
  const [hasLookupResult, setHasLookupResult] = useState(false);

  const {
    register,
    handleSubmit,
    setValue,
    getValues,
    reset,
    formState: { errors, isSubmitting, isDirty },
  } = useForm<CurrencyFormData>({
    resolver: zodResolver(buildCurrencySchema(t)) as Resolver<CurrencyFormData>,
    defaultValues: {
      code: currency?.code || '',
      name: currency?.name || '',
      symbol: currency?.symbol || '',
      decimalPlaces: currency?.decimalPlaces ?? 2,
    },
  });

  const handleLookup = useCallback(async () => {
    const { code, name } = getValues();
    // Use code if provided, otherwise fall back to name field (for country/currency name search)
    const codeQuery = code?.trim() || '';
    const nameQuery = name?.trim() || '';
    const query = codeQuery.length >= 2 ? codeQuery : nameQuery;

    if (query.length < 2) {
      toast.error(t('form.toasts.lookupTooShort'));
      return;
    }

    setIsLookingUp(true);
    try {
      const result = await exchangeRatesApi.lookupCurrency(query);
      if (result) {
        setValue('code', result.code);
        setValue('name', result.name);
        setValue('symbol', result.symbol);
        setValue('decimalPlaces', result.decimalPlaces);
        setHasLookupResult(true);

        const details = [`Code: ${result.code}`, `Name: ${result.name}`, `Symbol: ${result.symbol}`];
        toast.success(t('form.toasts.found', { details: details.join(', ') }));
      } else {
        toast.error(t('form.toasts.notFound', { query }));
      }
    } catch (error) {
      logger.error('Currency lookup failed:', error);
      toast.error(t('form.toasts.lookupFailed'));
    } finally {
      setIsLookingUp(false);
    }
  }, [getValues, setValue, t]);

  const handleClear = useCallback(() => {
    reset({
      code: '',
      name: '',
      symbol: '',
      decimalPlaces: 2,
    });
    setHasLookupResult(false);
  }, [reset]);

  const onFormSubmit = async (data: CurrencyFormData) => {
    const cleanedData: CreateCurrencyData = {
      code: data.code.toUpperCase().trim(),
      name: data.name.trim(),
      symbol: data.symbol.trim(),
      decimalPlaces: data.decimalPlaces,
    };
    await onSubmit(cleanedData);
  };

  useFormDirtyNotify(isDirty, onDirtyChange);

  useFormSubmitRef(submitRef, handleSubmit, onFormSubmit);

  return (
    <form onSubmit={handleSubmit(onFormSubmit)} className="space-y-4">
      {/* Code + Lookup / Clear buttons */}
      <div className="flex gap-2 items-end">
        <div className="flex-1">
          <Input
            label={t('form.codeLabel')}
            {...register('code')}
            error={errors.code?.message}
            placeholder={t('form.codePlaceholder')}
            className="uppercase"
            disabled={!!currency}
          />
        </div>
        {!currency && (
          <div className="flex gap-1.5">
            <Button
              type="button"
              variant="outline"
              onClick={handleLookup}
              disabled={isLookingUp}
              className="mb-[1px]"
            >
              {isLookingUp ? t('form.lookingUp') : t('form.lookupButton')}
            </Button>
            {hasLookupResult && (
              <Button
                type="button"
                variant="ghost"
                onClick={handleClear}
                className="mb-[1px] text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200"
                title={t('form.clearTitle')}
              >
                {t('form.clearButton')}
              </Button>
            )}
          </div>
        )}
      </div>

      <Input
        label={t('form.nameLabel')}
        {...register('name')}
        error={errors.name?.message}
        placeholder={currency ? t('form.namePlaceholderEdit') : t('form.namePlaceholderCreate')}
      />

      <Input
        label={t('form.symbolLabel')}
        {...register('symbol')}
        error={errors.symbol?.message}
        placeholder={t('form.symbolPlaceholder')}
      />

      <Input
        label={t('form.decimalPlacesLabel')}
        type="number"
        {...register('decimalPlaces')}
        error={errors.decimalPlaces?.message}
        min={0}
        max={4}
      />

      <FormActions onCancel={onCancel} submitLabel={currency ? t('form.submitUpdate') : t('form.submitCreate')} isSubmitting={isSubmitting} />
    </form>
  );
}
