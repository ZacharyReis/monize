'use client';

import { useTranslations } from 'next-intl';
import { useForm, Controller } from 'react-hook-form';
import '@/lib/zodConfig';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { CurrencyInput } from '@/components/ui/CurrencyInput';
import { getCurrencySymbol } from '@/lib/format';
import type {
  Budget,
  UpdateBudgetData,
} from '@/types/budget';

const BUDGET_TYPES = ['MONTHLY', 'ANNUAL', 'PAY_PERIOD'] as const;
const STRATEGIES = ['FIXED', 'ROLLOVER', 'ZERO_BASED', 'FIFTY_THIRTY_TWENTY'] as const;

const buildBudgetFormSchema = (t: (key: string) => string) => z.object({
  name: z.string().min(1, t('validation.nameRequired')).max(255, t('validation.nameMax')),
  description: z.string().max(1000, t('validation.descriptionMax')).optional().or(z.literal('')),
  budgetType: z.enum(BUDGET_TYPES),
  strategy: z.enum(STRATEGIES),
  baseIncome: z.number().min(0).optional(),
  isActive: z.boolean(),
});

type BudgetFormData = z.infer<ReturnType<typeof buildBudgetFormSchema>>;

interface BudgetFormProps {
  budget: Budget;
  onSave: (data: UpdateBudgetData) => Promise<void>;
  onCancel: () => void;
  isSaving?: boolean;
}

const TYPE_VALUES = ['MONTHLY', 'ANNUAL', 'PAY_PERIOD'] as const;
const STRATEGY_VALUES = ['FIXED', 'ROLLOVER', 'ZERO_BASED', 'FIFTY_THIRTY_TWENTY'] as const;

export function BudgetForm({
  budget,
  onSave,
  onCancel,
  isSaving = false,
}: BudgetFormProps) {
  const t = useTranslations('budgets');
  const tc = useTranslations('common');
  const {
    register,
    handleSubmit,
    control,
    formState: { errors },
  } = useForm<BudgetFormData>({
    resolver: zodResolver(buildBudgetFormSchema(t)),
    defaultValues: {
      name: budget.name,
      description: budget.description ?? '',
      budgetType: budget.budgetType,
      strategy: budget.strategy,
      baseIncome: budget.baseIncome !== null ? budget.baseIncome : undefined,
      isActive: budget.isActive,
    },
  });

  const onSubmit = async (formData: BudgetFormData) => {
    const data: UpdateBudgetData = {
      name: formData.name.trim(),
      description: formData.description?.trim() || undefined,
      budgetType: formData.budgetType,
      strategy: formData.strategy,
      baseIncome: formData.baseIncome ?? undefined,
    };

    await onSave(data);
  };

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
      <Input
        label={t('form.budgetName')}
        {...register('name')}
        error={errors.name?.message}
        required
        maxLength={255}
      />

      <Input
        label={t('form.description')}
        {...register('description')}
        error={errors.description?.message}
        placeholder={t('form.descriptionPlaceholder')}
      />

      <div>
        <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
          {t('form.budgetType')}
        </label>
        <select
          {...register('budgetType')}
          className="w-full border border-gray-300 dark:border-gray-600 rounded-md px-3 py-2 bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100"
        >
          {TYPE_VALUES.map((value) => (
            <option key={value} value={value}>
              {t(`form.typeOptions.${value}`)}
            </option>
          ))}
        </select>
        {errors.budgetType && (
          <p className="mt-1 text-sm text-red-600 dark:text-red-400">{errors.budgetType.message}</p>
        )}
      </div>

      <div>
        <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
          {t('form.strategy')}
        </label>
        <select
          {...register('strategy')}
          className="w-full border border-gray-300 dark:border-gray-600 rounded-md px-3 py-2 bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100"
        >
          {STRATEGY_VALUES.map((value) => (
            <option key={value} value={value}>
              {t(`form.strategyOptions.${value}`)}
            </option>
          ))}
        </select>
        {errors.strategy && (
          <p className="mt-1 text-sm text-red-600 dark:text-red-400">{errors.strategy.message}</p>
        )}
      </div>

      <Controller
        name="baseIncome"
        control={control}
        render={({ field }) => (
          <CurrencyInput
            label={t('form.baseIncome')}
            value={field.value}
            onChange={field.onChange}
            onBlur={field.onBlur}
            allowNegative={false}
            prefix={getCurrencySymbol(budget.currencyCode)}
            placeholder={t('form.baseIncomePlaceholder')}
          />
        )}
      />

      <div className="flex items-center gap-2">
        <input
          type="checkbox"
          id="isActive"
          {...register('isActive')}
          className="h-4 w-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
        />
        <label
          htmlFor="isActive"
          className="text-sm font-medium text-gray-700 dark:text-gray-300"
        >
          {t('form.active')}
        </label>
      </div>

      <div className="flex justify-end gap-3 pt-2">
        <Button type="button" variant="outline" onClick={onCancel}>
          {tc('cancel')}
        </Button>
        <Button type="submit" disabled={isSaving}>
          {isSaving ? t('form.saving') : t('form.saveChanges')}
        </Button>
      </div>
    </form>
  );
}
