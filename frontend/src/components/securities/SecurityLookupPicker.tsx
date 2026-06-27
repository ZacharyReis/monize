'use client';

import { useTranslations } from 'next-intl';
import { Modal } from '@/components/ui/Modal';
import { Button } from '@/components/ui/Button';

export interface LookupCandidate {
  symbol: string;
  name: string;
  exchange: string | null;
  securityType: string | null;
  currencyCode: string | null;
  provider?: 'yahoo' | 'msn';
  msnInstrumentId?: string | null;
}

interface SecurityLookupPickerProps {
  isOpen: boolean;
  query: string;
  candidates: LookupCandidate[];
  onPick: (candidate: LookupCandidate) => void;
  onCancel: () => void;
}

function providerBadge(provider: 'yahoo' | 'msn' | undefined) {
  if (!provider) return null;
  const label = provider === 'msn' ? 'MSN' : 'Yahoo';
  const cls =
    provider === 'msn'
      ? 'bg-purple-100 text-purple-700 dark:bg-purple-900 dark:text-purple-300'
      : 'bg-blue-100 text-blue-700 dark:bg-blue-900 dark:text-blue-300';
  return (
    <span className={`inline-flex items-center rounded text-xs font-medium px-2 py-0.5 ${cls}`}>
      {label}
    </span>
  );
}

export function SecurityLookupPicker({
  isOpen,
  query,
  candidates,
  onPick,
  onCancel,
}: SecurityLookupPickerProps) {
  const t = useTranslations('securities');
  const tc = useTranslations('common');
  return (
    <Modal isOpen={isOpen} onClose={onCancel} maxWidth="6xl">
      <div className="p-4 border-b border-gray-200 dark:border-gray-700">
        <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100">
          {t('lookupPicker.title', { query })}
        </h2>
        <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
          {t('lookupPicker.subtitle')}
        </p>
      </div>
      <div className="max-h-[60vh] overflow-y-auto">
        <table className="min-w-full divide-y divide-gray-200 dark:divide-gray-700">
          <thead className="bg-gray-50 dark:bg-gray-800 sticky top-0">
            <tr>
              <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">
                {t('lookupPicker.columns.symbol')}
              </th>
              <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">
                {t('lookupPicker.columns.name')}
              </th>
              <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">
                {t('lookupPicker.columns.exchange')}
              </th>
              <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">
                {t('lookupPicker.columns.currency')}
              </th>
              <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">
                {t('lookupPicker.columns.type')}
              </th>
              <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">
                {t('lookupPicker.columns.source')}
              </th>
              <th className="px-4 py-2" />
            </tr>
          </thead>
          <tbody className="bg-white dark:bg-gray-900 divide-y divide-gray-200 dark:divide-gray-700">
            {candidates.map((c, i) => (
              <tr
                key={`${c.symbol}-${c.exchange || ''}-${c.msnInstrumentId || ''}-${i}`}
                className="hover:bg-gray-50 dark:hover:bg-gray-800 cursor-pointer"
                onClick={() => onPick(c)}
              >
                <td className="px-4 py-2 whitespace-nowrap text-sm font-medium text-gray-900 dark:text-gray-100">
                  {c.symbol}
                </td>
                <td className="px-4 py-2 text-sm text-gray-700 dark:text-gray-300">
                  {c.name}
                </td>
                <td className="px-4 py-2 whitespace-nowrap text-sm text-gray-500 dark:text-gray-400">
                  {c.exchange || '-'}
                </td>
                <td className="px-4 py-2 whitespace-nowrap text-sm text-gray-500 dark:text-gray-400">
                  {c.currencyCode || '-'}
                </td>
                <td className="px-4 py-2 whitespace-nowrap text-sm text-gray-500 dark:text-gray-400">
                  {c.securityType || '-'}
                </td>
                <td className="px-4 py-2 whitespace-nowrap">
                  {providerBadge(c.provider)}
                </td>
                <td className="px-4 py-2 text-right">
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={(e) => {
                      e.stopPropagation();
                      onPick(c);
                    }}
                  >
                    {t('lookupPicker.selectButton')}
                  </Button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="p-4 flex justify-end gap-2 border-t border-gray-200 dark:border-gray-700">
        <Button type="button" variant="ghost" onClick={onCancel}>
          {tc('cancel')}
        </Button>
      </div>
    </Modal>
  );
}
