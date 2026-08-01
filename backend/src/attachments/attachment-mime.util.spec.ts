import { sniffAttachmentMime } from "./attachment-mime.util";

describe("sniffAttachmentMime", () => {
  it("detects JPEG", () => {
    expect(sniffAttachmentMime(Buffer.from([0xff, 0xd8, 0xff, 0xe0]))).toBe(
      "image/jpeg",
    );
  });

  it("detects PNG", () => {
    expect(
      sniffAttachmentMime(
        Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
      ),
    ).toBe("image/png");
  });

  it("detects GIF87a and GIF89a", () => {
    expect(sniffAttachmentMime(Buffer.from("GIF87a...", "ascii"))).toBe(
      "image/gif",
    );
    expect(sniffAttachmentMime(Buffer.from("GIF89a...", "ascii"))).toBe(
      "image/gif",
    );
  });

  it("detects WebP", () => {
    const webp = Buffer.concat([
      Buffer.from("RIFF", "ascii"),
      Buffer.from([0x00, 0x00, 0x00, 0x00]),
      Buffer.from("WEBP", "ascii"),
    ]);
    expect(sniffAttachmentMime(webp)).toBe("image/webp");
  });

  it("detects PDF", () => {
    expect(sniffAttachmentMime(Buffer.from("%PDF-1.4", "ascii"))).toBe(
      "application/pdf",
    );
  });

  it("returns null for unknown content", () => {
    expect(sniffAttachmentMime(Buffer.from("hello world", "ascii"))).toBeNull();
  });

  it("returns null for SVG (deliberately not allowed)", () => {
    expect(
      sniffAttachmentMime(Buffer.from("<svg xmlns=...", "ascii")),
    ).toBeNull();
  });

  it("returns null for too-short buffers", () => {
    expect(sniffAttachmentMime(Buffer.from([0xff]))).toBeNull();
    expect(sniffAttachmentMime(Buffer.alloc(0))).toBeNull();
  });
});
