import { githubIssueUrl } from '@/lib/github';

/**
 * Turn bare `#123` references into links to the GitHub issue (or pull request --
 * GitHub redirects one to the other), the way they read on the release page.
 * Release notes credit their issues that way, so in the What's New modal they
 * would otherwise be dead text.
 *
 * Written as a tiny mdast walker rather than pulling in `unist-util-visit`: the
 * nodes it has to skip (code spans, code blocks, existing links, raw HTML) are
 * exactly the ones a generic visitor would have to be told about anyway.
 */

/** Minimal mdast shapes this plugin touches. */
interface TextNode {
  type: 'text';
  value: string;
}

interface LinkNode {
  type: 'link';
  url: string;
  children: MdNode[];
}

interface ParentNode {
  type: string;
  children?: MdNode[];
}

type MdNode = TextNode | LinkNode | ParentNode;

/** Node types whose text must be left exactly as authored. */
const OPAQUE = new Set([
  'code',
  'inlineCode',
  'link',
  'linkReference',
  'definition',
  'image',
  'imageReference',
  'html',
  'yaml',
]);

/**
 * A `#` followed by digits, and not part of a longer token: `#931` matches,
 * `abc#931` and `#93a` do not, so anchors and colour literals are left alone.
 */
const ISSUE_REF = /(^|[^\w#/])#(\d{1,7})(?![\w#])/g;

/**
 * Split a text value into text and link nodes. Returns null when there is
 * nothing to link, so the caller can leave the original node untouched.
 */
export function splitIssueRefs(value: string): MdNode[] | null {
  ISSUE_REF.lastIndex = 0;
  let match = ISSUE_REF.exec(value);
  if (!match) return null;

  const out: MdNode[] = [];
  let cursor = 0;
  while (match) {
    const [whole, lead, digits] = match;
    const refStart = match.index + lead.length;
    if (refStart > cursor) {
      out.push({ type: 'text', value: value.slice(cursor, refStart) });
    }
    out.push({
      type: 'link',
      url: githubIssueUrl(digits),
      children: [{ type: 'text', value: `#${digits}` }],
    });
    cursor = match.index + whole.length;
    match = ISSUE_REF.exec(value);
  }
  if (cursor < value.length) {
    out.push({ type: 'text', value: value.slice(cursor) });
  }
  return out;
}

function transform(node: MdNode): void {
  const parent = node as ParentNode;
  if (!parent.children) return;
  const next: MdNode[] = [];
  let changed = false;
  for (const child of parent.children) {
    if (child.type === 'text') {
      const split = splitIssueRefs((child as TextNode).value);
      if (split) {
        next.push(...split);
        changed = true;
        continue;
      }
    } else if (!OPAQUE.has(child.type)) {
      transform(child);
    }
    next.push(child);
  }
  if (changed) parent.children = next;
}

/** remark plugin: `remarkPlugins={[remarkIssueLinks]}`. */
export function remarkIssueLinks() {
  return (tree: MdNode) => {
    transform(tree);
  };
}
