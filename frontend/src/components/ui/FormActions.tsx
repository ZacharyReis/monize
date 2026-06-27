'use client';

import { useTranslations } from 'next-intl';
import { Button } from './Button';
import { cn } from '@/lib/utils';

interface FormActionsProps {
  onCancel?: () => void;
  submitLabel?: string;
  isSubmitting?: boolean;
  submitDisabled?: boolean;
  className?: string;
}

/**
 * Standardized Cancel + Submit button row for form modals.
 */
export function FormActions({
  onCancel,
  submitLabel,
  isSubmitting = false,
  submitDisabled = false,
  className,
}: FormActionsProps) {
  const t = useTranslations('common');
  const resolvedSubmitLabel = submitLabel ?? t('formActions.save');
  return (
    <div className={cn('flex justify-end space-x-3 pt-4', className)}>
      {onCancel && (
        <Button
          type="button"
          variant="outline"
          onClick={onCancel}
          disabled={isSubmitting}
        >
          {t('formActions.cancel')}
        </Button>
      )}
      <Button type="submit" isLoading={isSubmitting} disabled={submitDisabled || isSubmitting}>
        {resolvedSubmitLabel}
      </Button>
    </div>
  );
}
