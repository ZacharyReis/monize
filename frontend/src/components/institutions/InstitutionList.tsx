'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import toast from 'react-hot-toast';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { Institution } from '@/types/institution';
import { institutionsApi } from '@/lib/institutions';
import { getErrorMessage } from '@/lib/errors';
import { createLogger } from '@/lib/logger';
import { useTableDensity, nextDensity, DensityLevel } from '@/hooks/useTableDensity';
import { SortIcon } from '@/components/ui/SortIcon';
import { safeHttpUrl } from '@/lib/safe-url';
import { InstitutionLogo } from './InstitutionLogo';
import { useLongPress } from '@/hooks/useLongPress';
import { RowActions } from '@/components/ui/row-actions/RowActions';
import { RowActionSheet } from '@/components/ui/row-actions/RowActionSheet';
import type { RowAction } from '@/components/ui/row-actions/rowAction';

const logger = createLogger('InstitutionList');

/**
 * Builds the standard row actions for an institution. Shared by the desktop
 * `RowActions` cell and the mobile `RowActionSheet`.
 */
function buildInstitutionActions(
  institution: Institution,
  labels: { edit: string; delete: string },
  handlers: { onEdit: (institution: Institution) => void; onDeleteClick: (institution: Institution) => void },
): RowAction[] {
  return [
    { key: 'edit', label: labels.edit, icon: 'edit', tone: 'primary', onClick: () => handlers.onEdit(institution) },
    { key: 'delete', label: labels.delete, icon: 'delete', tone: 'delete', destructive: true, onClick: () => handlers.onDeleteClick(institution) },
  ];
}

export type InstitutionSortField = 'name' | 'website' | 'country' | 'accounts';

interface InstitutionListProps {
  institutions: Institution[];
  onEdit: (institution: Institution) => void;
  onDelete: (id: string) => void;
  onManageAccounts: (institution: Institution) => void;
  density?: DensityLevel;
  onDensityChange?: (density: DensityLevel) => void;
  sortField?: InstitutionSortField;
  sortDirection?: 'asc' | 'desc';
  onSort?: (field: InstitutionSortField) => void;
}

