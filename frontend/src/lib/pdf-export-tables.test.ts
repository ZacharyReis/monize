import { describe, it, expect, vi, beforeEach } from 'vitest';

const { mockAutoTable } = vi.hoisted(() => ({
  mockAutoTable: vi.fn(),
}));

vi.mock('jspdf-autotable', () => ({
  default: mockAutoTable,
}));

// Must import AFTER vi.mock
import { addTableToPdf } from './pdf-export-tables';

describe('addTableToPdf', () => {
  beforeEach(() => {
    mockAutoTable.mockClear();
  });

  it('calls autoTable with correct headers and body', () => {
    const mockDoc = {
      lastAutoTable: { finalY: 100 },
    };

    const headers = ['Name', 'Amount'];
    const rows = [
      ['Groceries', 150],
      ['Rent', 1200],
    ];

    const result = addTableToPdf(mockDoc as any, headers, rows, { startY: 40 });

    expect(mockAutoTable).toHaveBeenCalledWith(
      mockDoc,
      expect.objectContaining({
        startY: 40,
        theme: 'grid',
      }),
    );

    const callArgs = mockAutoTable.mock.calls[0][1];
    expect(callArgs.head).toHaveLength(1);
    expect(callArgs.head[0]).toHaveLength(2);
    expect(callArgs.body).toHaveLength(2);
    expect(result).toBe(100);
    // Uses the embedded UTF-8 font and wraps overflowing content (Excel-style).
    expect(callArgs.styles.font).toBe('Roboto');
    expect(callArgs.headStyles.font).toBe('Roboto');
    expect(callArgs.styles.overflow).toBe('linebreak');
  });

  it('adds total row when showTotalRow is true', () => {
    const mockDoc = {
      lastAutoTable: { finalY: 120 },
    };

    addTableToPdf(mockDoc as any, ['Name', 'Amount'], [['A', 10]], {
      showTotalRow: true,
      totalRow: ['Total', 10],
    });

    const callArgs = mockAutoTable.mock.calls[0][1];
    // Body should have 2 rows: 1 data + 1 total
    expect(callArgs.body).toHaveLength(2);
  });

  it('right-aligns numeric headers', () => {
    const mockDoc = {
      lastAutoTable: { finalY: 80 },
    };

    addTableToPdf(mockDoc as any, ['Name', 'Amount', 'Count'], [['A', 100, 5]]);

    const callArgs = mockAutoTable.mock.calls[0][1];
    const headerRow = callArgs.head[0];
    expect(headerRow[0].styles.halign).toBe('left');
    expect(headerRow[1].styles.halign).toBe('right');
    expect(headerRow[2].styles.halign).toBe('right');
  });

  it('renders object cells with text content and optional bgColor/textColor', () => {
    const mockDoc = { lastAutoTable: { finalY: 100 } };
    const rows = [[
      { text: 'Red Cell', bgColor: [255, 0, 0] as [number, number, number], textColor: [255, 255, 255] as [number, number, number] },
      { text: 'Plain Object' },
      null,
      undefined,
    ]];

    addTableToPdf(mockDoc as any, ['A', 'B', 'C', 'D'], rows);

    const callArgs = mockAutoTable.mock.calls[0][1];
    const bodyRow = callArgs.body[0];
    expect(bodyRow[0].content).toBe('Red Cell');
    expect(bodyRow[0].styles.fillColor).toEqual([255, 0, 0]);
    expect(bodyRow[0].styles.textColor).toEqual([255, 255, 255]);
    expect(bodyRow[1].content).toBe('Plain Object');
    expect(bodyRow[1].styles.fillColor).toBeUndefined();
    expect(bodyRow[1].styles.textColor).toBeUndefined();
    expect(bodyRow[2].content).toBe('');
    expect(bodyRow[3].content).toBe('');
  });

  it('does not add total row when showTotalRow is true but totalRow is absent', () => {
    const mockDoc = { lastAutoTable: { finalY: 100 } };
    addTableToPdf(mockDoc as any, ['Name', 'Amount'], [['A', 10]], { showTotalRow: true });
    const callArgs = mockAutoTable.mock.calls[0][1];
    expect(callArgs.body).toHaveLength(1);
  });
});
