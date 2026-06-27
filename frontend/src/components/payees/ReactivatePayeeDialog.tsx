'use client';

import { useTranslations } from 'next-intl';
import { Button } from '@/components/ui/Button';
import { Modal } from '@/components/ui/Modal';
import { Payee } from '@/types/payee';

interface ReactivatePayeeDialogProps {
  isOpen: boolean;
  payee: Payee | null;
  onReactivate: () => void;
  onCancel: () => void;
  isReactivating?: boolean;
}

export function ReactivatePayeeDialog({
  isOpen,
  payee,
  onReactivate,
  onCancel,
  isReactivating = false,
}: ReactivatePayeeDialogProps) {
  const t = useTranslations('payees');

  if (!payee) return null;

  return (
    <Modal isOpen={isOpen} onClose={onCancel} maxWidth="sm" className="p-6">
      <h2 className="text-lg font-bold text-gray-900 dark:text-gray-100 mb-3">
        {t('reactivate.title')}
      </h2>
      <p className="text-sm text-gray-600 dark:text-gray-400 mb-4">
        {t('reactivate.message', { name: payee.name })}
      </p>
      <div className="flex justify-end gap-3">
        <Button variant="secondary" onClick={onCancel} disabled={isReactivating}>
          {t('reactivate.keepInactiveButton')}
        </Button>
        <Button onClick={onReactivate} disabled={isReactivating}>
          {isReactivating ? t('reactivate.reactivating') : t('reactivate.reactivateButton')}
        </Button>
      </div>
    </Modal>
  );
}
