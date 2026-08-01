import { describe, it, expect, vi } from 'vitest';
import type { jsPDF } from 'jspdf';
import { PDF_FONT, registerPdfFonts } from './pdf-fonts';

describe('registerPdfFonts', () => {
  it('embeds both Roboto faces and activates the family', () => {
    const doc = {
      addFileToVFS: vi.fn(),
      addFont: vi.fn(),
      setFont: vi.fn(),
    } as unknown as jsPDF;

    registerPdfFonts(doc);

    expect(doc.addFileToVFS).toHaveBeenCalledWith(
      'Roboto-Regular.ttf',
      expect.any(String),
    );
    expect(doc.addFileToVFS).toHaveBeenCalledWith(
      'Roboto-Bold.ttf',
      expect.any(String),
    );
    expect(doc.addFont).toHaveBeenCalledWith('Roboto-Regular.ttf', PDF_FONT, 'normal');
    expect(doc.addFont).toHaveBeenCalledWith('Roboto-Bold.ttf', PDF_FONT, 'bold');
    expect(doc.setFont).toHaveBeenCalledWith(PDF_FONT, 'normal');
  });

  it('embeds non-empty base64 font data (so glyphs actually ship)', () => {
    const captured: string[] = [];
    const doc = {
      addFileToVFS: vi.fn((_name: string, data: string) => captured.push(data)),
      addFont: vi.fn(),
      setFont: vi.fn(),
    } as unknown as jsPDF;

    registerPdfFonts(doc);

    expect(captured).toHaveLength(2);
    // A real subset is tens of KB of base64; guard against an empty/placeholder.
    for (const data of captured) {
      expect(data.length).toBeGreaterThan(1000);
    }
  });
});
