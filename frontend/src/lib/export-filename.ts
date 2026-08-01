/**
 * Turn a human-readable title into a safe download filename stem:
 * lowercase, non-alphanumerics collapsed to single dashes.
 */
export function sanitizeFilename(name: string, fallback: string = 'export'): string {
  const cleaned = name.replace(/[^a-z0-9]+/gi, '-').replace(/^-+|-+$/g, '');
  return cleaned.toLowerCase() || fallback;
}
