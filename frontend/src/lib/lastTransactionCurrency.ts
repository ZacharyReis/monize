/**
 * Remembers the entry currency a user last used when creating a transaction, so
 * the next new-transaction form pre-selects the same currency instead of
 * defaulting to the account currency. Useful when entering a batch of
 * transactions all paid in the same foreign currency while travelling.
 *
 * The value is held in sessionStorage and expires after one hour, mirroring the
 * remembered-date behaviour in `lastTransactionDate.ts`. An empty string means
 * "use the account currency" (which clears the stickiness).
 */
export const LAST_TRANSACTION_CURRENCY_KEY = 'monize-last-transaction-currency';

// How long a remembered currency stays valid before falling back to the account
// currency.
const REMEMBER_DURATION_MS = 60 * 60 * 1000; // 1 hour

/**
 * Return the remembered entry currency code if it was saved within the last
 * hour; otherwise an empty string (meaning "use the account currency").
 * Expired or unparseable entries are cleaned up as a side effect.
 */
export function getRememberedTransactionCurrency(): string {
  if (typeof window === 'undefined') return '';
  const stored = sessionStorage.getItem(LAST_TRANSACTION_CURRENCY_KEY);
  if (stored) {
    try {
      const { value, savedAt } = JSON.parse(stored);
      if (Date.now() - savedAt < REMEMBER_DURATION_MS) {
        return typeof value === 'string' ? value : '';
      }
    } catch {
      // Legacy or malformed value, ignore
    }
    sessionStorage.removeItem(LAST_TRANSACTION_CURRENCY_KEY);
  }
  return '';
}

/**
 * Remember `code` so the next new-transaction form pre-selects it. Pass an empty
 * string when the account currency was used, which clears the stickiness. Call
 * this only after successfully creating a transaction (not when editing).
 */
export function rememberTransactionCurrency(code: string): void {
  if (typeof window === 'undefined') return;
  if (!code) {
    sessionStorage.removeItem(LAST_TRANSACTION_CURRENCY_KEY);
    return;
  }
  sessionStorage.setItem(
    LAST_TRANSACTION_CURRENCY_KEY,
    JSON.stringify({ value: code, savedAt: Date.now() }),
  );
}
