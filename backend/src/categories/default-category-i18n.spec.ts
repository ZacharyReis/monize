import { readFileSync } from "fs";
import { join } from "path";
import { allDefaultCategoryDefinitions } from "./country-category-additions";
import {
  categoryKeySegment,
  defaultCategoryNameKey,
  defaultSubcategoryNameKey,
} from "./default-category-i18n";

type Json = { [k: string]: Json } | string;

const catalog = JSON.parse(
  readFileSync(join(__dirname, "../i18n/locales/en/categories.json"), "utf8"),
) as {
  defaults: Record<string, { name: string; sub: Record<string, string> }>;
};

// Every name that any country's default import can create -- the generic
// baseline plus each country overlay.
const ALL_CATEGORIES = allDefaultCategoryDefinitions();

/** Union of the subcategories each parent name can have across countries. */
const SUBS_BY_PARENT = ALL_CATEGORIES.reduce<Map<string, Set<string>>>(
  (acc, cat) => {
    const subs = acc.get(cat.name) ?? new Set<string>();
    cat.subcategories.forEach((s) => subs.add(s));
    return new Map(acc).set(cat.name, subs);
  },
  new Map(),
);

function resolve(obj: Json, dotKey: string): string | undefined {
  // Keys are produced as `categories.defaults.<parent>...`; the `categories`
  // prefix is the filename namespace, so drop it before walking the object.
  const parts = dotKey.replace(/^categories\./, "").split(".");
  let node: Json = obj;
  for (const part of parts) {
    if (typeof node !== "object" || !(part in node)) return undefined;
    node = node[part];
  }
  return typeof node === "string" ? node : undefined;
}

describe("categoryKeySegment", () => {
  it.each([
    ["Car Payment", "carPayment"],
    ["Water & Sewer", "waterSewer"],
    ["CPP/QPP Benefits", "cppQppBenefits"],
    ["GST/HST Credit", "gstHstCredit"],
    ["Licences & Permits", "licencesPermits"],
    ["401(k) Withdrawal", "401KWithdrawal"],
    ["Mother's Day", "mothersDay"],
    ["ATM", "atm"],
  ])("slugs %s -> %s", (input, expected) => {
    expect(categoryKeySegment(input)).toBe(expected);
  });
});

describe("default category catalog parity", () => {
  it("resolves every default parent name to the English catalog", () => {
    for (const cat of ALL_CATEGORIES) {
      const key = defaultCategoryNameKey(cat.name);
      expect(resolve(catalog, key)).toBe(cat.name);
    }
  });

  it("resolves every default subcategory name to the English catalog", () => {
    for (const cat of ALL_CATEGORIES) {
      for (const subName of cat.subcategories) {
        const key = defaultSubcategoryNameKey(cat.name, subName);
        expect(resolve(catalog, key)).toBe(subName);
      }
    }
  });

  it("has no catalog entries without a matching default category", () => {
    const expectedParentSlugs = new Set(
      ALL_CATEGORIES.map((c) => categoryKeySegment(c.name)),
    );
    for (const parentSlug of Object.keys(catalog.defaults)) {
      expect(expectedParentSlugs.has(parentSlug)).toBe(true);
    }

    for (const [parentName, subs] of SUBS_BY_PARENT) {
      const parentSlug = categoryKeySegment(parentName);
      const expectedSubSlugs = new Set(
        Array.from(subs).map((s) => categoryKeySegment(s)),
      );
      const catalogSubSlugs = Object.keys(catalog.defaults[parentSlug].sub);
      expect(catalogSubSlugs.length).toBe(expectedSubSlugs.size);
      for (const slug of catalogSubSlugs) {
        expect(expectedSubSlugs.has(slug)).toBe(true);
      }
    }
  });

  it("derives collision-free parent slugs", () => {
    const names = Array.from(SUBS_BY_PARENT.keys());
    const slugs = names.map((n) => categoryKeySegment(n));
    expect(new Set(slugs).size).toBe(slugs.length);
  });

  it("derives collision-free subcategory slugs within each parent", () => {
    for (const subs of SUBS_BY_PARENT.values()) {
      const slugs = Array.from(subs).map((s) => categoryKeySegment(s));
      expect(new Set(slugs).size).toBe(slugs.length);
    }
  });
});
