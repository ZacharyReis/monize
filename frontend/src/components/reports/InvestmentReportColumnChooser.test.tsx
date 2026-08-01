import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, createEvent } from '@/test/render';
import { InvestmentReportColumnChooser } from './InvestmentReportColumnChooser';
import { INVESTMENT_REPORT_COLUMNS } from '@/types/investment-report';

describe('InvestmentReportColumnChooser', () => {
  it('lists the selected columns in the given order', () => {
    render(<InvestmentReportColumnChooser value={['symbol', 'marketValue']} onChange={vi.fn()} />);
    expect(screen.getByText('Selected columns (2)')).toBeInTheDocument();
    expect(screen.getByTestId('selected-symbol')).toBeInTheDocument();
    expect(screen.getByTestId('selected-marketValue')).toBeInTheDocument();
  });

  it('adds an available column', () => {
    const onChange = vi.fn();
    render(<InvestmentReportColumnChooser value={['symbol']} onChange={onChange} />);
    fireEvent.click(screen.getByLabelText('Add Market Value'));
    expect(onChange).toHaveBeenCalledWith(['symbol', 'marketValue']);
  });

  it('removes a selected column', () => {
    const onChange = vi.fn();
    render(<InvestmentReportColumnChooser value={['symbol', 'gain']} onChange={onChange} />);
    fireEvent.click(screen.getByLabelText('Remove Gain'));
    expect(onChange).toHaveBeenCalledWith(['symbol']);
  });

  it('allows removing the symbol column', () => {
    const onChange = vi.fn();
    render(<InvestmentReportColumnChooser value={['symbol', 'gain']} onChange={onChange} />);
    fireEvent.click(screen.getByLabelText('Remove Symbol'));
    expect(onChange).toHaveBeenCalledWith(['gain']);
  });

  // jsdom rows have a zero-height bounding rect, so a negative clientY lands
  // in the top half (insert above) and a positive one in the bottom half.
  const dragOverAt = (el: Element, clientY: number) => {
    const evt = createEvent.dragOver(el);
    Object.defineProperty(evt, 'clientY', { value: clientY });
    fireEvent(el, evt);
  };

  it('reorders columns by dragging one above another', () => {
    const onChange = vi.fn();
    render(
      <InvestmentReportColumnChooser
        value={['symbol', 'gain', 'marketValue']}
        onChange={onChange}
      />,
    );
    const source = screen.getByTestId('selected-marketValue');
    const target = screen.getByTestId('selected-gain');
    fireEvent.dragStart(source);
    dragOverAt(target, -5);
    fireEvent.drop(target);
    expect(onChange).toHaveBeenCalledWith(['symbol', 'marketValue', 'gain']);
  });

  it('dropping in the bottom half of a row inserts below it', () => {
    const onChange = vi.fn();
    render(
      <InvestmentReportColumnChooser
        value={['symbol', 'gain', 'marketValue']}
        onChange={onChange}
      />,
    );
    const source = screen.getByTestId('selected-marketValue');
    const target = screen.getByTestId('selected-symbol');
    fireEvent.dragStart(source);
    dragOverAt(target, 5);
    fireEvent.drop(target);
    expect(onChange).toHaveBeenCalledWith(['symbol', 'marketValue', 'gain']);
  });

  it('can move a column ahead of symbol', () => {
    const onChange = vi.fn();
    render(<InvestmentReportColumnChooser value={['symbol', 'gain']} onChange={onChange} />);
    fireEvent.dragStart(screen.getByTestId('selected-gain'));
    dragOverAt(screen.getByTestId('selected-symbol'), -5);
    fireEvent.drop(screen.getByTestId('selected-symbol'));
    expect(onChange).toHaveBeenCalledWith(['gain', 'symbol']);
  });

  it('can drag the symbol column itself', () => {
    const onChange = vi.fn();
    render(
      <InvestmentReportColumnChooser value={['symbol', 'gain', 'name']} onChange={onChange} />,
    );
    fireEvent.dragStart(screen.getByTestId('selected-symbol'));
    dragOverAt(screen.getByTestId('selected-name'), 5);
    fireEvent.drop(screen.getByTestId('selected-name'));
    expect(onChange).toHaveBeenCalledWith(['gain', 'name', 'symbol']);
  });

  it('falls back to the raw key for an unknown selected column', () => {
    render(<InvestmentReportColumnChooser value={['symbol', 'legacyKey']} onChange={vi.fn()} />);
    expect(screen.getByText('legacyKey')).toBeInTheDocument();
  });

  it('prompts to add a column when none are selected', () => {
    render(<InvestmentReportColumnChooser value={[]} onChange={vi.fn()} />);
    expect(screen.getByText(/Add at least one column/)).toBeInTheDocument();
  });

  it('shows an empty state when every column is selected', () => {
    const allKeys = INVESTMENT_REPORT_COLUMNS.map((c) => c.key);
    render(<InvestmentReportColumnChooser value={allKeys} onChange={vi.fn()} />);
    expect(screen.getByText('All columns selected')).toBeInTheDocument();
  });
});
