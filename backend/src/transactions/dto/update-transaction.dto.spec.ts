import { plainToInstance } from "class-transformer";
import { validate } from "class-validator";
import { UpdateTransactionDto } from "./update-transaction.dto";

describe("UpdateTransactionDto excludeFromProjection", () => {
  const run = async (value: unknown) => {
    const dto = plainToInstance(UpdateTransactionDto, {
      excludeFromProjection: value,
    });
    return validate(dto);
  };

  it("accepts true, false, and null", async () => {
    expect(await run(true)).toHaveLength(0);
    expect(await run(false)).toHaveLength(0);
    expect(await run(null)).toHaveLength(0);
  });

  it("rejects a non-boolean value", async () => {
    const errors = await run("nope");
    expect(errors.length).toBeGreaterThan(0);
    expect(errors[0].property).toBe("excludeFromProjection");
  });
});
