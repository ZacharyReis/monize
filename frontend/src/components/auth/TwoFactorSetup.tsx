'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { useForm, useWatch } from 'react-hook-form';
import '@/lib/zodConfig';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import toast from 'react-hot-toast';
import { Input } from '@/components/ui/Input';
import { Button } from '@/components/ui/Button';
import { BackupCodesDisplay } from '@/components/auth/BackupCodesDisplay';
import { authApi } from '@/lib/auth';
import { getErrorMessage } from '@/lib/errors';
import { buildTotpCodeSchema } from '@/lib/zod-helpers';
import { TwoFactorSetupResponse } from '@/types/auth';

const buildTotpFormSchema = (tc: (key: string) => string) => z.object({
  code: buildTotpCodeSchema(tc),
});

type TotpCodeFormData = z.infer<ReturnType<typeof buildTotpFormSchema>>;

const buildPasswordFormSchema = (t: (key: string) => string) => z.object({
  currentPassword: z.string().min(1, t('validation.passwordRequired')).max(128),
});

type PasswordFormData = z.infer<ReturnType<typeof buildPasswordFormSchema>>;

interface TwoFactorSetupProps {
  onComplete: () => void;
  onSkip?: () => void;
  isForced?: boolean;
}

export function TwoFactorSetup({ onComplete, onSkip, isForced }: TwoFactorSetupProps) {
  const t = useTranslations('auth.twoFactorSetup');
  const tc = useTranslations('common');
  const [setupData, setSetupData] = useState<TwoFactorSetupResponse | null>(null);
  const [showManualKey, setShowManualKey] = useState(false);
  const [backupCodes, setBackupCodes] = useState<string[] | null>(null);

  const {
    register,
    handleSubmit,
    setValue,
    control,
    formState: { isSubmitting },
  } = useForm<TotpCodeFormData>({
    resolver: zodResolver(buildTotpFormSchema(tc)),
    defaultValues: {
      code: '',
    },
  });

  // useWatch is the React Compiler-friendly equivalent of watch() -- it lets
  // the surrounding component be memoized (watch() returns a fresh function on
  // every render, which the compiler can't optimize).
  const codeValue = useWatch({ control, name: 'code', defaultValue: '' });
  const codeRef = register('code');

  const {
    register: registerPassword,
    handleSubmit: handlePasswordSubmit,
    formState: { errors: passwordErrors, isSubmitting: isPasswordSubmitting },
  } = useForm<PasswordFormData>({
    resolver: zodResolver(buildPasswordFormSchema(t)),
    defaultValues: { currentPassword: '' },
  });

  const onPasswordSubmit = async (data: PasswordFormData) => {
    try {
      const setup = await authApi.setup2FA(data.currentPassword);
      setSetupData(setup);
    } catch (error) {
      toast.error(getErrorMessage(error, t('toasts.passwordIncorrect')));
    }
  };

  const onSubmit = async (formData: TotpCodeFormData) => {
    try {
      await authApi.confirmSetup2FA(formData.code);
      toast.success(t('toasts.enabled'));
      // Generate backup codes after successful 2FA setup
      try {
        const response = await authApi.generateBackupCodes(formData.code);
        setBackupCodes(response.codes);
      } catch (error) {
        toast.error(getErrorMessage(error, t('toasts.backupFailed')));
        onComplete();
      }
    } catch (error) {
      toast.error(getErrorMessage(error, t('toasts.invalidCode')));
      setValue('code', '');
    }
  };

  if (backupCodes) {
    return <BackupCodesDisplay codes={backupCodes} onDone={onComplete} />;
  }

  if (!setupData) {
    return (
      <form onSubmit={handlePasswordSubmit(onPasswordSubmit)} className="space-y-4">
        <div className="text-center">
          <h3 className="text-lg font-semibold text-gray-900 dark:text-gray-100">
            {t('confirmTitle')}
          </h3>
          <p className="mt-1 text-sm text-gray-600 dark:text-gray-400">
            {t('confirmSubtitle')}
          </p>
        </div>

        <Input
          label={t('currentPasswordLabel')}
          type="password"
          autoComplete="current-password"
          error={passwordErrors.currentPassword?.message}
          {...registerPassword('currentPassword')}
        />

        <Button
          type="submit"
          variant="primary"
          size="lg"
          isLoading={isPasswordSubmitting}
          className="w-full"
        >
          {t('continue')}
        </Button>

        {onSkip && !isForced && (
          <button
            type="button"
            onClick={onSkip}
            className="w-full text-center text-sm font-medium text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-300"
          >
            {t('skip')}
          </button>
        )}
      </form>
    );
  }

  return (
    <div className="space-y-6">
      <div className="text-center">
        <h3 className="text-lg font-semibold text-gray-900 dark:text-gray-100">
          {t('setupTitle')}
        </h3>
        <p className="mt-1 text-sm text-gray-600 dark:text-gray-400">
          {t('setupSubtitle')}
        </p>
      </div>

      <div className="flex justify-center">
        <div className="bg-white p-4 rounded-lg">
          {/* eslint-disable-next-line @next/next/no-img-element -- data URL not optimizable by next/image */}
          <img
            src={setupData.qrCodeDataUrl}
            alt={t('qrAlt')}
            className="w-48 h-48"
          />
        </div>
      </div>

      <div className="text-center">
        <button
          type="button"
          onClick={() => setShowManualKey(!showManualKey)}
          className="text-sm font-medium text-blue-600 hover:text-blue-500 dark:text-blue-400 dark:hover:text-blue-300"
        >
          {showManualKey ? t('hideManualKey') : t('showManualKey')}
        </button>
        {showManualKey && (
          <div className="mt-2 p-3 bg-gray-100 dark:bg-gray-700 rounded-lg">
            <p className="text-xs text-gray-500 dark:text-gray-400 mb-1">{t('manualEntryKey')}</p>
            <p className="font-mono text-sm text-gray-900 dark:text-gray-100 select-all break-all">
              {setupData.secret}
            </p>
          </div>
        )}
      </div>

      <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
        <Input
          label={t('codeLabel')}
          type="text"
          inputMode="numeric"
          autoComplete="one-time-code"
          maxLength={6}
          placeholder="000000"
          {...codeRef}
          onChange={(e) => {
            const filtered = e.target.value.replace(/\D/g, '');
            e.target.value = filtered;
            codeRef.onChange(e);
          }}
        />

        <Button
          type="submit"
          variant="primary"
          size="lg"
          isLoading={isSubmitting}
          disabled={codeValue.length !== 6}
          className="w-full"
        >
          {t('verifyEnable')}
        </Button>

        {onSkip && !isForced && (
          <button
            type="button"
            onClick={onSkip}
            className="w-full text-center text-sm font-medium text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-300"
          >
            {t('skip')}
          </button>
        )}
      </form>
    </div>
  );
}
