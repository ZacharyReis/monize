import { ValidationPipe, BadRequestException } from "@nestjs/common";
import { CreateTransactionDto } from "./create-transaction.dto";
import { UpdateTransactionDto } from "./update-transaction.dto";

/**
 * Task-6 Criterion 3: `fitid` is load-bearing for import dedup and must be
 * settable ONLY through the internal import-apply path -- never via the public
 * POST/PATCH /transactions API. It is deliberately absent from
 * Create/UpdateTransactionDto, so the global ValidationPipe (whitelist +
 * forbidNonWhitelisted, mirrored from main.ts) must reject a client-supplied
 * `fitid`. This guards against a client pre-seeding a FITID to suppress a real
 * future import.
 */
describe("fitid is not accepted on the public transaction DTOs", () => {
  const pipe = new ValidationPipe({
    whitelist: true,
    forbidNonWhitelisted: true,
    transform: true,
  });

  const validBase = {
    accountId: "550e8400-e29b-41d4-a716-446655440000",
    transactionDate: "2026-01-15",
    amount: -50,
    currencyCode: "USD",
  };

  it("rejects fitid on CreateTransactionDto", async () => {
    await expect(
      pipe.transform(
        { ...validBase, fitid: "SPOOFED-FITID" },
        { type: "body", metatype: CreateTransactionDto },
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it("rejects fitid on UpdateTransactionDto", async () => {
    await expect(
      pipe.transform(
        { description: "hi", fitid: "SPOOFED-FITID" },
        { type: "body", metatype: UpdateTransactionDto },
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it("still accepts a clean CreateTransactionDto payload (no false positive)", async () => {
    await expect(
      pipe.transform(
        { ...validBase },
        { type: "body", metatype: CreateTransactionDto },
      ),
    ).resolves.toMatchObject({ amount: -50, currencyCode: "USD" });
  });
});
