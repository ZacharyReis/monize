/**
 * Returns the given value only if it is an http(s) URL, otherwise undefined.
 * Use before assigning a stored/user-provided value to an anchor `href` so a
 * `javascript:`/`data:` URI can never reach the DOM.
 */
export function safeHttpUrl(value?: string | null): string | undefined {
  return value && /^https?:\/\//i.test(value) ? value : undefined;
}
