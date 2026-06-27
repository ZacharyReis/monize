import { describe, it, expect } from 'vitest';
import { render } from '@/test/render';
import { ChartTooltip, ChartTooltipPanel } from './ChartTooltip';

describe('ChartTooltip', () => {
  it('renders nothing when inactive', () => {
    const { container } = render(
      <ChartTooltip active={false} payload={[{ name: 'A', value: 1 }]} />,
    );
    expect(container).toBeEmptyDOMElement();
  });

  it('renders nothing when payload is empty', () => {
    const { container } = render(<ChartTooltip active payload={[]} />);
    expect(container).toBeEmptyDOMElement();
  });

  it('renders the label and entries with the formatter', () => {
    const { getByText } = render(
      <ChartTooltip
        active
        label="March"
        payload={[
          { name: 'Income', value: 1000, color: '#0a0' },
          { name: 'Expenses', value: 400, color: '#a00' },
        ]}
        formatValue={(v) => `$${v}`}
      />,
    );
    expect(getByText('March')).toBeInTheDocument();
    expect(getByText('Income: $1000')).toBeInTheDocument();
    expect(getByText('Expenses: $400')).toBeInTheDocument();
  });

  it('applies the entry colour to each line', () => {
    const { getByText } = render(
      <ChartTooltip active payload={[{ name: 'X', value: 5, color: 'rgb(255, 0, 0)' }]} />,
    );
    expect(getByText('X: 5')).toHaveStyle({ color: 'rgb(255, 0, 0)' });
  });

  it('renders extra children below the entries', () => {
    const { getByText } = render(
      <ChartTooltip active label="Cat" payload={[{ name: 'Spend', value: 10 }]}>
        <p>extra line</p>
      </ChartTooltip>,
    );
    expect(getByText('extra line')).toBeInTheDocument();
  });

  it('ChartTooltipPanel renders its children', () => {
    const { getByText } = render(
      <ChartTooltipPanel>
        <span>panel body</span>
      </ChartTooltipPanel>,
    );
    expect(getByText('panel body')).toBeInTheDocument();
  });
});
