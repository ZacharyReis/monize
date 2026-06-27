/**
 * Custom value formatter for nestjs-i18n.
 *
 * nestjs-i18n ships with `string-format` as its default formatter, which uses
 * single-brace `{key}` placeholders and treats `{{ key }}` as an escaped pair of
 * literal braces. Every catalogue in this project uses the `{{ placeholder }}`
 * convention (see `translate.ts` / `email-translator.ts`), so the stock
 * formatter emitted those placeholders verbatim -- e.g. `"Hi {{ name }},"` was
 * rendered as `"Hi { name },"` with the argument never substituted. The bug only
 * surfaced once copy moved out of inline fallbacks and into the catalogues
 * (e.g. `en/emails.json`), at which point the catalogue value started being
 * returned instead of the already-interpolated English fallback.
 *
 * nestjs-i18n only resolves `{{ ... }}` itself when a transform pipe is present
 * (`{{ name | uppercase }}`); plain placeholders fall through to this formatter.
 * This implementation substitutes `{{ key }}` and dotted `{{ a.b }}` paths from
 * the args object, leaving any unmatched placeholder untouched so a missing arg
 * degrades gracefully rather than throwing.
 */
export function i18nFormatter(template: string, ...args: unknown[]): string {
  const data = Object.assign(
    {},
    ...args.filter(
      (arg): arg is Record<string, unknown> =>
        typeof arg === "object" && arg !== null && !Array.isArray(arg),
    ),
  ) as Record<string, unknown>;

  return template.replace(/\{\{\s*([\w.]+)\s*\}\}/g, (match, path: string) => {
    const value = path
      .split(".")
      .reduce<unknown>(
        (acc, key) =>
          acc !== null && acc !== undefined && typeof acc === "object"
            ? (acc as Record<string, unknown>)[key]
            : undefined,
        data,
      );
    return value === undefined || value === null ? match : String(value);
  });
}
