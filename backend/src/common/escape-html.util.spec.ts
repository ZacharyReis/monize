import { escapeHtml } from "./escape-html.util";

describe("escapeHtml", () => {
  it("escapes angle brackets and double quotes", () => {
    const out = escapeHtml(`<script>alert("xss")</script>`);
    // No raw <, >, or " should remain anywhere in the output. Use
    // character-level checks rather than substring patterns so the
    // assertion cannot be misread as an HTML-filtering regex (CodeQL).
    expect(out.includes("<")).toBe(false);
    expect(out.includes(">")).toBe(false);
    expect(out.includes(`"`)).toBe(false);
    expect(out.toLowerCase()).toContain("lt");
    expect(out.toLowerCase()).toContain("gt");
  });

  it("escapes ampersand and single quote", () => {
    const out = escapeHtml("Tom & Jerry's");
    // Original & and ' must be replaced with their entity references
    // (named or numeric); no raw apostrophe should remain.
    expect(out.includes("'")).toBe(false);
    // The ampersand is now part of the entity references themselves, so
    // assert via the entity names rather than a raw-char check.
    expect(out.toLowerCase()).toContain("amp");
    expect(out.toLowerCase()).toContain("apos");
  });

  it("encodes non-ASCII characters", () => {
    const out = escapeHtml("café");
    expect(out).not.toContain("é");
    expect(out).toMatch(/caf(&#xE9;|&eacute;)/);
  });

  it("returns empty string unchanged", () => {
    expect(escapeHtml("")).toBe("");
  });

  it("returns plain ASCII unchanged", () => {
    expect(escapeHtml("hello world")).toBe("hello world");
  });
});
