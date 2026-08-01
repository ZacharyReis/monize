/**
 * Table rendering utility for PDF export.
 * Uses jspdf-autotable to render professional financial tables in PDFs.
 */

import type jsPDF from 'jspdf';
import type { CellDef, RowInput } from 'jspdf-autotable';
import autoTable from 'jspdf-autotable';
import { PDF_FONT } from './pdf-fonts';

export interface PdfTableOptions {
  startY?: number;
  fontSize?: number;
  showTotalRow?: boolean;
  totalRow?: (string | number)[];
}

export type CellValue = string | number | null | undefined | {
  text: string;
  bgColor?: [number, number, number];
  textColor?: [number, number, number];
};

/**
 * Adds a formatted table to a jsPDF document.
 * Returns the Y position after the table for subsequent content.
 */
export function addTableToPdf(
  doc: jsPDF,
  headers: string[],
  rows: CellValue[][],
  options: PdfTableOptions = {},
): number {
  const { startY = 60, fontSize = 9, showTotalRow = false, totalRow } = options;

  const headerRow: CellDef[] = headers.map((h) => ({
    content: h,
    styles: {
      fillColor: [30, 58, 95] as [number, number, number],
      textColor: [255, 255, 255] as [number, number, number],
      fontStyle: 'bold' as const,
      halign: isNumericHeader(h) ? 'right' as const : 'left' as const,
    },
  }));

  const bodyRows: RowInput[] = rows.map((row) =>
    row.map((cell, colIndex) => {
      const isObj = cell != null && typeof cell === 'object' && 'text' in cell;
      const content = isObj ? cell.text : (cell != null ? cell : '');
      const styles: Record<string, unknown> = {
        halign: isNumericHeader(headers[colIndex]) ? 'right' as const : 'left' as const,
      };
      if (isObj && cell.bgColor) {
        styles.fillColor = cell.bgColor;
      }
      if (isObj && cell.textColor) {
        styles.textColor = cell.textColor;
      }
      return { content, styles };
    }),
  );

  if (showTotalRow && totalRow) {
    const totalRowCells: CellDef[] = totalRow.map((cell, colIndex) => ({
      content: cell != null ? cell : '',
      styles: {
        fontStyle: 'bold' as const,
        halign: isNumericHeader(headers[colIndex]) ? 'right' as const : 'left' as const,
        fillColor: [240, 240, 240] as [number, number, number],
      },
    }));
    bodyRows.push(totalRowCells);
  }

  autoTable(doc, {
    head: [headerRow],
    body: bodyRows,
    startY,
    theme: 'grid',
    styles: {
      // Match the embedded UTF-8 font used by the rest of the report so tables
      // render Polish/diacritics correctly and look consistent with the
      // headers and summary cards (which use the same font).
      font: PDF_FONT,
      fontSize,
      cellPadding: 3,
      lineColor: [220, 220, 220],
      lineWidth: 0.25,
      // Wrap long cell content onto multiple lines (Excel-style) instead of
      // letting it overflow the cell; autoTable then grows the row height.
      overflow: 'linebreak',
      valign: 'middle',
    },
    headStyles: {
      font: PDF_FONT,
      fillColor: [30, 58, 95],
      textColor: [255, 255, 255],
      fontStyle: 'bold',
    },
    // Cap column widths so a single wide column can't blow past the page; the
    // remaining width is shared and content wraps within it.
    tableWidth: 'auto',
    alternateRowStyles: {
      fillColor: [248, 249, 250],
    },
    margin: { left: 14, right: 14 },
  });

  // Return the final Y position after the table
  return (doc as jsPDF & { lastAutoTable: { finalY: number } }).lastAutoTable.finalY;
}

const NUMERIC_HEADERS = new Set([
  'Amount', 'Value', '%', 'Count', 'Total', 'Balance',
  'Payment', 'Principal', 'Interest', 'Average', 'Avg Amount',
  '6-Mo Total', 'Total Paid', 'Payments', 'Total Income',
  'Total Expenses', 'Total Deductions',
  'Quantity', 'Price', 'Budgeted', 'Actual', 'Score',
  'Rate', 'Yield', 'Return', 'Weight', 'Allocation',
  'Market Value', 'Net', 'Confidence', 'Return %',
  'Proceeds', 'Cost Basis', 'Gain/Loss',
  'Total Value', '% of Portfolio', 'Holdings', 'Native Value',
  '% Used', 'Score Impact', 'Avg Budget', 'Avg Actual',
  'Total Variance', 'Spent', 'Remaining', 'Direct Value',
  'ETF Value', 'Typical/Mo', '% Change', 'Current Balance',
  'Interest Rate', 'Payment Amount', 'Variance',
]);

function isNumericHeader(header: string): boolean {
  return NUMERIC_HEADERS.has(header);
}