export function InstitutionList({
  institutions,
  onEdit,
  onDelete,
  onManageAccounts,
  density = 'normal',
  onDensityChange,
  sortField = 'name',
  sortDirection = 'asc',
  onSort,
}: InstitutionListProps) {
  const t = useTranslations('institutions');
  const tc = useTranslations('common');
  const { cellPadding, headerPadding } = useTableDensity(density);
  const [toDelete, setToDelete] = useState<Institution | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);
  const [contextInstitution, setContextInstitution] = useState<Institution | null>(null);

  const { getRowHandlers } = useLongPress<Institution>({
    onLongPress: setContextInstitution,
  });

  const handleDeleteConfirm = async () => {
    if (!toDelete) return;
    setIsDeleting(true);
    try {
      await institutionsApi.delete(toDelete.id);
      toast.success(t('list.deleted', { name: toDelete.name }));
      onDelete(toDelete.id);
      setToDelete(null);
    } catch (error) {
      toast.error(getErrorMessage(error, t('list.deleteFailed')));
      logger.error(error);
    } finally {
      setIsDeleting(false);
    }
  };

  if (institutions.length === 0) {
    return (
      <div className="text-center py-12">
        <p className="text-gray-500 dark:text-gray-400">{t('list.empty')}</p>
      </div>
    );
  }

  return (
    <div>
      {onDensityChange && (
        <div className="flex justify-end p-2 border-b border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800">
          <button
            onClick={() => onDensityChange(nextDensity(density))}
            className="inline-flex items-center px-2 py-1 text-xs font-medium text-gray-600 dark:text-gray-300 hover:text-gray-900 dark:hover:text-gray-100 hover:bg-gray-100 dark:hover:bg-gray-700 rounded"
            title={t('list.density.title')}
          >
            <svg className="w-4 h-4 mr-1" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
            </svg>
            {density === 'normal'
              ? t('list.density.normal')
              : density === 'compact'
                ? t('list.density.compact')
                : t('list.density.dense')}
          </button>
        </div>
      )}
      <div className="overflow-x-auto">
        <table className="min-w-full divide-y divide-gray-200 dark:divide-gray-700">
        <thead className="bg-gray-50 dark:bg-gray-800">
          <tr>
            <th
              className={`${headerPadding} text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider ${onSort ? 'cursor-pointer hover:text-gray-700 dark:hover:text-gray-200 select-none' : ''}`}
              onClick={onSort ? () => onSort('name') : undefined}
            >
              {t('list.columns.name')}
              {onSort && <SortIcon field="name" sortField={sortField} sortDirection={sortDirection} />}
            </th>
            <th
              className={`${headerPadding} text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider hidden md:table-cell ${onSort ? 'cursor-pointer hover:text-gray-700 dark:hover:text-gray-200 select-none' : ''}`}
              onClick={onSort ? () => onSort('website') : undefined}
            >
              {t('list.columns.website')}
              {onSort && <SortIcon field="website" sortField={sortField} sortDirection={sortDirection} />}
            </th>
            <th
              className={`${headerPadding} text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider hidden sm:table-cell ${onSort ? 'cursor-pointer hover:text-gray-700 dark:hover:text-gray-200 select-none' : ''}`}
              onClick={onSort ? () => onSort('country') : undefined}
            >
              {t('list.columns.country')}
              {onSort && <SortIcon field="country" sortField={sortField} sortDirection={sortDirection} />}
            </th>
            <th
              className={`${headerPadding} text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider ${onSort ? 'cursor-pointer hover:text-gray-700 dark:hover:text-gray-200 select-none' : ''}`}
              onClick={onSort ? () => onSort('accounts') : undefined}
            >
              {t('list.columns.accounts')}
              {onSort && <SortIcon field="accounts" sortField={sortField} sortDirection={sortDirection} />}
            </th>
            <th className={`${headerPadding} text-right text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider hidden min-[480px]:table-cell`}>
              {t('list.columns.actions')}
            </th>
          </tr>
        </thead>
        <tbody className="bg-white dark:bg-gray-900 divide-y divide-gray-200 dark:divide-gray-700">
          {institutions.map((institution) => (
            <tr
              key={institution.id}
              className="hover:bg-gray-50 dark:hover:bg-gray-800 select-none"
              {...getRowHandlers(institution)}
            >
              <td className={cellPadding}>
                <div className="flex items-center gap-3 min-w-0">
                  <InstitutionLogo institution={institution} size={24} fallbackGlyph="$" />
                  <span className="text-sm font-medium text-gray-900 dark:text-gray-100 truncate">
                    {institution.name}
                  </span>
                </div>
              </td>
              <td className={`${cellPadding} hidden md:table-cell max-w-[16rem]`}>
                {safeHttpUrl(institution.website) ? (
                  <a
                    href={safeHttpUrl(institution.website)}
                    target="_blank"
                    rel="noopener noreferrer"
                    onClick={(e) => e.stopPropagation()}
                    className="text-sm text-blue-600 dark:text-blue-400 hover:underline truncate inline-block max-w-full"
                  >
                    {institution.website}
                  </a>
                ) : (
                  <span className="text-sm text-gray-500 dark:text-gray-400 truncate inline-block max-w-full">
                    {institution.website}
                  </span>
                )}
              </td>
              <td className={`${cellPadding} hidden sm:table-cell text-sm text-gray-500 dark:text-gray-400`}>
                {institution.country || '—'}
              </td>
              <td className={cellPadding}>
                <button
                  onClick={() => onManageAccounts(institution)}
                  aria-label={t('list.accountCount', { count: institution.accountCount })}
                  title={t('list.actions.manageAccounts')}
                  className="text-sm text-blue-600 dark:text-blue-400 hover:underline"
                >
                  {institution.accountCount}
                </button>
              </td>
              <td className={`${cellPadding} text-right whitespace-nowrap hidden min-[480px]:table-cell`} onClick={(e) => e.stopPropagation()}>
                <RowActions
                  actions={buildInstitutionActions(
                    institution,
                    { edit: tc('actions.edit'), delete: tc('actions.delete') },
                    { onEdit, onDeleteClick: setToDelete },
                  )}
                  density={density}
                />
              </td>
            </tr>
          ))}
          </tbody>
        </table>
      </div>

      <ConfirmDialog
        isOpen={toDelete !== null}
        title={t('list.deleteTitle')}
        message={
          toDelete ? t('list.deleteMessage', { name: toDelete.name }) : ''
        }
        confirmLabel={
          isDeleting ? t('list.deleting') : tc('delete')
        }
        cancelLabel={tc('cancel')}
        variant="danger"
        onConfirm={handleDeleteConfirm}
        onCancel={() => setToDelete(null)}
      />

      <RowActionSheet
        isOpen={contextInstitution !== null}
        title={contextInstitution?.name ?? ''}
        subtitle={contextInstitution?.country ?? undefined}
        actions={contextInstitution
          ? buildInstitutionActions(
              contextInstitution,
              { edit: tc('actions.edit'), delete: tc('actions.delete') },
              { onEdit, onDeleteClick: setToDelete },
            )
          : []}
        onClose={() => setContextInstitution(null)}
      />
    </div>
  );
}
