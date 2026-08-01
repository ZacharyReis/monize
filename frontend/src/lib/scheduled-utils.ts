import { ScheduledTransaction } from '@/types/scheduled-transaction';

export interface NextScheduledItem {
  date: string;
  amount: number;
  currencyCode: string;
  payeeName: string | null;
}

/**
 * The soonest active scheduled bill/deposit matching `predicate`, honouring
 * a per-occurrence override for both the date and the amount. Shared by the
 * account/payee/category info widgets on the Transactions page.
 */
export function getNextScheduled(
  scheduled: ScheduledTransaction[],
  predicate: (st: ScheduledTransaction) => boolean,
): NextScheduledItem | null {
  const candidates = scheduled
    .filter((st) => st.isActive && predicate(st))
    .map((st) => ({
      date: (st.nextOverride?.overrideDate ?? st.nextDueDate).split('T')[0],
      amount: st.nextOverride?.amount ?? st.amount,
      currencyCode: st.currencyCode,
      payeeName: st.payee?.name ?? st.payeeName ?? null,
    }))
    .sort((a, b) => a.date.localeCompare(b.date));
  return candidates[0] ?? null;
}
