'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { useForm } from 'react-hook-form';
import '@/lib/zodConfig';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import toast from 'react-hot-toast';
import { Input } from '@/components/ui/Input';
import { Button } from '@/components/ui/Button';
import { authApi } from '@/lib/auth';
import { getErrorMessage } from '@/lib/errors';
import { buildTotpCodeSchema } from '@/lib/zod-helpers';
import { User } from '@/types/auth';

const buildTotpSchema = (tc: (key: string) => string) => z.object({
  code: buildTotpCodeSchema(tc),
  rememberDevice: z.boolean(),
});

const buildBackupCodeSchema = (t: (key: string) => string) => z.object({
  code: z.string().regex(/^[A-Fa-f0-9]{4}-[A-Fa-f0-9]{4}$/, t('validation.backupFormat')),
  rememberDevice: z.boolean(),
});

type VerifyFormData = z.infer<ReturnType<typeof buildTotpSchema>>;

interface TwoFactorVerifyProps {
  tempToken: string;
  onVerified: (user: User) => void;
  onCancel: () => void;
}

export function TwoFactorVerify({ tempToken, onVerified, onCancel }: TwoFactorVerifyProps) {
  const t = useTranslations('auth.twoFactorVerify');
  const tc = useTranslations('common');
  const [isLoading, setIsLoading] = useState(false);
  const [useBackupCode, setUseBackupCode] = useState(false);

  const {
    register,
    handleSubmit,
    setValue,
    watch,
    reset,
  } = useForm<VerifyFormData>({
    resolver: zodResolver(useBackupCode ? buildBackupCodeSchema(t) : buildTotpSchema(tc)),
    defaultValues: {
      code: '',
      rememberDevice: false,
    },
  });

  const codeValue = watch('code');
  const codeRef = register('code');

  const handleToggleMode = () => {
    const next = !useBackupCode;
    setUseBackupCode(next);
    reset({ code: '', rememberDevice: false });
  };

  const isTotpValid = !useBackupCode && codeValue.length === 6;
  const isBackupValid = useBackupCode && /^[A-Fa-f0-9]{4}-[A-Fa-f0-9]{4}$/.test(codeValue);
  const isCodeValid = isTotpValid || isBackupValid;

  const onSubmit = async (formData: VerifyFormData) => {
    if (!isCodeValid) return;

    setIsLoading(true);
    try {
      const response = await authApi.verify2FA(tempToken, formData.code, formData.rememberDevice);
      if (response.user) {
        onVerified(response.user);
      }
    } catch (error) {
      toast.error(getErrorMessage(error, t('invalidCode')));
      setValue('code', '');
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="text-center">
        <div className="mx-auto w-12 h-12 bg-blue-100 dark:bg-blue-900/30 rounded-full flex items-center justify-center mb-4">
          <svg className="w-6 h-6 text-blue-600 dark:text-blue-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
          </svg>
        </div>
        <h3 className="text-lg font-semibold text-gray-900 dark:text-gray-100">
          {t('title')}
        </h3>
        <p className="mt-1 text-sm text-gray-600 dark:text-gray-400">
          {useBackupCode
            ? t('promptBackup')
            : t('promptTotp')}
        </p>
      </div>

      <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
        {useBackupCode ? (
          <Input
            label={t('backupLabel')}
            type="text"
            autoComplete="off"
            maxLength={9}
            placeholder="xxxx-xxxx"
            autoFocus
            {...codeRef}
            onChange={(e) => {
              const filtered = e.target.value.replace(/[^A-Fa-f0-9-]/g, '').toLowerCase();
              e.target.value = filtered;
              codeRef.onChange(e);
            }}
          />
        ) : (
          <Input
            label={t('codeLabel')}
            type="text"
            inputMode="numeric"
            autoComplete="one-time-code"
            maxLength={6}
            placeholder="000000"
            autoFocus
            {...codeRef}
            onChange={(e) => {
              const filtered = e.target.value.replace(/\D/g, '');
              e.target.value = filtered;
              codeRef.onChange(e);
            }}
          />
        )}

        <label className="flex items-center gap-2 cursor-pointer">
          <input
            type="checkbox"
            {...register('rememberDevice')}
            className="h-4 w-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500 dark:border-gray-600 dark:bg-gray-700"
          />
          <span className="text-sm text-gray-600 dark:text-gray-400">
            {t('rememberDevice')}
          </span>
        </label>

        <Button
          type="submit"
          variant="primary"
          size="lg"
          isLoading={isLoading}
          disabled={!isCodeValid}
          className="w-full"
        >
          {t('verify')}
        </Button>

        <button
          type="button"
          onClick={handleToggleMode}
          className="w-full text-center text-sm font-medium text-blue-600 hover:text-blue-500 dark:text-blue-400 dark:hover:text-blue-300"
        >
          {useBackupCode ? t('useAuthenticator') : t('useBackup')}
        </button>

        <button
          type="button"
          onClick={onCancel}
          className="w-full text-center text-sm font-medium text-blue-600 hover:text-blue-500 dark:text-blue-400 dark:hover:text-blue-300"
        >
          {t('backToLogin')}
        </button>
      </form>
    </div>
  );
}
