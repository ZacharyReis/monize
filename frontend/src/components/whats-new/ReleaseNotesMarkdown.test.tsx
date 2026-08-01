import { describe, it, expect } from 'vitest';
import { render, screen } from '@/test/render';
import { ReleaseNotesMarkdown } from './ReleaseNotesMarkdown';

describe('ReleaseNotesMarkdown', () => {
  it('renders nothing for empty content', () => {
    const { container } = render(<ReleaseNotesMarkdown content="" />);
    expect(container).toBeEmptyDOMElement();
  });

  it('links the issue references the notes credit changes with', () => {
    render(<ReleaseNotesMarkdown content="Foreign currency landed. (#931, #933)" />);

    const first = screen.getByRole('link', { name: '#931' });
    expect(first).toHaveAttribute(
      'href',
      'https://github.com/kenlasko/monize/issues/931',
    );
    expect(first).toHaveAttribute('target', '_blank');
    expect(screen.getByRole('link', { name: '#933' })).toHaveAttribute(
      'href',
      'https://github.com/kenlasko/monize/issues/933',
    );
  });

  it('leaves references inside code spans as text', () => {
    render(<ReleaseNotesMarkdown content="Run `git log --grep #931` first." />);
    expect(screen.queryByRole('link')).toBeNull();
  });
});
