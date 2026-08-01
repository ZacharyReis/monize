import { describe, it, expect } from 'vitest';
import { render } from '@/test/render';
import { JsonDiff } from './JsonDiff';

describe('JsonDiff', () => {
  it('renders both column headers', () => {
    const { getByText } = render(
      <JsonDiff
        before={{ name: 'Biedronka' }}
        after={{ name: 'Bi*****ka' }}
        beforeLabel="Before"
        afterLabel="After"
      />,
    );
    expect(getByText('Before')).toBeInTheDocument();
    expect(getByText('After')).toBeInTheDocument();
  });

  it('shows the original value on the left and the de-identified value on the right', () => {
    const { getByText } = render(
      <JsonDiff
        before={{ name: 'Biedronka' }}
        after={{ name: 'Bi*****ka' }}
        beforeLabel="Before"
        afterLabel="After"
      />,
    );
    expect(getByText('"Biedronka"')).toBeInTheDocument();
    expect(getByText('"Bi*****ka"')).toBeInTheDocument();
  });

  it('renders a union of keys, including a field dropped from the after row', () => {
    const { getByText } = render(
      <JsonDiff
        before={{ amount: 100, description: 'ODSETKI: 388,14' }}
        after={{ amount: 250 }}
        beforeLabel="Before"
        afterLabel="After"
      />,
    );
    // The dropped key still appears (on the original side) so the reader sees
    // it was removed rather than silently missing.
    expect(getByText('"ODSETKI: 388,14"')).toBeInTheDocument();
    expect(getByText('250')).toBeInTheDocument();
  });
});
