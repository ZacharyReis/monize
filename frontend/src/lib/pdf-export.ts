/**
 * PDF export utility for report data.
 * Generates professional financial report PDFs with charts and/or tables.
 */

import type { jsPDF } from 'jspdf';
import { captureAllChartsAsImages } from './pdf-export-charts';
import { addSummaryCardsToPdf } from './pdf-export-cards';
import { addTableToPdf, type CellValue } from './pdf-export-tables';
import { PDF_FONT, registerPdfFonts } from './pdf-fonts';

export type { PdfSummaryCard } from './pdf-export-cards';
export type { CellValue } from './pdf-export-tables';

export interface PdfLegendItem {
  color: string;
  label: string;
}

export interface PdfTableSection {
  title?: string;
  headers: string[];
  rows: CellValue[][];
  totalRow?: (string | number)[];
}

export interface PdfExportOptions {
  title: string;
  subtitle?: string;
  description?: string;
  summaryCards?: import('./pdf-export-cards').PdfSummaryCard[];
  chartContainer?: HTMLElement | null;
  chartColumns?: number;
  chartLegend?: PdfLegendItem[];
  tableData?: {
    headers: string[];
    rows: CellValue[][];
    totalRow?: (string | number)[];
  };
  additionalTables?: PdfTableSection[];
  filename: string;
}

/**
 * Generates and downloads a PDF report.
 * Includes chart images (if container provided) and/or a data table.
 * Multiple charts are rendered sequentially with page breaks as needed.
 */
export async function exportToPdf(options: PdfExportOptions): Promise<void> {
  const { title, subtitle, description, summaryCards, chartContainer, chartColumns, chartLegend, tableData, additionalTables, filename } = options;

  const hasChart = !!chartContainer;
  const hasTable = tableData && tableData.headers.length > 0;

  // Dynamically import jspdf to avoid Turbopack SSR bundling issues with fflate
  // Use landscape for chart-only or chart+table, portrait for table-only
  const orientation = hasChart ? 'landscape' : 'portrait';
  const { jsPDF: JsPDF } = await import('jspdf');
  const doc = new JsPDF({ orientation, unit: 'mm', format: 'a4' });
  // Embed a UTF-8 font so Polish and other Latin-Extended/Cyrillic/Greek text
  // renders correctly instead of jsPDF's WinAnsi-only built-in Helvetica.
  registerPdfFonts(doc);

  const pageWidth = doc.internal.pageSize.getWidth();
  const pageHeight = doc.internal.pageSize.getHeight();
  const margin = 14;

  // Header
  addHeader(doc, title, subtitle, pageWidth, margin);

  let currentY = subtitle ? 32 : 26;

  // Description text block
  if (description) {
    doc.setFontSize(9);
    doc.setFont(PDF_FONT, 'normal');
    doc.setTextColor(55, 65, 81);
    const maxTextWidth = pageWidth - margin * 2;
    const lines = doc.splitTextToSize(description, maxTextWidth) as string[];
    doc.text(lines, margin, currentY);
    currentY += lines.length * 4 + 3;
  }

  // Summary cards
  if (summaryCards?.length) {
    currentY = addSummaryCardsToPdf(doc, summaryCards, { startY: currentY, pageWidth, margin });
  }

  // Charts
  if (hasChart && chartContainer) {
    try {
      // scale 2 is ~325 dpi at the printed width -- crisp for print, while
      // scale 3 produced needlessly huge (5160 px) rasters.
      const charts = await captureAllChartsAsImages(chartContainer, 2);
      if (charts.length > 0) {
        const cols = chartColumns && chartColumns > 1 ? chartColumns : 1;
        // Dynamic max height: single chart gets full space, multiple charts share space
        const maxHeight = charts.length === 1 ? 120 : 80;
        const maxWidth = pageWidth - margin * 2;
        const chartGap = 8;

        if (cols > 1) {
          // Multi-column chart layout (e.g., side-by-side pie charts)
          const colWidth = (maxWidth - (cols - 1) * chartGap) / cols;

          for (let i = 0; i < charts.length; i += cols) {
            const rowCharts = charts.slice(i, i + cols);
            let maxRowHeight = 0;

            // Check page break before rendering row
            const estHeight = Math.min(maxHeight, colWidth / (rowCharts[0].width / rowCharts[0].height));
            if (currentY + estHeight > pageHeight - 20) {
              doc.addPage();
              addHeader(doc, title, subtitle, pageWidth, margin);
              currentY = subtitle ? 32 : 26;
            }

            for (let j = 0; j < rowCharts.length; j++) {
              const chart = rowCharts[j];
              const aspectRatio = chart.width / chart.height;
              let imgWidth = colWidth;
              let imgHeight = imgWidth / aspectRatio;
              if (imgHeight > maxHeight) {
                imgHeight = maxHeight;
                imgWidth = imgHeight * aspectRatio;
              }
              const xOffset = margin + j * (colWidth + chartGap) + (colWidth - imgWidth) / 2;
              // 'FAST' deflates the raster: without a compression flag jsPDF
              // stores the decoded pixels raw (a chart was ~16 MB uncompressed).
              doc.addImage(chart.dataUrl, 'PNG', xOffset, currentY, imgWidth, imgHeight, undefined, 'FAST');
              maxRowHeight = Math.max(maxRowHeight, imgHeight);
            }

            currentY += maxRowHeight + chartGap;
          }
        } else {
          // Single-column layout (original behavior)
          for (const chart of charts) {
            const aspectRatio = chart.width / chart.height;
            let imgWidth = maxWidth;
            let imgHeight = imgWidth / aspectRatio;
            if (imgHeight > maxHeight) {
              imgHeight = maxHeight;
              imgWidth = imgHeight * aspectRatio;
            }

            // Page break if chart doesn't fit
            if (currentY + imgHeight > pageHeight - 20) {
              doc.addPage();
              addHeader(doc, title, subtitle, pageWidth, margin);
              currentY = subtitle ? 32 : 26;
            }

            const xOffset = (pageWidth - imgWidth) / 2;
            doc.addImage(chart.dataUrl, 'PNG', xOffset, currentY, imgWidth, imgHeight, undefined, 'FAST');
            currentY += imgHeight + chartGap;
          }
        }
      }
    } catch (error) {
      // Chart capture failed; continue with table only
      console.warn('PDF chart capture failed, generating table-only PDF:', error);
    }
  }

  // Chart legend
  if (chartLegend?.length) {
    currentY = addChartLegend(doc, chartLegend, currentY, pageWidth, margin);
  }

  // Table
  if (hasTable) {
    // If charts took too much space, add a new page for the table
    if (hasChart && currentY > pageHeight - 60) {
      doc.addPage();
      addHeader(doc, title, subtitle, pageWidth, margin);
      currentY = subtitle ? 32 : 26;
    }
    currentY = addTableToPdf(doc, tableData.headers, tableData.rows, {
      startY: currentY,
      showTotalRow: !!tableData.totalRow,
      totalRow: tableData.totalRow,
    });
  }

  // Additional tables
  if (additionalTables?.length) {
    for (const table of additionalTables) {
      if (table.headers.length === 0 || table.rows.length === 0) continue;

      // Page break if not enough space for title + a few rows
      if (currentY > pageHeight - 40) {
        doc.addPage();
        addHeader(doc, title, subtitle, pageWidth, margin);
        currentY = subtitle ? 32 : 26;
      }

      // Section title
      if (table.title) {
        currentY += 4;
        doc.setFontSize(11);
        doc.setFont(PDF_FONT, 'bold');
        doc.setTextColor(30, 58, 95);
        doc.text(table.title, margin, currentY);
        currentY += 4;
      }

      currentY = addTableToPdf(doc, table.headers, table.rows, {
        startY: currentY,
        showTotalRow: !!table.totalRow,
        totalRow: table.totalRow,
      });
    }
  }

  // Footer on all pages
  const totalPages = doc.getNumberOfPages();
  for (let i = 1; i <= totalPages; i++) {
    doc.setPage(i);
    addFooter(doc, i, totalPages, pageWidth);
  }

  const pdfFilename = filename.endsWith('.pdf') ? filename : `${filename}.pdf`;
  doc.save(pdfFilename);
}

