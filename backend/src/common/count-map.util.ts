/**
 * Build a `Map<key, number>` from raw SQL aggregate rows. Removes the
 * boilerplate of looping rows and `parseInt`-ing the count column when
 * joining `COUNT(...) GROUP BY <id>` results back onto an entity list.
 *
 * - `keyField` and `countField` default to `"id"` and `"count"` to match
 *   the most common raw-query shape (`SELECT id, COUNT(*) AS count`).
 * - Missing/null counts coerce to 0.
 * - If the same key appears in multiple rows (e.g. combining results
 *   from a direct-transaction query and a split query), pass an existing
 *   map as the third argument to accumulate counts across passes.
 */
export function toCountMap<T extends Record<string, unknown>>(
  rows: T[],
  options: {
    keyField?: keyof T;
    countField?: keyof T;
    into?: Map<string, number>;
  } = {},
): Map<string, number> {
  const keyField = (options.keyField ?? ("id" as keyof T)) as keyof T;
  const countField = (options.countField ?? ("count" as keyof T)) as keyof T;
  const map = options.into ?? new Map<string, number>();
  for (const row of rows) {
    const key = row[keyField] as unknown as string | null | undefined;
    if (key == null) continue;
    const raw = row[countField] as unknown as
      | string
      | number
      | null
      | undefined;
    const value =
      typeof raw === "number"
        ? raw
        : parseInt((raw as string | null) ?? "0", 10) || 0;
    map.set(key, (map.get(key) ?? 0) + value);
  }
  return map;
}
