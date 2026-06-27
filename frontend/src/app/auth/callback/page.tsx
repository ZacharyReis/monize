'use client';

import { useEffect, Suspense } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useAuthStore } from '@/store/authStore';
import { authApi } from '@/lib/auth';
import { getErrorMessage } from '@/lib/errors';
import toast from 'react-hot-toast';
import { useTranslations } from 'next-intl';

function CallbackContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { login, setLoading, setError } = useAuthStore();
  const t = useTranslations('auth');

  useEffect(() => {
    const handleCallback = async () => {
      setLoading(true);
      try {
        const success = searchParams.get('success');
        const error = searchParams.get('error');

        // Handle error from OIDC provider
        if (error) {
          toast.error(t('callback.toasts.oidcFailed'));
          router.push('/login');
          return;
        }

        // For OIDC flow, token is in httpOnly cookie
        // For both flows, fetch the user profile to validate authentication
        try {
          const user = await authApi.getProfile();

          // For OIDC, we don't have the token in JS (it's httpOnly)
          // Store a placeholder to indicate we're authenticated via cookie
          login(user, 'httpOnly');

          toast.success(t('callback.toasts.signedIn'));
          if (user.mustChangePassword && user.hasPassword) {
            router.push('/change-password');
          } else {
            // Honor a returnTo path stashed by the login page before the
            // OIDC redirect (used to resume the OAuth consent flow when a
            // Claude Desktop connector triggers the login). Restricted to
            // same-origin paths to block open-redirect abuse.
            let returnTo: string | null = null;
            try {
              const stored = sessionStorage.getItem('postLoginReturnTo');
              sessionStorage.removeItem('postLoginReturnTo');
              if (
                stored &&
                stored.startsWith('/') &&
                !stored.startsWith('//') &&
                !stored.startsWith('/\\')
              ) {
                returnTo = stored;
              }
            } catch {
              // sessionStorage unavailable — fall through to /dashboard
            }
            if (returnTo) {
              window.location.href = returnTo;
            } else {
              router.push('/dashboard');
            }
          }
        } catch {
          toast.error(!success ? t('callback.toasts.noToken') : t('callback.toasts.failed'));
          router.push('/login');
        }
      } catch (error) {
        const message = getErrorMessage(error, t('callback.toasts.failed'));
        setError(message);
        toast.error(message);
        router.push('/login');
      } finally {
        setLoading(false);
      }
    };

    handleCallback();
  }, [searchParams, router, login, setLoading, setError, t]);

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50 dark:bg-gray-900">
      <div className="text-center">
        <div className="inline-block animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600 mb-4"></div>
        <h2 className="text-xl font-semibold text-gray-900 dark:text-white">
          {t('callback.title')}
        </h2>
        <p className="text-gray-600 dark:text-gray-400 mt-2">{t('callback.subtitle')}</p>
      </div>
    </div>
  );
}

export default function CallbackPage() {
  const tc = useTranslations('common');
  return (
    <Suspense fallback={
      <div className="min-h-screen flex items-center justify-center bg-gray-50 dark:bg-gray-900">
        <div className="text-center">
          <div className="inline-block animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600 mb-4"></div>
          <h2 className="text-xl font-semibold text-gray-900 dark:text-white">{tc('loading')}</h2>
        </div>
      </div>
    }>
      <CallbackContent />
    </Suspense>
  );
}