function addHeader(
  doc: jsPDF,
  title: string,
  subtitle: string | undefined,
  pageWidth: number,
  margin: number,
): void {
  // Title
  doc.setFontSize(16);
  doc.setFont(PDF_FONT, 'bold');
  doc.setTextColor(30, 58, 95);
  doc.text(title, margin, 14);

  // Subtitle / date info
  if (subtitle) {
    doc.setFontSize(10);
    doc.setFont(PDF_FONT, 'normal');
    doc.setTextColor(107, 114, 128);
    doc.text(subtitle, margin, 22);
  }

  // Generation timestamp on the right
  const now = new Date();
  const timestamp = now.toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
  doc.setFontSize(8);
  doc.setFont(PDF_FONT, 'normal');
  doc.setTextColor(156, 163, 175);
  doc.text(`Generated: ${timestamp}`, pageWidth - margin, 14, { align: 'right' });

  // Separator line
  const lineY = subtitle ? 27 : 19;
  doc.setDrawColor(229, 231, 235);
  doc.setLineWidth(0.5);
  doc.line(margin, lineY, pageWidth - margin, lineY);
}

function addChartLegend(
  doc: jsPDF,
  items: PdfLegendItem[],
  startY: number,
  pageWidth: number,
  margin: number,
): number {
  const SWATCH_SIZE = 3;
  const ITEM_GAP = 3;
  const LINE_HEIGHT = 5;
  const availableWidth = pageWidth - margin * 2;

  doc.setFontSize(8);
  doc.setFont(PDF_FONT, 'normal');

  let x = margin;
  let y = startY;

  for (const item of items) {
    // Measure text width to determine if we need to wrap
    const textWidth = doc.getTextWidth(item.label);
    const itemWidth = SWATCH_SIZE + 1.5 + textWidth + ITEM_GAP;

    if (x + itemWidth > margin + availableWidth && x > margin) {
      // Wrap to next line
      x = margin;
      y += LINE_HEIGHT;
    }

    // Parse hex color
    const hex = item.color.replace('#', '');
    const r = parseInt(hex.substring(0, 2), 16);
    const g = parseInt(hex.substring(2, 4), 16);
    const b = parseInt(hex.substring(4, 6), 16);

    // Draw colored square
    doc.setFillColor(r, g, b);
    doc.rect(x, y - SWATCH_SIZE + 0.5, SWATCH_SIZE, SWATCH_SIZE, 'F');

    // Draw label
    doc.setTextColor(55, 65, 81);
    doc.text(item.label, x + SWATCH_SIZE + 1.5, y);

    x += itemWidth;
  }

  return y + LINE_HEIGHT + 2;
}

function addFooter(
  doc: jsPDF,
  pageNumber: number,
  totalPages: number,
  pageWidth: number,
): void {
  const pageHeight = doc.internal.pageSize.getHeight();
  doc.setFontSize(8);
  doc.setFont(PDF_FONT, 'normal');
  doc.setTextColor(156, 163, 175);
  doc.text('Monize', 14, pageHeight - 8);
  doc.text(
    `Page ${pageNumber} of ${totalPages}`,
    pageWidth - 14,
    pageHeight - 8,
    { align: 'right' },
  );
}
