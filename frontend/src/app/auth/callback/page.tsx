'use client';

import { useEffect, useRef, useState, Suspense } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useAuthStore } from '@/store/authStore';
import { authApi } from '@/lib/auth';
import { getErrorMessage } from '@/lib/errors';
import toast from 'react-hot-toast';
import { useTranslations } from 'next-intl';
import { OnboardingPreferencesScreen } from '@/components/auth/OnboardingPreferencesScreen';

function CallbackContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { login, setLoading, setError } = useAuthStore();
  const t = useTranslations('auth');
  // Set when the backend flags this login as the one that provisioned the
  // account: holds the path to continue to once the first-run language and
  // currency step is done (or skipped).
  const [onboardingTarget, setOnboardingTarget] = useState<string | null>(null);
  // The sign-in exchange must run exactly once. Its effect depends on values
  // that are not referentially stable across renders (the translator), so
  // without this guard any re-render would re-run the whole handler --
  // re-fetching the profile, re-toasting, and re-reading a `returnTo` that the
  // first pass has already consumed.
  const hasHandledCallback = useRef(false);

  useEffect(() => {
    if (hasHandledCallback.current) return;
    hasHandledCallback.current = true;

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
            // A brand-new SSO account gets the same first-run preferences
            // step local registration ends on; the destination is held until
            // the user finishes with it.
            if (searchParams.get('welcome') === 'true') {
              setOnboardingTarget(returnTo ?? '/dashboard');
            } else if (returnTo) {
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

  if (onboardingTarget) {
    return (
      <OnboardingPreferencesScreen
        onComplete={(result) => {
          // A locale change needs a full document load so every layout
          // segment re-renders with the new catalogs, and a stashed returnTo
          // is followed the same way it would have been without this step.
          if (result?.localeChanged || onboardingTarget !== '/dashboard') {
            window.location.assign(onboardingTarget);
          } else {
            router.push(onboardingTarget);
          }
        }}
      />
    );
  }

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
