import {
  COUNTRY_CATEGORY_ADDITIONS,
  DEFAULT_CATEGORY_COUNTRY_CODES,
  allDefaultCategoryDefinitions,
  getDefaultCategories,
  isDefaultCategoryCountry,
} from "./country-category-additions";
import {
  DEFAULT_EXPENSE_CATEGORIES,
  DEFAULT_INCOME_CATEGORIES,
  DefaultCategorySet,
  GENERIC_CATEGORY_SET,
} from "./default-categories";

const findExpense = (set: DefaultCategorySet, name: string) =>
  set.expense.find((c) => c.name === name);

describe("isDefaultCategoryCountry", () => {
  it.each(DEFAULT_CATEGORY_COUNTRY_CODES)("accepts %s", (code) => {
    expect(isDefaultCategoryCountry(code)).toBe(true);
  });

  it.each([["ca"], ["FR"], [""], ["  "]])("rejects %s", (code) => {
    expect(isDefaultCategoryCountry(code)).toBe(false);
  });

  it("rejects null and undefined", () => {
    expect(isDefaultCategoryCountry(null)).toBe(false);
    expect(isDefaultCategoryCountry(undefined)).toBe(false);
  });
});

describe("getDefaultCategories", () => {
  it("returns the generic set when no country is given", () => {
    expect(getDefaultCategories()).toBe(GENERIC_CATEGORY_SET);
    expect(getDefaultCategories(null)).toBe(GENERIC_CATEGORY_SET);
    expect(getDefaultCategories("")).toBe(GENERIC_CATEGORY_SET);
  });

  it("returns the generic set for an unsupported country", () => {
    expect(getDefaultCategories("FR")).toBe(GENERIC_CATEGORY_SET);
  });

  it("never mutates the baseline", () => {
    const incomeBefore = JSON.stringify(DEFAULT_INCOME_CATEGORIES);
    const expenseBefore = JSON.stringify(DEFAULT_EXPENSE_CATEGORIES);

    for (const code of DEFAULT_CATEGORY_COUNTRY_CODES) {
      getDefaultCategories(code);
    }

    expect(JSON.stringify(DEFAULT_INCOME_CATEGORIES)).toBe(incomeBefore);
    expect(JSON.stringify(DEFAULT_EXPENSE_CATEGORIES)).toBe(expenseBefore);
  });

  it.each(DEFAULT_CATEGORY_COUNTRY_CODES)(
    "%s keeps every baseline parent and stays sorted",
    (code) => {
      const set = getDefaultCategories(code);

      for (const branch of ["income", "expense"] as const) {
        const names = set[branch].map((c) => c.name);
        for (const base of GENERIC_CATEGORY_SET[branch]) {
          expect(names).toContain(base.name);
        }
        expect(names).toEqual([...names].sort((a, b) => a.localeCompare(b)));
        for (const category of set[branch]) {
          expect(category.subcategories).toEqual(
            [...category.subcategories].sort((a, b) => a.localeCompare(b)),
          );
          expect(new Set(category.subcategories).size).toBe(
            category.subcategories.length,
          );
        }
      }
    },
  );

  it("adds Canadian tax and benefit lines and drops the generic ones", () => {
    const set = getDefaultCategories("CA");
    const taxes = findExpense(set, "Taxes")!;

    expect(taxes.subcategories).toContain("CPP/QPP Contributions");
    expect(taxes.subcategories).toContain("EI Premiums");
    expect(taxes.subcategories).toContain("GST/HST");
    expect(taxes.subcategories).toContain("Provincial Income Tax");
    expect(taxes.subcategories).not.toContain("Income Tax");
    expect(taxes.subcategories).not.toContain("Sales Tax");

    const retirement = set.income.find((c) => c.name === "Retirement Income")!;
    expect(retirement.subcategories).toContain("CPP/QPP Benefits");
    expect(retirement.subcategories).toContain("RRSP Withdrawal");
  });

  it("adds UK tax, motoring, and licence lines", () => {
    const set = getDefaultCategories("GB");

    expect(findExpense(set, "Taxes")!.subcategories).toEqual(
      expect.arrayContaining(["Council Tax", "National Insurance", "VAT"]),
    );
    expect(findExpense(set, "Taxes")!.subcategories).not.toContain("Sales Tax");
    expect(findExpense(set, "Automobile")!.subcategories).toEqual(
      expect.arrayContaining(["Congestion Charge", "MOT", "Road Tax"]),
    );
    expect(findExpense(set, "Bills")!.subcategories).toContain("TV Licence");
    expect(
      set.income.find((c) => c.name === "Retirement Income")!.subcategories,
    ).toContain("State Pension");
  });

  it("adds US federal, state, and payroll tax lines", () => {
    const set = getDefaultCategories("US");
    const taxes = findExpense(set, "Taxes")!;

    expect(taxes.subcategories).toEqual(
      expect.arrayContaining([
        "Federal Income Tax",
        "Local Income Tax",
        "Medicare Tax",
        "Social Security Tax",
        "State Income Tax",
      ]),
    );
    expect(taxes.subcategories).not.toContain("Income Tax");
    // Sales tax is a real US line, so it survives the overlay.
    expect(taxes.subcategories).toContain("Sales Tax");

    expect(findExpense(set, "Loan")!.subcategories).toContain(
      "Student Loan Interest",
    );
    expect(
      set.income.find((c) => c.name === "Retirement Income")!.subcategories,
    ).toContain("Social Security Benefits");
  });

  it("only references parents that exist in the baseline or add new ones", () => {
    for (const code of DEFAULT_CATEGORY_COUNTRY_CODES) {
      const additions = COUNTRY_CATEGORY_ADDITIONS[code];
      for (const branch of ["income", "expense"] as const) {
        for (const addition of additions[branch] ?? []) {
          const base = GENERIC_CATEGORY_SET[branch].find(
            (c) => c.name === addition.name,
          );
          // A removal only makes sense against a baseline subcategory.
          for (const removed of addition.removeSubcategories ?? []) {
            expect(base).toBeDefined();
            expect(base!.subcategories).toContain(removed);
          }
          expect((addition.subcategories ?? []).length).toBeGreaterThan(0);
        }
      }
    }
  });
});

describe("allDefaultCategoryDefinitions", () => {
  it("covers the generic set and every country overlay", () => {
    const all = allDefaultCategoryDefinitions();
    const names = new Set(all.map((c) => c.name));

    for (const category of [
      ...GENERIC_CATEGORY_SET.income,
      ...GENERIC_CATEGORY_SET.expense,
    ]) {
      expect(names.has(category.name)).toBe(true);
    }

    const allSubs = new Set(all.flatMap((c) => c.subcategories));
    expect(allSubs.has("CPP/QPP Benefits")).toBe(true);
    expect(allSubs.has("Council Tax")).toBe(true);
    expect(allSubs.has("Social Security Tax")).toBe(true);
  });
});
