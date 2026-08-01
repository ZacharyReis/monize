/**
 * Triggers a browser download of a Blob via a temporary object URL. The single
 * home for the create-anchor/click/revoke dance, so fixes (e.g. revoke timing
 * quirks) apply everywhere at once.
 */
export function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

/**
 * Extracts the filename from a Content-Disposition header, so downloads keep
 * the exact name the server chose instead of re-deriving the convention
 * client-side. Returns null when the header is missing or unparseable.
 */
export function filenameFromContentDisposition(
  header: string | undefined | null,
): string | null {
  if (!header) return null;
  const match = /filename="([^"]+)"/.exec(header);
  return match ? match[1] : null;
}
