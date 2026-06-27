jest.mock("pdf-parse", () => ({ __esModule: true, default: jest.fn() }));
import pdfParse from "pdf-parse";
import { extractPdfText } from "./pdf-text.util";

const mockPdfParse = pdfParse as unknown as jest.Mock;

describe("extractPdfText", () => {
  beforeEach(() => mockPdfParse.mockReset());

  it("returns the trimmed text layer", async () => {
    mockPdfParse.mockResolvedValue({ text: "  Statement total: $42  \n" });
    await expect(extractPdfText(Buffer.from("%PDF"))).resolves.toBe(
      "Statement total: $42",
    );
  });

  it("returns an empty string for a PDF with no text layer", async () => {
    mockPdfParse.mockResolvedValue({ text: "" });
    await expect(extractPdfText(Buffer.from("%PDF"))).resolves.toBe("");
  });

  it("propagates a parse failure to the caller", async () => {
    mockPdfParse.mockRejectedValue(new Error("not a pdf"));
    await expect(extractPdfText(Buffer.from("nope"))).rejects.toThrow(
      "not a pdf",
    );
  });
});
