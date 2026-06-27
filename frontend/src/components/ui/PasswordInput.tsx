'use client';

import { forwardRef, useState, InputHTMLAttributes } from 'react';
import { useTranslations } from 'next-intl';
import { EyeIcon, EyeSlashIcon } from '@heroicons/react/24/outline';
import { cn } from '@/lib/utils';

type PasswordInputProps = Omit<
  InputHTMLAttributes<HTMLInputElement>,
  'type'
>;

/**
 * Password text field with a show/hide eye toggle. forwardRef so it works
 * as a drop-in for both controlled inputs and react-hook-form
 * `{...register()}` spreads. Pass the usual input className; an inner
 * right-padding is added so the text never sits under the eye button.
 */
export const PasswordInput = forwardRef<HTMLInputElement, PasswordInputProps>(
  function PasswordInput({ className, ...props }, ref) {
    const t = useTranslations('common');
    const [visible, setVisible] = useState(false);
    return (
      <div className="relative">
        <input
          ref={ref}
          type={visible ? 'text' : 'password'}
          className={cn(className, 'pr-10')}
          {...props}
        />
        <button
          type="button"
          tabIndex={-1}
          onClick={() => setVisible((v) => !v)}
          aria-label={visible ? t('passwordInput.hide') : t('passwordInput.show')}
          title={visible ? t('passwordInput.hide') : t('passwordInput.show')}
          className="absolute inset-y-0 right-0 flex items-center px-3 text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 focus:outline-none"
        >
          {visible ? (
            <EyeSlashIcon className="h-5 w-5" />
          ) : (
            <EyeIcon className="h-5 w-5" />
          )}
        </button>
      </div>
    );
  },
);
