import { useEffect, useState } from 'react';

/**
 * Returns a debounced copy of `value` that only updates after `value` has
 * stopped changing for `delayMs`. Useful for keeping an expensive derivation
 * (filter + sort, network search) off the critical path of every keystroke
 * while the bound input itself stays fully controlled and responsive.
 *
 * The update happens in a `setTimeout` callback (not synchronously during
 * render), so it does not trip the `react-hooks/set-state-in-effect` rule.
 */
export function useDebouncedValue<T>(value: T, delayMs = 200): T {
  const [debounced, setDebounced] = useState<T>(value);

  useEffect(() => {
    const handle = setTimeout(() => setDebounced(value), delayMs);
    return () => clearTimeout(handle);
  }, [value, delayMs]);

  return debounced;
}
