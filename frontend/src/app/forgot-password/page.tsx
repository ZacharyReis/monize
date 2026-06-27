'use client';

import { useState, useEffect } from 'react';
import { useTranslations } from 'next-intl';
import { useRouter } from 'next/navigation';
import { useForm } from 'react-hook-form';
import '@/lib/zodConfig';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import Link from 'next/link';
import Image from 'next/image';
import { Input } from '@/components/ui/Input';
import { Button } from '@/components/ui/Button';
import { authApi } from '@/lib/auth';
import { buildEmailSchema } from '@/lib/zod-helpers';

const buildSchema = (tc: (key: string) => string) => z.object({
  email: buildEmailSchema(tc),
});

type FormData = z.infer<ReturnType<typeof buildSchema>>;

export default function ForgotPasswordPage() {
  const t = useTranslations('auth');
  const tf = useTranslations('auth.forgotPassword');
  const tc = useTranslations('common');
  const router = useRouter();
  const [isLoading, setIsLoading] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [isCheckingSmtp, setIsCheckingSmtp] = useState(true);

  useEffect(() => {
    const checkSmtp = async () => {
      try {
        const methods = await authApi.getAuthMethods();
        if (!methods.smtp || !methods.local || methods.demo) {
          router.replace('/login');
          return;
        }
      } catch {
        router.replace('/login');
        return;
      }
      setIsCheckingSmtp(false);
    };
    checkSmtp();
  }, [router]);

  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<FormData>({
    resolver: zodResolver(buildSchema(tc)),
  });

  const onSubmit = async (data: FormData) => {
    setIsLoading(true);
    try {
      await authApi.forgotPassword(data.email);
    } catch {
      // Show success even on error to prevent account enumeration
    } finally {
      setIsLoading(false);
      setSubmitted(true);
    }
  };

  if (isCheckingSmtp) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50 dark:bg-gray-900">
        <div className="text-gray-500 dark:text-gray-400">{tc('loading')}</div>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50 dark:bg-gray-900 py-12 px-4 sm:px-6 lg:px-8">
      <div className="max-w-md w-full space-y-8">
        <div>
          <Image src="/icons/monize-logo.svg" alt="Monize" width={96} height={96} className="mx-auto rounded-xl" priority />
          <h2 className="mt-4 text-center text-3xl font-extrabold text-gray-900 dark:text-gray-100">
            {tf('title')}
          </h2>
          <p className="mt-2 text-center text-sm text-gray-600 dark:text-gray-400">
            {tf('subtitle')}
          </p>
        </div>

        {submitted ? (
          <div className="text-center space-y-4">
            <div className="bg-green-50 dark:bg-green-900/30 border border-green-200 dark:border-green-800 rounded-lg p-4">
              <p className="text-sm text-green-800 dark:text-green-200">
                {tf('successMessage')}
              </p>
            </div>
            <Link
              href="/login"
              className="inline-block font-medium text-blue-600 hover:text-blue-500 dark:text-blue-400 dark:hover:text-blue-300"
            >
              {t('backToSignIn')}
            </Link>
          </div>
        ) : (
          <form onSubmit={handleSubmit(onSubmit)} className="mt-8 space-y-6">
            <Input
              label={tf('emailLabel')}
              type="email"
              autoComplete="email"
              error={errors.email?.message}
              {...register('email')}
            />
            <Button
              type="submit"
              variant="primary"
              size="lg"
              isLoading={isLoading}
              className="w-full"
            >
              {tf('submit')}
            </Button>
            <p className="text-center text-sm">
              <Link
                href="/login"
                className="font-medium text-blue-600 hover:text-blue-500 dark:text-blue-400 dark:hover:text-blue-300"
              >
                {t('backToSignIn')}
              </Link>
            </p>
          </form>
        )}
      </div>
    </div>
  );
}
