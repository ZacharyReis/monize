import { describe, it, expect } from 'vitest';
import { splitIssueRefs, remarkIssueLinks } from './remark-issue-links';

interface Node {
  type: string;
  value?: string;
  url?: string;
  children?: Node[];
}

function text(value: string): Node {
  return { type: 'text', value };
}

describe('splitIssueRefs', () => {
  it('leaves text without a reference alone', () => {
    expect(splitIssueRefs('Nothing to link here.')).toBeNull();
    expect(splitIssueRefs('A #fff colour and issue#7 are not refs')).toBeNull();
  });

  it('links a single reference and keeps the surrounding text', () => {
    const parts = splitIssueRefs('Fixed the thing. (#931)');
    expect(parts).toEqual([
      { type: 'text', value: 'Fixed the thing. (' },
      {
        type: 'link',
        url: 'https://github.com/kenlasko/monize/issues/931',
        children: [{ type: 'text', value: '#931' }],
      },
      { type: 'text', value: ')' },
    ]);
  });

  it('links every reference in a list', () => {
    const parts = splitIssueRefs('(#931, #933)')!;
    const links = parts.filter((p) => p.type === 'link') as {
      url: string;
    }[];
    expect(links.map((l) => l.url)).toEqual([
      'https://github.com/kenlasko/monize/issues/931',
      'https://github.com/kenlasko/monize/issues/933',
    ]);
  });
});

describe('remarkIssueLinks', () => {
  const run = (tree: Node) => {
    remarkIssueLinks()(tree);
    return tree;
  };

  it('rewrites text nodes nested in paragraphs and lists', () => {
    const tree = run({
      type: 'root',
      children: [
        {
          type: 'paragraph',
          children: [text('See '), { type: 'strong', children: [text('#42')] }],
        },
      ],
    });
    const strong = tree.children![0].children![1];
    expect(strong.children![0]).toEqual({
      type: 'link',
      url: 'https://github.com/kenlasko/monize/issues/42',
      children: [{ type: 'text', value: '#42' }],
    });
  });

  it('leaves code, existing links and raw HTML untouched', () => {
    const tree = run({
      type: 'root',
      children: [
        { type: 'inlineCode', value: 'grep #931' },
        {
          type: 'link',
          url: 'https://example.test/#931',
          children: [text('#931')],
        },
        { type: 'html', value: '<a name="#931"></a>' },
      ],
    });
    expect(tree.children![0]).toEqual({
      type: 'inlineCode',
      value: 'grep #931',
    });
    // The link's own label is left as text, not nested into another link.
    expect(tree.children![1].children).toEqual([
      { type: 'text', value: '#931' },
    ]);
    expect(tree.children![2].value).toBe('<a name="#931"></a>');
  });
});
