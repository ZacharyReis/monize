import { encode } from "he";

/**
 * Escape user-controlled values for safe interpolation into HTML contexts.
 *
 * Uses `he.encode` with default options, which encodes ", ', <, >, & and any
 * non-ASCII characters as numeric character references — equivalent to or
 * stricter than the OWASP HTML-context escape set. Use this anywhere HTML is
 * being assembled with untrusted input (email templates, consent pages, etc.)
 * instead of hand-rolled regex escapers so static analysers don't flag manual
 * sanitization (CWE-79).
 */
export function escapeHtml(value: string): string {
  return encode(value, { useNamedReferences: true });
}
