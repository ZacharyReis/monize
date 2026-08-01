/**
 * Deterministic i18n keys for the default category catalog.
 *
 * The English names in `default-categories.ts` are the source of truth; these
 * helpers derive the catalog key each name resolves against so
 * `CategoriesService.importDefaults` can seed the rows in the user's own
 * language. Keys are namespaced per parent category so translators see full
 * context and identically spelled subcategories under different parents can
 * diverge where a language needs them to (e.g. "Interest" under Investment
 * Income vs "Loan Interest" under Loan).
 *
 * The keys live under the `categories` namespace (file `locales/en/
 * categories.json`); `default-category-i18n.spec.ts` fails if the derived keys
 * and the catalog ever drift apart.
 */

/**
 * Slugify a category name into a stable camelCase key segment:
 * "Car Payment" -> "carPayment", "US Dollars" -> "usDollars",
 * "Water & Sewer" -> "waterSewer", "CPP/QPP Benefits" -> "cppQppBenefits",
 * "Mother's Day" -> "mothersDay".
 */
export function categoryKeySegment(name: string): string {
  const words = name
    .replace(/['’]/g, "")
    .replace(/[^A-Za-z0-9]+/g, " ")
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  return words
    .map((word, index) =>
      index === 0
        ? word.toLowerCase()
        : word.charAt(0).toUpperCase() + word.slice(1).toLowerCase(),
    )
    .join("");
}

/** Catalog key for a default parent category name. */
export function defaultCategoryNameKey(categoryName: string): string {
  return `categories.defaults.${categoryKeySegment(categoryName)}.name`;
}

/** Catalog key for a default subcategory name, namespaced under its parent. */
export function defaultSubcategoryNameKey(
  categoryName: string,
  subcategoryName: string,
): string {
  return (
    `categories.defaults.${categoryKeySegment(categoryName)}` +
    `.sub.${categoryKeySegment(subcategoryName)}`
  );
}
