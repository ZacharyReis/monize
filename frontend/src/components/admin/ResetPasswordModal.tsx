'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { Modal } from '@/components/ui/Modal';
import { Button } from '@/components/ui/Button';
import toast from 'react-hot-toast';

interface ResetPasswordModalProps {
  isOpen: boolean;
  temporaryPassword: string;
  userName: string;
  onClose: () => void;
  /** Heading shown at the top of the modal. */
  title?: string;
  /** Sentence describing what the password is for. */
  description?: string;
}

export function ResetPasswordModal({
  isOpen,
  temporaryPassword,
  userName,
  onClose,
  title,
  description,
}: ResetPasswordModalProps) {
  const t = useTranslations('admin');
  const tc = useTranslations('common');
  const [copied, setCopied] = useState(false);

  const resolvedTitle = title ?? t('resetPasswordModal.defaultTitle');

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(temporaryPassword);
      setCopied(true);
      toast.success(t('resetPasswordModal.toasts.copied'));
      setTimeout(() => setCopied(false), 3000);
    } catch {
      toast.error(t('resetPasswordModal.toasts.copyFailed'));
    }
  };

  return (
    <Modal isOpen={isOpen} onClose={onClose} maxWidth="md" className="p-6">
      <h3 className="text-lg font-medium text-gray-900 dark:text-gray-100 mb-2">
        {resolvedTitle}
      </h3>

      <p className="text-sm text-gray-600 dark:text-gray-400 mb-4">
        {description ?? t('resetPasswordModal.defaultDescription', { userName })}
      </p>

      <div className="bg-gray-50 dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg p-4 mb-4">
        <p className="text-xs text-gray-500 dark:text-gray-400 mb-2">{t('resetPasswordModal.temporaryPasswordLabel')}</p>
        <div className="flex items-center justify-between gap-3">
          <code className="text-xl font-mono font-bold text-gray-900 dark:text-gray-100 select-all">
            {temporaryPassword}
          </code>
          <Button
            variant="outline"
            size="sm"
            onClick={handleCopy}
          >
            {copied ? t('resetPasswordModal.copied') : t('resetPasswordModal.copy')}
          </Button>
        </div>
      </div>

      <div className="space-y-2 mb-6">
        <p className="text-sm text-amber-600 dark:text-amber-400 font-medium">
          {t('resetPasswordModal.notShownAgain')}
        </p>
        <p className="text-sm text-gray-600 dark:text-gray-400">
          {t('resetPasswordModal.mustChangeOnLogin')}
        </p>
      </div>

      <div className="flex justify-end">
        <Button onClick={onClose}>{tc('close')}</Button>
      </div>
    </Modal>
  );
}
