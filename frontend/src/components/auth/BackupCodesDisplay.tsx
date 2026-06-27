'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { Button } from '@/components/ui/Button';

interface BackupCodesDisplayProps {
  codes: string[];
  onDone: () => void;
}

export function BackupCodesDisplay({ codes, onDone }: BackupCodesDisplayProps) {
  const t = useTranslations('auth.backupCodes');
  const [hasCopied, setHasCopied] = useState(false);
  const [hasConfirmed, setHasConfirmed] = useState(false);

  const handleCopy = async () => {
    const text = codes.join('\n');
    await navigator.clipboard.writeText(text);
    setHasCopied(true);
  };

  const handleDownload = () => {
    const text = [
      t('file.title'),
      '========================',
      '',
      t('file.usedOnce'),
      t('file.storeSafe'),
      '',
      ...codes,
    ].join('\n');

    const blob = new Blob([text], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'monize-backup-codes.txt';
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="space-y-4">
      <div className="text-center">
        <h3 className="text-lg font-semibold text-gray-900 dark:text-gray-100">
          {t('title')}
        </h3>
        <p className="mt-1 text-sm text-gray-600 dark:text-gray-400">
          {t('description')}
        </p>
      </div>

      <div className="bg-gray-50 dark:bg-gray-700/50 rounded-lg p-4">
        <div className="grid grid-cols-2 gap-2">
          {codes.map((code) => (
            <div
              key={code}
              className="font-mono text-sm text-center py-1.5 px-2 bg-white dark:bg-gray-800 rounded border border-gray-200 dark:border-gray-600 text-gray-900 dark:text-gray-100"
            >
              {code}
            </div>
          ))}
        </div>
      </div>

      <div className="flex gap-2 justify-center">
        <Button variant="outline" size="sm" onClick={handleCopy}>
          {hasCopied ? t('copied') : t('copy')}
        </Button>
        <Button variant="outline" size="sm" onClick={handleDownload}>
          {t('download')}
        </Button>
      </div>

      <div className="bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 rounded-lg p-3">
        <p className="text-sm text-amber-800 dark:text-amber-300">
          {t('warning')}
        </p>
      </div>

      <label className="flex items-center gap-2 cursor-pointer">
        <input
          type="checkbox"
          checked={hasConfirmed}
          onChange={(e) => setHasConfirmed(e.target.checked)}
          className="h-4 w-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500 dark:border-gray-600 dark:bg-gray-700"
        />
        <span className="text-sm text-gray-600 dark:text-gray-400">
          {t('confirm')}
        </span>
      </label>

      <Button
        variant="primary"
        size="lg"
        onClick={onDone}
        disabled={!hasConfirmed}
        className="w-full"
      >
        {t('done')}
      </Button>
    </div>
  );
}
