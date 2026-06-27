import { Test, TestingModule } from "@nestjs/testing";
import { I18nService } from "nestjs-i18n";
import { I18nModule } from "./i18n.module";
import { emailTranslator } from "./email-translator";

/**
 * Regression guard for the email/exception placeholder bug: the catalogues use
 * the `{{ name }}` convention, and nestjs-i18n's stock `string-format` formatter
 * rendered those verbatim as `{ name }`. This boots the real I18nModule (with our
 * custom formatter wired in) and asserts a catalogue value is actually
 * interpolated rather than emitted with literal braces.
 */
describe("i18n interpolation (real catalogue)", () => {
  let i18n: I18nService;

  beforeAll(async () => {
    const moduleRef: TestingModule = await Test.createTestingModule({
      imports: [I18nModule],
    }).compile();
    i18n = moduleRef.get<I18nService>(I18nService);
  });

  it("interpolates a {{ name }} placeholder from a catalogue string", () => {
    const t = emailTranslator(i18n, "en");
    const greeting = t(
      "emails.budgetAlertImmediate.greeting",
      "Hi {{ name }},",
      {
        name: "Ken",
      },
    );
    expect(greeting).toBe("Hi Ken,");
    expect(greeting).not.toContain("{");
  });

  it("interpolates a {{ count }} placeholder in an email subject", () => {
    const t = emailTranslator(i18n, "en");
    const subject = t(
      "emails.budgetAlertImmediate.subjectPlural",
      "Monize: {{ count }} alerts need attention",
      { count: 4 },
    );
    expect(subject).toBe("Monize: 4 alerts need attention");
  });
});
