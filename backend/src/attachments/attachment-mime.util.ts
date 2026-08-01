/**
 * Magic-byte MIME sniffing for the narrow set of formats we accept as
 * attachments. We never trust the client-supplied content-type: the stored type
 * is derived from the actual file header here.
 *
 * SVG is deliberately excluded -- it is an XML document that can carry script,
 * so it is not a safe "image" to serve back. Archives are excluded too.
 */

export const ALLOWED_ATTACHMENT_MIME_TYPES: readonly string[] = [
  "image/jpeg",
  "image/png",
  "image/gif",
  "image/webp",
  "application/pdf",
];

/**
 * Inspect the leading bytes of a buffer and return the recognised MIME type, or
 * `null` when the header matches none of the allowed formats.
 */
export function sniffAttachmentMime(buffer: Buffer): string | null {
  if (!buffer || buffer.length < 4) {
    return null;
  }

  // JPEG: FF D8 FF
  if (buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) {
    return "image/jpeg";
  }

  // PNG: 89 50 4E 47 0D 0A 1A 0A
  if (
    buffer.length >= 8 &&
    buffer[0] === 0x89 &&
    buffer[1] === 0x50 &&
    buffer[2] === 0x4e &&
    buffer[3] === 0x47 &&
    buffer[4] === 0x0d &&
    buffer[5] === 0x0a &&
    buffer[6] === 0x1a &&
    buffer[7] === 0x0a
  ) {
    return "image/png";
  }

  // GIF: "GIF87a" or "GIF89a"
  if (
    buffer.length >= 6 &&
    buffer.toString("ascii", 0, 3) === "GIF" &&
    (buffer.toString("ascii", 3, 6) === "87a" ||
      buffer.toString("ascii", 3, 6) === "89a")
  ) {
    return "image/gif";
  }

  // WebP: "RIFF" .... "WEBP"
  if (
    buffer.length >= 12 &&
    buffer.toString("ascii", 0, 4) === "RIFF" &&
    buffer.toString("ascii", 8, 12) === "WEBP"
  ) {
    return "image/webp";
  }

  // PDF: "%PDF-"
  if (buffer.length >= 5 && buffer.toString("ascii", 0, 5) === "%PDF-") {
    return "application/pdf";
  }

  return null;
}
