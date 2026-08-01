/**
 * Characters that could be interpreted as markup (or as line terminators by a
 * JavaScript parser) if an SSE body were ever read in a context other than the
 * `text/event-stream` one it is served as.
 *
 * The double quote is deliberately absent: JSON uses it structurally to delimit
 * strings and keys, so escaping it would produce a body that `JSON.parse`
 * rejects. Quotes inside string values are already escaped by `JSON.stringify`.
 */
const UNSAFE_CHARS = /[<>&'\u2028\u2029]/g;

const toJsonUnicodeEscape = (char: string): string =>
  `\\u${char.charCodeAt(0).toString(16).padStart(4, "0")}`;

/**
 * Serialize a value as an SSE `data:` frame with markup characters neutralized.
 *
 * Streaming endpoints echo user-controlled text back to the browser: the
 * prompt itself, attachment filenames, tool output derived from user records.
 * The response is served as `text/event-stream` with `X-Content-Type-Options:
 * nosniff`, so a browser will not parse it as HTML — but nothing in the payload
 * needs raw `<`, `>`, `&` or `'` either, so they are replaced with their JSON
 * `\uXXXX` escapes before the bytes reach the socket. That leaves no markup in
 * the response body for a sniffing, mistyped, or downstream-proxied context to
 * act on (CWE-79).
 *
 * The escapes are ordinary JSON, so `JSON.parse` on the client yields exactly
 * the original string and consumers need no matching decode step. U+2028 and
 * U+2029 are escaped for the same reason: they are valid in JSON strings but
 * are line terminators to a JavaScript parser.
 */
export function sseData(event: unknown): string {
  // JSON.stringify returns undefined for undefined/function inputs; emit a
  // literal null so the frame stays parseable.
  const json = (JSON.stringify(event) ?? "null").replace(
    UNSAFE_CHARS,
    toJsonUnicodeEscape,
  );
  return `data: ${json}\n\n`;
}

/**
 * SSE response headers, including `nosniff` so a browser cannot be talked into
 * treating the stream as HTML.
 */
export const SSE_HEADERS: Readonly<Record<string, string>> = Object.freeze({
  "Content-Type": "text/event-stream",
  "Cache-Control": "no-cache",
  Connection: "keep-alive",
  "X-Content-Type-Options": "nosniff",
  // Tell nginx not to buffer the stream.
  "X-Accel-Buffering": "no",
});
