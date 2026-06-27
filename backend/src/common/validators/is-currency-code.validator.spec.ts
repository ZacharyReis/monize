import { validate } from "class-validator";
import { IsCurrencyCode } from "./is-currency-code.validator";

class TestDto {
  @IsCurrencyCode()
  code!: string;
}

async function validateCode(code: unknown): Promise<string[]> {
  const dto = new TestDto();
  (dto as { code: unknown }).code = code;
  const errors = await validate(dto);
  return errors.flatMap((e) => Object.values(e.constraints ?? {}));
}

describe("IsCurrencyCode", () => {
  it("accepts a valid 3-letter uppercase code", async () => {
    expect(await validateCode("USD")).toEqual([]);
    expect(await validateCode("CAD")).toEqual([]);
    expect(await validateCode("EUR")).toEqual([]);
  });

  it("rejects lowercase letters", async () => {
    const errors = await validateCode("usd");
    expect(errors.length).toBeGreaterThan(0);
    expect(errors[0]).toContain("uppercase letters");
  });

  it("rejects mixed case", async () => {
    expect((await validateCode("Usd")).length).toBeGreaterThan(0);
  });

  it("rejects codes shorter than 3 letters", async () => {
    expect((await validateCode("US")).length).toBeGreaterThan(0);
  });

  it("rejects codes longer than 3 letters", async () => {
    expect((await validateCode("USDX")).length).toBeGreaterThan(0);
  });

  it("rejects codes with digits", async () => {
    expect((await validateCode("US1")).length).toBeGreaterThan(0);
  });

  it("rejects non-string input", async () => {
    expect((await validateCode(123)).length).toBeGreaterThan(0);
    expect((await validateCode(null)).length).toBeGreaterThan(0);
    expect((await validateCode(undefined)).length).toBeGreaterThan(0);
  });
});
