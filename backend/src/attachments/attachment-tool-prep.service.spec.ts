import {
  BadRequestException,
  PayloadTooLargeException,
  UnsupportedMediaTypeException,
} from "@nestjs/common";
import { DataSource, EntityManager } from "typeorm";
import { createHash } from "crypto";
import { tenantTx } from "../common/db/tenant-tx";
import {
  AttachmentToolPrepService,
  AttachmentToolFile,
} from "./attachment-tool-prep.service";
import { MAX_ATTACHMENT_BYTES } from "./attachments.service";

jest.mock("../common/db/tenant-tx");
const mockedTenantTx = tenantTx as jest.MockedFunction<typeof tenantTx>;

const PNG_BYTES = Buffer.from([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x01,
]);
const PDF_BYTES = Buffer.from("%PDF-1.7\n...", "ascii");

function pngFile(
  overrides: Partial<AttachmentToolFile> = {},
): AttachmentToolFile {
  return { filename: "receipt.png", buffer: PNG_BYTES, ...overrides };
}

describe("AttachmentToolPrepService", () => {
  let service: AttachmentToolPrepService;
  let attRepo: { count: jest.Mock };

  beforeEach(() => {
    attRepo = { count: jest.fn().mockResolvedValue(0) };
    const manager = {
      getRepository: jest.fn(() => attRepo),
    } as unknown as EntityManager;
    mockedTenantTx.mockImplementation((_dataSource, fn) => fn(manager));
    service = new AttachmentToolPrepService({} as DataSource);
  });

  afterEach(() => jest.clearAllMocks());

  it("returns previews with sniffed type, size, and sha256", async () => {
    const previews = await service.prepareAttachments("user-1", [
      pngFile(),
      { filename: "invoice.pdf", buffer: PDF_BYTES },
    ]);

    expect(previews).toEqual([
      {
        filename: "receipt.png",
        contentType: "image/png",
        byteSize: PNG_BYTES.length,
        sha256: createHash("sha256").update(PNG_BYTES).digest("hex"),
      },
      {
        filename: "invoice.pdf",
        contentType: "application/pdf",
        byteSize: PDF_BYTES.length,
        sha256: createHash("sha256").update(PDF_BYTES).digest("hex"),
      },
    ]);
    // No transaction id -> no cap lookup needed.
    expect(mockedTenantTx).not.toHaveBeenCalled();
  });

  it("returns an empty list for no files without touching the database", async () => {
    await expect(service.prepareAttachments("user-1", [])).resolves.toEqual([]);
    expect(mockedTenantTx).not.toHaveBeenCalled();
  });

  it("sanitizes path components out of the filename", async () => {
    const previews = await service.prepareAttachments("user-1", [
      pngFile({ filename: "../../etc/receipt.png" }),
    ]);
    expect(previews[0].filename).toBe("receipt.png");
  });

  it("rejects an empty buffer", async () => {
    await expect(
      service.prepareAttachments("user-1", [
        pngFile({ buffer: Buffer.alloc(0) }),
      ]),
    ).rejects.toThrow(BadRequestException);
  });

  it("rejects a file above the size limit", async () => {
    const big = Buffer.concat([PNG_BYTES, Buffer.alloc(MAX_ATTACHMENT_BYTES)]);
    await expect(
      service.prepareAttachments("user-1", [pngFile({ buffer: big })]),
    ).rejects.toThrow(PayloadTooLargeException);
  });

  it("rejects a file that fails the magic-byte sniff", async () => {
    await expect(
      service.prepareAttachments("user-1", [
        pngFile({ buffer: Buffer.from("just,a,csv\n1,2,3\n") }),
      ]),
    ).rejects.toThrow(UnsupportedMediaTypeException);
  });

  it("counts existing attachments toward the cap on the update path", async () => {
    attRepo.count.mockResolvedValue(9);
    await expect(
      service.prepareAttachments("user-1", [pngFile(), pngFile()], "txn-1"),
    ).rejects.toThrow(BadRequestException);

    attRepo.count.mockResolvedValue(8);
    await expect(
      service.prepareAttachments("user-1", [pngFile(), pngFile()], "txn-1"),
    ).resolves.toHaveLength(2);
    expect(attRepo.count).toHaveBeenCalledWith({
      where: { transactionId: "txn-1", userId: "user-1" },
    });
  });
});
