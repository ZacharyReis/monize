/**
 * UTF-8 font registration for jsPDF report exports.
 *
 * jsPDF's built-in Helvetica is a standard-14 font limited to WinAnsi/CP1252,
 * so it renders Polish and other Latin-Extended characters wrong (e.g. `ł`
 * printed as `B`). We embed a subset of Roboto (Latin, Latin Extended-A/B,
 * Cyrillic, Greek, punctuation and currency symbols -- covering every European
 * locale Monize ships) so text drawn with this font is proper UTF-8.
 *
 * CJK / Devanagari are intentionally out of scope: those fonts are megabytes
 * each and cannot be embedded in every PDF. Text in those scripts falls back to
 * whatever glyphs the embedded font has (Latin/Cyrillic/Greek) and may show
 * blanks -- a separate, script-aware loader would be needed to support them.
 */
import type { jsPDF } from 'jspdf';
import { robotoRegular } from './pdf-fonts/roboto-regular';
import { robotoBold } from './pdf-fonts/roboto-bold';

/** Font family name to pass to `doc.setFont(...)` and autoTable `styles.font`. */
export const PDF_FONT = 'Roboto';

/**
 * Registers the embedded Roboto faces on a jsPDF document and makes Roboto the
 * active font. Call once, right after constructing the document. Idempotent per
 * document: jsPDF de-duplicates identical VFS entries.
 */
export function registerPdfFonts(doc: jsPDF): void {
  doc.addFileToVFS('Roboto-Regular.ttf', robotoRegular);
  doc.addFont('Roboto-Regular.ttf', PDF_FONT, 'normal');
  doc.addFileToVFS('Roboto-Bold.ttf', robotoBold);
  doc.addFont('Roboto-Bold.ttf', PDF_FONT, 'bold');
  doc.setFont(PDF_FONT, 'normal');
}
