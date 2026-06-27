'use client';

import { useState, useEffect, useCallback } from 'react';
import { useTranslations } from 'next-intl';
import { useRouter } from 'next/navigation';
import toast from 'react-hot-toast';
import { ProtectedRoute } from '@/components/auth/ProtectedRoute';
import { PageLayout } from '@/components/layout/PageLayout';
import { PageHeader } from '@/components/layout/PageHeader';
import { LoadingSpinner } from '@/components/ui/LoadingSpinner';
import { Button } from '@/components/ui/Button';
import { UserManagementTable } from '@/components/admin/UserManagementTable';
import { ResetPasswordModal } from '@/components/admin/ResetPasswordModal';
import { CreateUserModal } from '@/components/admin/CreateUserModal';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { useAuthStore } from '@/store/authStore';
import { adminApi, CreateUserResponse } from '@/lib/admin';
import { userSettingsApi } from '@/lib/user-settings';
import { AdminUser } from '@/types/auth';
import { createLogger } from '@/lib/logger';
import { getErrorMessage } from '@/lib/errors';

const logger = createLogger('AdminUsers');

export default function AdminUsersPage() {
  const t = useTranslations('admin');
  const router = useRouter();
  const { user: currentUser } = useAuthStore();
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [smtpConfigured, setSmtpConfigured] = useState(false);
  const [createModalOpen, setCreateModalOpen] = useState(false);

  // Reset password modal state. Reused to surface a generated temporary
  // password both for admin resets and for newly created accounts.
  const [resetPasswordModal, setResetPasswordModal] = useState<{
    isOpen: boolean;
    temporaryPassword: string;
    userName: string;
    title?: string;
    description?: string;
  }>({ isOpen: false, temporaryPassword: '', userName: '' });

  // Confirm dialog state
  const [confirmDialog, setConfirmDialog] = useState<{
    isOpen: boolean;
    title: string;
    message: string;
    variant: 'danger' | 'warning' | 'info';
    confirmLabel: string;
    onConfirm: () => void;
  }>({
    isOpen: false,
    title: '',
    message: '',
    variant: 'danger',
    confirmLabel: 'Confirm',
    onConfirm: () => {},
  });

  // Redirect non-admins
  useEffect(() => {
    if (currentUser && currentUser.role !== 'admin') {
      router.push('/dashboard');
    }
  }, [currentUser, router]);

  const loadUsers = useCallback(async () => {
    try {
      const data = await adminApi.getUsers();
      setUsers(data);
    } catch (error) {
      logger.error('Failed to load users:', error);
      toast.error(getErrorMessage(error, t('usersPage.toasts.loadFailed')));
    } finally {
      setIsLoading(false);
    }
  }, [t]);

  useEffect(() => {
    loadUsers();
  }, [loadUsers]);

  useEffect(() => {
    userSettingsApi
      .getSmtpStatus()
      .then((status) => setSmtpConfigured(status.configured))
      .catch(() => setSmtpConfigured(false));
  }, []);

  const handleUserCreated = (result: CreateUserResponse) => {
    loadUsers();
    const userName =
      [result.firstName, result.lastName].filter(Boolean).join(' ') ||
      result.email ||
      'the new user';
    if (result.temporaryPassword) {
      setResetPasswordModal({
        isOpen: true,
        temporaryPassword: result.temporaryPassword,
        userName,
        title: result.upgraded
          ? t('usersPage.dialogs.tempPasswordTitleUpgraded')
          : t('usersPage.dialogs.tempPasswordTitleCreated'),
        description: result.upgraded
          ? t('usersPage.dialogs.tempPasswordDescUpgraded', { name: userName })
          : t('usersPage.dialogs.tempPasswordDescCreated', { name: userName }),
      });
    } else if (result.invited) {
      toast.success(t('usersPage.toasts.inviteSent', { email: result.email ?? '' }));
    } else {
      toast.success(
        result.upgraded
          ? t('usersPage.toasts.userUpgraded', { name: userName })
          : t('usersPage.toasts.userCreated', { name: userName }),
      );
    }
  };

  const handleChangeRole = async (user: AdminUser, role: 'admin' | 'user') => {
    if (role === user.role) return;

    const userName = user.firstName || user.email || 'this user';
    const roleLabel = role === 'admin' ? t('usersPage.toasts.roleAdmin') : t('usersPage.toasts.roleUser');

    setConfirmDialog({
      isOpen: true,
      title: role === 'admin' ? t('usersPage.dialogs.promoteTitle') : t('usersPage.dialogs.demoteTitle'),
      message: role === 'admin'
        ? t('usersPage.dialogs.promoteMessage', { name: userName, role: roleLabel })
        : t('usersPage.dialogs.demoteMessage', { name: userName, role: roleLabel }),
      variant: role === 'admin' ? 'info' : 'warning',
      confirmLabel: role === 'admin' ? t('usersPage.dialogs.promoteConfirm') : t('usersPage.dialogs.demoteConfirm'),
      onConfirm: async () => {
        try {
          const updated = await adminApi.updateUserRole(user.id, role);
          setUsers((prev) => prev.map((u) => (u.id === user.id ? updated : u)));
          toast.success(t('usersPage.toasts.roleChanged', { name: userName, role: roleLabel }));
        } catch (error) {
          toast.error(getErrorMessage(error, t('usersPage.toasts.loadFailed')));
          // Reload to reset the select back to the actual value
          loadUsers();
        }
        setConfirmDialog((prev) => ({ ...prev, isOpen: false }));
      },
    });
  };

  const handleToggleStatus = async (user: AdminUser) => {
    const newStatus = !user.isActive;
    const userName = user.firstName || user.email || 'this user';

    if (!newStatus) {
      // Confirm before disabling
      setConfirmDialog({
        isOpen: true,
        title: t('usersPage.dialogs.disableTitle'),
        message: t('usersPage.dialogs.disableMessage', { name: userName }),
        variant: 'warning',
        confirmLabel: t('usersPage.dialogs.disableConfirm'),
        onConfirm: async () => {
          try {
            const updated = await adminApi.updateUserStatus(user.id, false);
            setUsers((prev) => prev.map((u) => (u.id === user.id ? updated : u)));
            toast.success(t('usersPage.toasts.userDisabled', { name: userName }));
          } catch (error) {
            toast.error(getErrorMessage(error, t('usersPage.toasts.disableFailed')));
          }
          setConfirmDialog((prev) => ({ ...prev, isOpen: false }));
        },
      });
    } else {
      // Enable without confirmation
      try {
        const updated = await adminApi.updateUserStatus(user.id, true);
        setUsers((prev) => prev.map((u) => (u.id === user.id ? updated : u)));
        toast.success(t('usersPage.toasts.userEnabled', { name: userName }));
      } catch (error) {
        toast.error(getErrorMessage(error, t('usersPage.toasts.disableFailed')));
      }
    }
  };

  const handleResetPassword = (user: AdminUser) => {
    const userName = user.firstName || user.email || 'this user';

    setConfirmDialog({
      isOpen: true,
      title: t('usersPage.dialogs.resetTitle'),
      message: t('usersPage.dialogs.resetMessage', { name: userName }),
      variant: 'warning',
      confirmLabel: t('usersPage.dialogs.resetConfirm'),
      onConfirm: async () => {
        try {
          const result = await adminApi.resetUserPassword(user.id);
          setConfirmDialog((prev) => ({ ...prev, isOpen: false }));
          setResetPasswordModal({
            isOpen: true,
            temporaryPassword: result.temporaryPassword,
            userName: userName,
          });
        } catch (error) {
          toast.error(getErrorMessage(error, t('usersPage.toasts.resetFailed')));
          setConfirmDialog((prev) => ({ ...prev, isOpen: false }));
        }
      },
    });
  };

  const handleDeleteUser = (user: AdminUser) => {
    const userName = user.firstName || user.email || 'this user';

    setConfirmDialog({
      isOpen: true,
      title: t('usersPage.dialogs.deleteTitle'),
      message: t('usersPage.dialogs.deleteMessage', { name: userName }),
      variant: 'danger',
      confirmLabel: t('usersPage.dialogs.deleteConfirm'),
      onConfirm: async () => {
        try {
          const res = await adminApi.deleteUser(user.id);
          setUsers((prev) => prev.filter((u) => u.id !== user.id));
          if (res.downgraded) {
            toast.success(t('usersPage.toasts.userDowngraded', { name: userName }));
          } else {
            toast.success(t('usersPage.toasts.userDeleted', { name: userName }));
          }
        } catch (error) {
          toast.error(getErrorMessage(error, t('usersPage.toasts.deleteFailed')));
        }
        setConfirmDialog((prev) => ({ ...prev, isOpen: false }));
      },
    });
  };

  if (currentUser?.role !== 'admin') {
    return null;
  }

  return (
    <ProtectedRoute>
      <PageLayout>
        <main className="px-4 sm:px-6 lg:px-12 pt-6 pb-8">
          <PageHeader
            title={t('usersPage.title')}
            subtitle={t('usersPage.userCount', { count: users.length })}
            actions={
              <Button onClick={() => setCreateModalOpen(true)}>{t('usersPage.newUser')}</Button>
            }
          />

          <div className="bg-white dark:bg-gray-900 shadow rounded-lg overflow-hidden">
          {isLoading ? (
            <LoadingSpinner text={t('usersPage.loadingUsers')} />
          ) : (
            <UserManagementTable
              users={users}
              currentUserId={currentUser.id}
              onChangeRole={handleChangeRole}
              onToggleStatus={handleToggleStatus}
              onResetPassword={handleResetPassword}
              onDeleteUser={handleDeleteUser}
            />
          )}
        </div>
        </main>

        <ConfirmDialog
          isOpen={confirmDialog.isOpen}
          title={confirmDialog.title}
          message={confirmDialog.message}
          variant={confirmDialog.variant}
          confirmLabel={confirmDialog.confirmLabel}
          onConfirm={confirmDialog.onConfirm}
          onCancel={() => setConfirmDialog((prev) => ({ ...prev, isOpen: false }))}
        />

        <ResetPasswordModal
          isOpen={resetPasswordModal.isOpen}
          temporaryPassword={resetPasswordModal.temporaryPassword}
          userName={resetPasswordModal.userName}
          title={resetPasswordModal.title}
          description={resetPasswordModal.description}
          onClose={() => setResetPasswordModal((prev) => ({ ...prev, isOpen: false }))}
        />

        <CreateUserModal
          isOpen={createModalOpen}
          smtpConfigured={smtpConfigured}
          onClose={() => setCreateModalOpen(false)}
          onCreated={handleUserCreated}
        />
      </PageLayout>
    </ProtectedRoute>
  );
}
