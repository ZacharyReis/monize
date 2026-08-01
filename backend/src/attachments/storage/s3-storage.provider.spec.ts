const mockSend = jest.fn();

jest.mock("@aws-sdk/client-s3", () => ({
  S3Client: jest.fn().mockImplementation((cfg) => ({ send: mockSend, cfg })),
  PutObjectCommand: jest.fn().mockImplementation((input) => ({
    kind: "put",
    input,
  })),
  GetObjectCommand: jest.fn().mockImplementation((input) => ({
    kind: "get",
    input,
  })),
  DeleteObjectCommand: jest.fn().mockImplementation((input) => ({
    kind: "delete",
    input,
  })),
}));

import { NotFoundException } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { S3Client } from "@aws-sdk/client-s3";
import { S3StorageProvider } from "./s3-storage.provider";

const configFor = (values: Record<string, string | undefined>) =>
  ({ get: (key: string) => values[key] }) as unknown as ConfigService;

describe("S3StorageProvider", () => {
  beforeEach(() => {
    mockSend.mockReset();
    (S3Client as unknown as jest.Mock).mockClear();
  });

  it("has the s3 name", () => {
    const provider = new S3StorageProvider(configFor({}));
    expect(provider.name).toBe("s3");
  });

  it("puts bytes under bucket and key on save", async () => {
    const provider = new S3StorageProvider(
      configFor({ ATTACHMENT_S3_BUCKET: "my-bucket" }),
    );
    mockSend.mockResolvedValue({});
    await provider.save("abc", Buffer.from("data"));
    expect(mockSend).toHaveBeenCalledTimes(1);
    const command = mockSend.mock.calls[0][0];
    expect(command.kind).toBe("put");
    expect(command.input).toMatchObject({ Bucket: "my-bucket", Key: "abc" });
  });

  it("applies the configured key prefix", async () => {
    const provider = new S3StorageProvider(
      configFor({
        ATTACHMENT_S3_BUCKET: "my-bucket",
        ATTACHMENT_S3_PREFIX: "attachments/",
      }),
    );
    mockSend.mockResolvedValue({});
    await provider.save("abc", Buffer.from("data"));
    expect(mockSend.mock.calls[0][0].input.Key).toBe("attachments/abc");
  });

  it("loads and returns bytes", async () => {
    const provider = new S3StorageProvider(
      configFor({ ATTACHMENT_S3_BUCKET: "my-bucket" }),
    );
    mockSend.mockResolvedValue({
      Body: { transformToByteArray: async () => new Uint8Array([1, 2, 3]) },
    });
    await expect(provider.load("abc")).resolves.toEqual(Buffer.from([1, 2, 3]));
  });

  it("maps a missing object to NotFound on load", async () => {
    const provider = new S3StorageProvider(
      configFor({ ATTACHMENT_S3_BUCKET: "my-bucket" }),
    );
    mockSend.mockRejectedValue({ name: "NoSuchKey" });
    await expect(provider.load("abc")).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  it("maps a 404 metadata error to NotFound on load", async () => {
    const provider = new S3StorageProvider(
      configFor({ ATTACHMENT_S3_BUCKET: "my-bucket" }),
    );
    mockSend.mockRejectedValue({ $metadata: { httpStatusCode: 404 } });
    await expect(provider.load("abc")).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  it("treats an empty body as NotFound", async () => {
    const provider = new S3StorageProvider(
      configFor({ ATTACHMENT_S3_BUCKET: "my-bucket" }),
    );
    mockSend.mockResolvedValue({ Body: undefined });
    await expect(provider.load("abc")).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  it("rethrows non-404 errors on load", async () => {
    const provider = new S3StorageProvider(
      configFor({ ATTACHMENT_S3_BUCKET: "my-bucket" }),
    );
    mockSend.mockRejectedValue(new Error("network down"));
    await expect(provider.load("abc")).rejects.toThrow("network down");
  });

  it("deletes the object", async () => {
    const provider = new S3StorageProvider(
      configFor({ ATTACHMENT_S3_BUCKET: "my-bucket" }),
    );
    mockSend.mockResolvedValue({});
    await provider.delete("abc");
    expect(mockSend.mock.calls[0][0].kind).toBe("delete");
  });

  it("throws when the bucket is not configured", async () => {
    const provider = new S3StorageProvider(configFor({}));
    await expect(provider.save("abc", Buffer.from("x"))).rejects.toThrow(
      /ATTACHMENT_S3_BUCKET/,
    );
  });

  it("passes endpoint, credentials, and path-style to the client", async () => {
    const provider = new S3StorageProvider(
      configFor({
        ATTACHMENT_S3_BUCKET: "my-bucket",
        ATTACHMENT_S3_ENDPOINT: "http://minio:9000",
        ATTACHMENT_S3_REGION: "eu-west-1",
        ATTACHMENT_S3_FORCE_PATH_STYLE: "true",
        ATTACHMENT_S3_ACCESS_KEY_ID: "id",
        ATTACHMENT_S3_SECRET_ACCESS_KEY: "secret",
      }),
    );
    mockSend.mockResolvedValue({});
    await provider.save("abc", Buffer.from("x"));
    const cfg = (S3Client as unknown as jest.Mock).mock.calls[0][0];
    expect(cfg).toMatchObject({
      endpoint: "http://minio:9000",
      region: "eu-west-1",
      forcePathStyle: true,
      credentials: { accessKeyId: "id", secretAccessKey: "secret" },
    });
  });

  it("builds the client only once across calls", async () => {
    const provider = new S3StorageProvider(
      configFor({ ATTACHMENT_S3_BUCKET: "my-bucket" }),
    );
    mockSend.mockResolvedValue({});
    await provider.save("a", Buffer.from("x"));
    await provider.delete("a");
    expect((S3Client as unknown as jest.Mock).mock.calls.length).toBe(1);
  });
});
