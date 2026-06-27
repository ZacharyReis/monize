'use client';

import { useMemo } from 'react';
import { useTranslations } from 'next-intl';
import { AdminUser } from '@/types/auth';
import { Button } from '@/components/ui/Button';
import { useDateFormat } from '@/hooks/useDateFormat';
import { usePreferencesStore } from '@/store/preferencesStore';
import { formatTime } from '@/lib/utils';

interface UserManagementTableProps {
  users: AdminUser[];
  currentUserId: string;
  onChangeRole: (user: AdminUser, role: 'admin' | 'user') => void;
  onToggleStatus: (user: AdminUser) => void;
  onResetPassword: (user: AdminUser) => void;
  onDeleteUser: (user: AdminUser) => void;
}

export function UserManagementTable({
  users,
  currentUserId,
  onChangeRole,
  onToggleStatus,
  onResetPassword,
  onDeleteUser,
}: UserManagementTableProps) {
  const t = useTranslations('admin');
  const tc = useTranslations('common');
  const { formatDate } = useDateFormat();
  const timeFormat = usePreferencesStore((s) => s.preferences?.timeFormat) || '24h';

  const formatLastLogin = (iso: string): string => {
    const d = new Date(iso);
    const time24 = `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
    return `${formatDate(d)} ${formatTime(time24, timeFormat)}`;
  };

  const sortedUsers = useMemo(() => {
    return [...users].sort((a, b) =>
      new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()
    );
  }, [users]);

  const getUserDisplayName = (user: AdminUser): string => {
    if (user.firstName || user.lastName) {
      return [user.firstName, user.lastName].filter(Boolean).join(' ');
    }
    return user.email || t('userTable.unknown');
  };

  return (
    <div className="overflow-x-auto">
      <table className="min-w-full divide-y divide-gray-200 dark:divide-gray-700">
        <thead className="bg-gray-50 dark:bg-gray-800">
          <tr>
            <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">
              {t('userTable.colUser')}
            </th>
            <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">
              {t('userTable.colRole')}
            </th>
            <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">
              {t('userTable.colProvider')}
            </th>
            <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">
              {t('userTable.colStatus')}
            </th>
            <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">
              {t('userTable.colLastLogin')}
            </th>
            <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider sticky right-0 bg-gray-50 dark:bg-gray-800">
              {t('userTable.colActions')}
            </th>
          </tr>
        </thead>
        <tbody className="bg-white dark:bg-gray-900 divide-y divide-gray-200 dark:divide-gray-700">
          {sortedUsers.map((user) => {
            const isSelf = user.id === currentUserId;
            return (
              <tr key={user.id} className={`group hover:bg-gray-100 dark:hover:bg-gray-800 ${isSelf ? 'bg-blue-50 dark:bg-blue-950' : 'bg-white dark:bg-gray-900'}`}>
                {/* User info */}
                <td className="px-6 py-4 whitespace-nowrap">
                  <div className="text-sm font-medium text-gray-900 dark:text-gray-100">
                    {getUserDisplayName(user)}
                    {isSelf && (
                      <span className="ml-2 text-xs text-blue-600 dark:text-blue-400">{t('userTable.youSuffix')}</span>
                    )}
                  </div>
                  <div className="text-sm text-gray-500 dark:text-gray-400">
                    {user.email || t('userTable.noEmail')}
                  </div>
                </td>

                {/* Role */}
                <td className="px-6 py-4 whitespace-nowrap">
                  {isSelf ? (
                    <RoleBadge role={user.role} adminLabel={t('userTable.roleAdmin')} userLabel={t('userTable.roleUser')} />
                  ) : (
                    <select
                      value={user.role}
                      onChange={(e) => onChangeRole(user, e.target.value as 'admin' | 'user')}
                      className="text-sm rounded-md border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 focus:ring-blue-500 focus:border-blue-500"
                    >
                      <option value="admin">{t('userTable.roleAdmin')}</option>
                      <option value="user">{t('userTable.roleUser')}</option>
                    </select>
                  )}
                </td>

                {/* Provider */}
                <td className="px-6 py-4 whitespace-nowrap">
                  <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${
                    user.authProvider === 'oidc'
                      ? 'bg-purple-100 dark:bg-purple-900 text-purple-800 dark:text-purple-200'
                      : 'bg-gray-100 dark:bg-gray-700 text-gray-800 dark:text-gray-200'
                  }`}>
                    {user.authProvider === 'oidc' ? t('userTable.providerSso') : t('userTable.providerLocal')}
                  </span>
                </td>

                {/* Status */}
                <td className="px-6 py-4 whitespace-nowrap">
                  {isSelf ? (
                    <StatusBadge isActive={user.isActive} activeLabel={t('userTable.statusActive')} disabledLabel={t('userTable.statusDisabled')} />
                  ) : (
                    <button
                      onClick={() => onToggleStatus(user)}
                      className="group flex items-center"
                      title={user.isActive ? t('userTable.clickToDisable') : t('userTable.clickToEnable')}
                    >
                      <StatusBadge isActive={user.isActive} activeLabel={t('userTable.statusActive')} disabledLabel={t('userTable.statusDisabled')} clickable />
                    </button>
                  )}
                </td>

                {/* Last Login */}
                <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500 dark:text-gray-400">
                  {user.lastLogin ? formatLastLogin(user.lastLogin) : t('userTable.never')}
                </td>

                {/* Actions */}
                <td className={`px-6 py-4 whitespace-nowrap text-right text-sm space-x-2 sticky right-0 ${isSelf ? 'bg-blue-50 dark:bg-blue-950' : 'bg-white dark:bg-gray-900'} group-hover:bg-gray-100 dark:group-hover:bg-gray-800`}>
                  {!isSelf && (
                    <>
                      {user.hasPassword && (
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => onResetPassword(user)}
                        >
                          {t('userTable.resetPassword')}
                        </Button>
                      )}
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => onDeleteUser(user)}
                        className="text-red-600 border-red-300 hover:bg-red-50 dark:text-red-400 dark:border-red-700 dark:hover:bg-red-900/50"
                      >
                        {tc('delete')}
                      </Button>
                    </>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>

      {sortedUsers.length === 0 && (
        <div className="text-center py-12 text-gray-500 dark:text-gray-400">
          {t('userTable.noUsers')}
        </div>
      )}
    </div>
  );
}

function RoleBadge({ role, adminLabel, userLabel }: { role: string; adminLabel: string; userLabel: string }) {
  return (
    <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${
      role === 'admin'
        ? 'bg-blue-100 dark:bg-blue-900 text-blue-800 dark:text-blue-200'
        : 'bg-gray-100 dark:bg-gray-700 text-gray-800 dark:text-gray-200'
    }`}>
      {role === 'admin' ? adminLabel : userLabel}
    </span>
  );
}

function StatusBadge({ isActive, activeLabel, disabledLabel, clickable }: { isActive: boolean; activeLabel: string; disabledLabel: string; clickable?: boolean }) {
  return (
    <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${
      isActive
        ? 'bg-green-100 dark:bg-green-900 text-green-800 dark:text-green-200'
        : 'bg-red-100 dark:bg-red-900 text-red-800 dark:text-red-200'
    } ${clickable ? 'cursor-pointer hover:opacity-80' : ''}`}>
      {isActive ? activeLabel : disabledLabel}
    </span>
  );
}
