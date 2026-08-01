'use client';

import { useState } from 'react';

interface ExportIconButtonProps {
  /** Runs the export; async exports show a spinner until they settle. */
  onExport: () => void | Promise<void>;
  /** Tooltip / accessible label, e.g. "Download Loan Schedule as CSV". */
  title: string;
  disabled?: boolean;
}

/**
 * Compact icon-only export trigger for a chart or table card header. Uses the
 * same download icon as ChartDownloadButton (e.g. the Account Balances chart)
 * so every export affordance reads the same across the app.
 */
export function ExportIconButton({ onExport, title, disabled }: ExportIconButtonProps) {
  const [isExporting, setIsExporting] = useState(false);

  async function handleClick() {
    if (isExporting) return;
    setIsExporting(true);
    try {
      await onExport();
    } finally {
      setIsExporting(false);
    }
  }

  return (
    <button
      type="button"
      onClick={handleClick}
      disabled={disabled || isExporting}
      className="p-1 rounded text-gray-500 hover:text-gray-700 hover:bg-gray-100 dark:text-gray-400 dark:hover:text-gray-200 dark:hover:bg-gray-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
      title={title}
      aria-label={title}
    >
      {isExporting ? (
        <svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24">
          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
        </svg>
      ) : (
        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={2}
            d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4"
          />
        </svg>
      )}
    </button>
  );
}
