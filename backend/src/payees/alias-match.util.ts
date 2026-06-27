/**
 * Check if a name matches a wildcard alias pattern (case-insensitive).
 * Uses iterative glob matching instead of regex to avoid ReDoS risks.
 *
 * Shared by PayeesService (alias creation/lookup) and PayeeAutoMergeService
 * (pruning redundant aliases and detecting cross-payee overlaps).
 */
export function matchesAliasPattern(
  name: string,
  aliasPattern: string,
): boolean {
  if (aliasPattern.length > 500 || name.length > 500) return false;
  const pattern = aliasPattern.replace(/\*{2,}/g, "*").toLowerCase();
  const text = name.toLowerCase();
  const parts = pattern.split("*");
  // No wildcards: exact match
  if (parts.length === 1) return text === pattern;
  // Check prefix (before first *)
  if (!text.startsWith(parts[0])) return false;
  // Check suffix (after last *)
  if (!text.endsWith(parts[parts.length - 1])) return false;
  // Check inner segments appear in order
  let pos = parts[0].length;
  for (let i = 1; i < parts.length - 1; i++) {
    const idx = text.indexOf(parts[i], pos);
    if (idx === -1) return false;
    pos = idx + parts[i].length;
  }
  // Ensure inner segments don't overlap with the suffix
  if (parts.length > 2) {
    const suffixStart = text.length - parts[parts.length - 1].length;
    if (pos > suffixStart) return false;
  }
  return true;
}
