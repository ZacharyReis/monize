import { validate } from "class-validator";
import { plainToInstance } from "class-transformer";
import { UpdatePreferencesDto } from "./update-preferences.dto";

async function languageError(language: string) {
  const dto = plainToInstance(UpdatePreferencesDto, { language });
  const errors = await validate(dto);
  return errors.find((e) => e.property === "language");
}

describe("UpdatePreferencesDto language validation", () => {
  it.each(["browser", "en", "fr", "pt-BR", "en-US", "en-GB"])(
    "accepts %s",
    async (language) => {
      expect(await languageError(language)).toBeUndefined();
    },
  );

  it.each(["EN", "english", "browserx", "e", "en_US", "en-gb"])(
    "rejects %s",
    async (language) => {
      expect(await languageError(language)).toBeDefined();
    },
  );
});

async function aiBubbleError(aiBubbleEnabled: unknown) {
  const dto = plainToInstance(UpdatePreferencesDto, { aiBubbleEnabled });
  const errors = await validate(dto);
  return errors.find((e) => e.property === "aiBubbleEnabled");
}

describe("UpdatePreferencesDto aiBubbleEnabled validation", () => {
  it.each([true, false])("accepts %s", async (value) => {
    expect(await aiBubbleError(value)).toBeUndefined();
  });

  it("accepts an omitted value (optional)", async () => {
    const dto = plainToInstance(UpdatePreferencesDto, {});
    const errors = await validate(dto);
    expect(
      errors.find((e) => e.property === "aiBubbleEnabled"),
    ).toBeUndefined();
  });

  it.each(["yes", "true", 1, 0])("rejects %s", async (value) => {
    expect(await aiBubbleError(value)).toBeDefined();
  });
});
