'use client';

import { useState, useRef, useCallback } from 'react';
import { useTranslations } from 'next-intl';
import { Button } from '@/components/ui/Button';
import { useClickOutside } from '@/hooks/useClickOutside';

interface NewReportButtonProps {
  onNewStandard: () => void;
  onNewInvestment: () => void;
}

const menuItemClass =
  'w-full px-4 py-2 text-left text-sm text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700';

export function NewReportButton({ onNewStandard, onNewInvestment }: NewReportButtonProps) {
  const t = useTranslations('reports');
  const [isOpen, setIsOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);

  const close = useCallback(() => setIsOpen(false), []);

  useClickOutside(dropdownRef, close, {
    enabled: isOpen,
    onEscape: () => {
      close();
      triggerRef.current?.focus();
    },
  });

  const handleStandard = () => {
    close();
    onNewStandard();
  };

  const handleInvestment = () => {
    close();
    onNewInvestment();
  };

  return (
    <div ref={dropdownRef} className="relative block w-full sm:inline-block sm:w-auto">
      <Button
        ref={triggerRef}
        onClick={() => setIsOpen((open) => !open)}
        className="w-full whitespace-nowrap sm:w-auto inline-flex items-center justify-center gap-1.5"
        aria-haspopup="true"
        aria-expanded={isOpen}
      >
        <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
        </svg>
        {t('newReportButton.newReport')}
        <svg className="h-3 w-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
        </svg>
      </Button>

      {isOpen && (
        <div className="absolute right-0 mt-1 w-full sm:w-56 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-md shadow-lg z-50">
          <button onClick={handleStandard} className={`${menuItemClass} rounded-t-md`}>
            {t('newReportButton.standardReport')}
          </button>
          <button onClick={handleInvestment} className={`${menuItemClass} rounded-b-md`}>
            {t('newReportButton.investmentReport')}
          </button>
        </div>
      )}
    </div>
  );
}
