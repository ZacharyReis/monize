import pdfParse from "pdf-parse";

/**
 * Extract the text layer from a PDF's bytes.
 *
 * Used by the relay attachment resource so a PDF uploaded in relay mode is
 * served to the agent as plain text rather than a binary blob. Handing the
 * agent's MCP client (e.g. Claude Code) a raw `application/pdf` blob makes it
 * fall back to a local PDF handler, which prompts the user to install/run extra
 * tooling. Returning extracted text sidesteps that entirely -- the agent reads
 * the resource exactly like a CSV.
 *
 * Returns the trimmed text, which is empty for a scanned / image-only PDF that
 * carries no text layer. Throws if the bytes cannot be parsed as a PDF; callers
 * surface that as a resource read error.
 */
export async function extractPdfText(data: Buffer): Promise<string> {
  const result = await pdfParse(data);
  return (result.text ?? "").trim();
}
