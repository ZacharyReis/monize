'use client';

interface RateCellProps {
  annualRate: number | null;
  /**
   * When provided, the rate value becomes a button that opens the rate-change
   * form (pre-filled with this row's date and rate). Omitted -> read-only text.
   */
  onEdit?: () => void;
  editLabel: string;
}

/**
 * A schedule-row rate: read-only text, or (when `onEdit` is supplied) a button
 * whose click opens the "Add rate change" form pre-filled with the row's date
 * and this rate, so a rate change can be recorded straight from the schedule.
 */
export function RateCell({ annualRate, onEdit, editLabel }: RateCellProps) {
  const display = annualRate != null ? `${annualRate.toFixed(2)}%` : '—';

  if (!onEdit) {
    return <span className="text-gray-500 dark:text-gray-400">{display}</span>;
  }

  return (
    <button
      type="button"
      aria-label={editLabel}
      onClick={onEdit}
      className="text-gray-700 dark:text-gray-300 hover:text-blue-600 dark:hover:text-blue-400 underline decoration-dotted underline-offset-2"
    >
      {display}
    </button>
  );
}
