'use client';

import { useTranslations } from 'next-intl';
import { Account } from '@/types/account';
import { formatAccountType } from '@/lib/account-utils';

interface UploadStepProps {
  preselectedAccount: Account | undefined;
  isLoading: boolean;
  onFileSelect: (e: React.ChangeEvent<HTMLInputElement>) => void;
}

const MS_MONEY_WIKI_URL = 'https://github.com/kenlasko/monize/wiki/Importing-from-Microsoft-Money';
const QUICKEN_WIKI_URL = 'https://github.com/kenlasko/monize/wiki/Importing-from-Quicken';

function wikiLink(href: string) {
  return function WikiLink(chunks: React.ReactNode) {
    return (
      <a
        href={href}
        target="_blank"
        rel="noopener noreferrer"
        className="font-medium underline hover:text-amber-900 dark:hover:text-amber-100"
      >
        {chunks}
      </a>
    );
  };
}

export function UploadStep({ preselectedAccount, isLoading, onFileSelect }: UploadStepProps) {
  const t = useTranslations('import');
  const tc = useTranslations('common');

  return (
    <div className="max-w-xl mx-auto">
      <div className="bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800 rounded-lg p-4 mb-6">
        <div className="flex items-start gap-2">
          <svg
            className="w-5 h-5 text-amber-600 dark:text-amber-400 mt-0.5 shrink-0"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4c-.77-.833-1.964-.833-2.732 0L4.082 16.5c-.77.833.192 2.5 1.732 2.5z"
            />
          </svg>
          <div className="text-sm text-amber-800 dark:text-amber-200">
            <p className="font-semibold">{t('upload.wikiNotice.title')}</p>
            <p className="mt-1">
              {t.rich('upload.wikiNotice.body', {
                money: wikiLink(MS_MONEY_WIKI_URL),
                quicken: wikiLink(QUICKEN_WIKI_URL),
              })}
            </p>
          </div>
        </div>
      </div>
      <div className="bg-white dark:bg-gray-800 rounded-lg shadow p-6">
        <h2 className="text-xl font-semibold text-gray-900 dark:text-gray-100 mb-4">
          {t('upload.heading')}
        </h2>
        {preselectedAccount && (
          <div className="bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 rounded-lg p-4 mb-4">
            <p className="text-sm text-blue-700 dark:text-blue-300">
              {t('upload.importingTo')} <strong>{preselectedAccount.name}</strong> ({formatAccountType(preselectedAccount.accountType, tc)})
            </p>
          </div>
        )}
        <p className="text-gray-600 dark:text-gray-400 mb-6">
          {t('upload.instructions')}
        </p>
        <div className="border-2 border-dashed border-gray-300 dark:border-gray-600 rounded-lg p-8 text-center">
          <input
            type="file"
            accept=".qif,.ofx,.qfx,.csv"
            multiple
            onChange={onFileSelect}
            className="hidden"
            id="import-file"
            disabled={isLoading}
          />
          <label
            htmlFor="import-file"
            className="cursor-pointer inline-flex flex-col items-center"
          >
            <svg
              className="w-12 h-12 text-gray-400 mb-4"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12"
              />
            </svg>
            <span className="text-gray-600 dark:text-gray-400">
              {isLoading ? t('upload.processing') : t('upload.clickToSelect')}
            </span>
            <span className="text-xs text-gray-400 dark:text-gray-500 mt-1">
              {t('upload.acceptedFormats')}
            </span>
          </label>
        </div>
      </div>
    </div>
  );
}
