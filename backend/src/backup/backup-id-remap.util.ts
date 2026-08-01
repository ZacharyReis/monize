/**
 * Shared UUID-remap walker for backup payloads, used by the restore path
 * (BackupService) and the de-identified support export (SupportBackupService).
 * Extracted so the two can't drift: the caveats encoded here -- only genuine
 * row-id UUIDs enter the map (bigint ids share their string form with
 * unrelated values and must never be remapped), and ids embedded inside JSONB
 * values must be rewritten too -- apply to both consumers.
 */

export const UUID_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Canonical UUID string length; cheap pre-filter before the Map lookup. */
const UUID_LENGTH = 36;

/**
 * Adds every row's `id` (when it is a UUID) to the remap with a value from
 * `freshId`. Non-UUID ids (e.g. BIGSERIAL) are skipped -- the database assigns
 * fresh values on insert, and remapping them here would clobber unrelated
 * bigint values sharing the same string form.
 */
export function collectRowIdRemap(
  rows: Iterable<Record<string, unknown>>,
  remap: Map<string, string>,
  freshId: () => string,
): void {
  for (const row of rows) {
    if (!row || typeof row !== "object") continue;
    const id = row.id;
    if (typeof id === "string" && UUID_REGEX.test(id) && !remap.has(id)) {
      remap.set(id, freshId());
    }
  }
}

/**
 * Recursively rewrites any string that matches a remapped id. Recurses into
 * arrays and plain objects (e.g. JSONB columns) so ids nested inside JSON are
 * remapped too. Because the remap only contains genuine backup primary keys
 * (random UUIDs), non-id strings such as names or memos are left untouched;
 * the length pre-check skips the Map lookup for the vast majority of values
 * (dates, labels, enums).
 */
export function deepRemapIds(
  value: unknown,
  remap: Map<string, string>,
): unknown {
  if (typeof value === "string") {
    if (value.length !== UUID_LENGTH) return value;
    return remap.get(value) ?? value;
  }
  if (Array.isArray(value)) {
    return value.map((item) => deepRemapIds(item, remap));
  }
  if (value !== null && typeof value === "object" && !(value instanceof Date)) {
    return Object.fromEntries(
      Object.entries(value).map(([key, val]) => [
        key,
        deepRemapIds(val, remap),
      ]),
    );
  }
  return value;
}
