'use client';

import { useEffect, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import toast from 'react-hot-toast';
import { useAuthStore } from '@/store/authStore';
import type { DelegateSectionGrants } from '@/lib/delegation';

type Section = keyof DelegateSectionGrants;

/**
 * Client-side UX guard for section-scoped routes. The backend
 * AccountDelegateGuard is the real enforcement; this just keeps a delegate
 * out of a section they were not granted instead of showing an empty/403
 * page. Non-delegates are unaffected.
 *
 * While acting but before /auth/contexts has resolved (delegateSections
 * still null), render nothing rather than redirecting -- a premature
 * redirect would eject a delegate who actually has the grant.
 */
export function DelegateSectionGuard({
  section,
  children,
}: {
  section: Section;
  children: React.ReactNode;
}) {
  const router = useRouter();
  const t = useTranslations('common');
  const actingAsUserId = useAuthStore((s) => s.actingAsUserId);
  const delegateSections = useAuthStore((s) => s.delegateSections);
  const isDelegateView = !!actingAsUserId;
  const blocked =
    isDelegateView &&
    delegateSections !== null &&
    !delegateSections[section];
  const notified = useRef(false);

  useEffect(() => {
    if (blocked && !notified.current) {
      notified.current = true;
      toast.error(t('noSectionAccess'));
      router.replace('/dashboard');
    }
  }, [blocked, router, t]);

  // For an acting delegate, never render the section content (or its
  // loading skeleton) until we know the grant: nothing while contexts load,
  // and nothing when blocked. This keeps the redirect consistent and
  // flash-free across every section route.
  if (isDelegateView && (delegateSections === null || blocked)) return null;

  return <>{children}</>;
}
