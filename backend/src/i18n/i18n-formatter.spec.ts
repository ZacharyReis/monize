import { i18nFormatter } from "./i18n-formatter";

describe("i18nFormatter", () => {
  it("substitutes a single {{ placeholder }} from the args object", () => {
    expect(i18nFormatter("Hi {{ name }},", { name: "Ken" })).toBe("Hi Ken,");
  });

  it("substitutes numeric values via String coercion", () => {
    expect(
      i18nFormatter("Monize: {{ count }} alerts need attention", { count: 3 }),
    ).toBe("Monize: 3 alerts need attention");
  });

  it("substitutes multiple placeholders in one template", () => {
    expect(
      i18nFormatter("{{ greeting }} {{ name }}!", {
        greeting: "Hello",
        name: "Ken",
      }),
    ).toBe("Hello Ken!");
  });

  it("tolerates placeholders with no surrounding whitespace", () => {
    expect(i18nFormatter("Hi {{name}},", { name: "Ken" })).toBe("Hi Ken,");
  });

  it("resolves dotted argument paths", () => {
    expect(
      i18nFormatter("Account {{ account.name }}", {
        account: { name: "Chequing" },
      }),
    ).toBe("Account Chequing");
  });

  it("leaves a placeholder untouched when the arg is missing", () => {
    expect(i18nFormatter("Hi {{ name }},", { count: 1 })).toBe(
      "Hi {{ name }},",
    );
  });

  it("leaves a placeholder untouched when the value is null or undefined", () => {
    expect(i18nFormatter("Hi {{ name }},", { name: null })).toBe(
      "Hi {{ name }},",
    );
    expect(i18nFormatter("Hi {{ name }},", { name: undefined })).toBe(
      "Hi {{ name }},",
    );
  });

  it("returns the template unchanged when it has no placeholders", () => {
    expect(i18nFormatter("Your budget needs attention:", { name: "Ken" })).toBe(
      "Your budget needs attention:",
    );
  });

  it("merges multiple object args (nestjs-i18n passes a merged object)", () => {
    expect(i18nFormatter("{{ a }}-{{ b }}", { a: "1" }, { b: "2" })).toBe(
      "1-2",
    );
  });

  it("ignores non-object formatter args", () => {
    expect(i18nFormatter("Hi {{ name }},", undefined as unknown)).toBe(
      "Hi {{ name }},",
    );
  });
});
