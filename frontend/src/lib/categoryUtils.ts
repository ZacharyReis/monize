import { Category } from '@/types/category';
import type { MultiSelectOption } from '@/components/ui/MultiSelect';

interface CategoryOption {
  value: string;
  label: string;
}

/**
 * Build a hierarchical list of category options with proper indentation
 * for use in Select/Combobox components
 */
export function buildCategoryTree(
  categories: Category[],
  excludeIds: Set<string> = new Set()
): Array<{ category: Category; level: number }> {
  const buildTree = (
    parentId: string | null = null,
    level: number = 0
  ): Array<{ category: Category; level: number }> => {
    return categories
      .filter((c) => c.parentId === parentId && !excludeIds.has(c.id))
      .sort((a, b) => a.name.localeCompare(b.name))
      .flatMap((cat) => [
        { category: cat, level },
        ...buildTree(cat.id, level + 1),
      ]);
  };

  return buildTree();
}

/**
 * Convert categories to hierarchical select options
 */
export function getCategorySelectOptions(
  categories: Category[],
  options?: {
    includeEmpty?: boolean;
    emptyLabel?: string;
    excludeIds?: Set<string>;
    includeUncategorized?: boolean;
    includeTransfers?: boolean;
  }
): CategoryOption[] {
  const {
    includeEmpty = false,
    emptyLabel = 'Uncategorized',
    excludeIds = new Set<string>(),
    includeUncategorized = false,
    includeTransfers = false,
  } = options || {};

  // Build a map for quick parent lookups
  const categoryMap = new Map(categories.map((c) => [c.id, c]));

  // Get full path label for a category (e.g., "Parent: Child")
  const getFullLabel = (category: Category): string => {
    if (category.parentId) {
      const parent = categoryMap.get(category.parentId);
      if (parent) {
        return `${parent.name}: ${category.name}`;
      }
    }
    return category.name;
  };

  const tree = buildCategoryTree(categories, excludeIds);

  const categoryOptions = tree.map(({ category }) => ({
    value: category.id,
    label: getFullLabel(category),
  }));

  const result: CategoryOption[] = [];

  if (includeEmpty) {
    result.push({ value: '', label: emptyLabel });
  }

  if (includeUncategorized) {
    result.push({ value: 'uncategorized', label: 'Uncategorized' });
  }

  if (includeTransfers) {
    result.push({ value: 'transfer', label: 'Transfers' });
  }

  return [...result, ...categoryOptions];
}

/**
 * Build a map of category ID to effective (inherited) color.
 * Used by components that display categories from DB joins
 * (e.g., transaction lists, payee lists) which don't include
 * the computed effectiveColor field.
 */
export function buildCategoryColorMap(
  categories: Category[],
): Map<string, string | null> {
  return new Map(
    categories.map((c) => [c.id, c.effectiveColor ?? c.color]),
  );
}

/**
 * Build a map of category ID to its full hierarchical label
 * ("Parent: Child", or just the name for a top-level category). Useful for
 * surfaces that only hold a transaction's own category row (the list query
 * does not join the parent) but want to show the full path -- e.g. the
 * transaction action sheet.
 */
export function buildCategoryLabelMap(
  categories: Category[],
): Map<string, string> {
  const byId = new Map(categories.map((c) => [c.id, c]));
  return new Map(
    categories.map((c) => {
      const parent = c.parentId ? byId.get(c.parentId) : null;
      return [c.id, parent ? `${parent.name}: ${c.name}` : c.name];
    }),
  );
}

/**
 * The special pseudo-category filter options. Selecting "Uncategorized"
 * matches records with no category (and that are neither transfers nor
 * splits); "Transfers" matches transfer records. Shared by the Transactions
 * and Bills & Deposits filter panels.
 */
export const SPECIAL_CATEGORY_FILTER_OPTIONS: MultiSelectOption[] = [
  { value: 'uncategorized', label: 'Uncategorized' },
  { value: 'transfer', label: 'Transfers' },
];

/**
 * Build the category filter options used by the filter panels: the special
 * pseudo-options followed by the category hierarchy (parents with their
 * children nested), sorted alphabetically at each level. Selecting a parent
 * selects all of its descendants (handled by MultiSelect).
 */
export function buildCategoryFilterOptions(categories: Category[]): MultiSelectOption[] {
  const buildOptions = (parentId: string | null = null): MultiSelectOption[] =>
    categories
      .filter((c) => c.parentId === parentId)
      .sort((a, b) => a.name.localeCompare(b.name))
      .flatMap((cat) => {
        const children = buildOptions(cat.id);
        return [
          {
            value: cat.id,
            label: cat.name,
            parentId: cat.parentId,
            children: children.length > 0 ? children : undefined,
          },
        ];
      });
  return [...SPECIAL_CATEGORY_FILTER_OPTIONS, ...buildOptions()];
}

/**
 * Resolve selected category filter IDs (including the special
 * "uncategorized"/"transfer" pseudo-IDs) to Category-like records for chip
 * display.
 */
export function resolveSelectedCategories(
  categoryIds: string[],
  categories: Category[],
): Category[] {
  return categoryIds
    .map((id) => {
      if (id === 'uncategorized') return { id, name: 'Uncategorized', color: null } as Category;
      if (id === 'transfer') return { id, name: 'Transfers', color: null } as Category;
      return categories.find((c) => c.id === id);
    })
    .filter((c): c is Category => c !== undefined);
}
