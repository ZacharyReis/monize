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
  /**
   * Attributes (a `data-tour-id`) for the button pair itself. The row is
   * full-width, so anchoring a guided tour on it would ring the whole width of
   * the form; this wraps just the buttons, and only when asked.
   */
  anchorProps?: Record<string, string>;
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
  anchorProps,
}: FormActionsProps) {
  const t = useTranslations('common');
  const resolvedSubmitLabel = submitLabel ?? t('formActions.save');
  const buttons = (
    <>
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
    </>
  );
  return (
    <div className={cn('flex justify-end space-x-3 pt-4', className)}>
      {anchorProps ? (
        <div className="flex space-x-3" {...anchorProps}>
          {buttons}
        </div>
      ) : (
        buttons
      )}
    </div>
  );
}
