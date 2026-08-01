/**
 * Parser for the committed `docs/release-notes/<version>.md` files, turning a
 * release-notes Markdown document into the hierarchical structure the "What's
 * New" digest renders: an intro paragraph plus H2 sections, each with optional
 * H3 subsections.
 *
 * The files follow a fixed shape (see `docs/release-notes/README.md`):
 *   # v<version>
 *   <intro paragraph(s)>
 *   ## Section
 *   ### Subsection
 *   ...
 *   ## All Changes
 *   **Full Changelog**: <compare url>
 *
 * Two things are deliberately dropped so the digest stays a readable summary:
 *   - the `## All Changes` section (the raw PR list), and
 *   - the trailing `**Full Changelog**:` compare link (the modal links to the
 *     GitHub release page instead).
 */

/** A single section of release notes (H2) or subsection (H3). */
export interface ReleaseNoteSection {
  /** Heading text with the leading `##`/`###` and any surrounding whitespace removed. */
  heading: string;
  /** Markdown directly under this heading, before any nested subsection. May be empty. */
  body: string;
  /** Nested subsections (H3 under an H2). */
  children: ReleaseNoteSection[];
}

/** The parsed digest for one release. */
export interface ReleaseNotes {
  /** The version these notes describe (without a leading `v`). */
  version: string;
  /** Markdown before the first section heading. */
  intro: string;
  /** Top-level sections (H2), in document order, excluding "All Changes". */
  sections: ReleaseNoteSection[];
  /** Link to the full release notes on GitHub. */
  releaseUrl: string;
}

interface MutableSection {
  heading: string;
  bodyLines: string[];
  children: MutableSection[];
}

const HEADING_RE = /^(#{1,6})\s+(.*)$/;
const FENCE_RE = /^\s*(```|~~~)/;
const FULL_CHANGELOG_RE = /^\s*\*\*full changelog\*\*/i;

/** Remove blank lines from the start and end of a block, keeping inner ones. */
function trimBlankLines(lines: string[]): string {
  let start = 0;
  let end = lines.length;
  while (start < end && lines[start].trim() === "") start++;
  while (end > start && lines[end - 1].trim() === "") end--;
  return lines.slice(start, end).join("\n");
}

function finalizeSection(section: MutableSection): ReleaseNoteSection {
  return {
    heading: section.heading,
    body: trimBlankLines(section.bodyLines),
    children: section.children.map(finalizeSection),
  };
}

/**
 * Parse a release-notes Markdown document into the digest structure.
 *
 * `version` and `releaseUrl` are supplied by the caller rather than derived
 * from the document so the result matches the running app version exactly.
 */
export function parseReleaseNotes(
  markdown: string,
  version: string,
  releaseUrl: string,
): ReleaseNotes {
  const lines = markdown.split(/\r?\n/);

  const introLines: string[] = [];
  const sections: MutableSection[] = [];
  let currentSection: MutableSection | null = null;
  let currentChild: MutableSection | null = null;
  let skippingSection = false;
  let inFence = false;

  const pushBody = (line: string): void => {
    if (skippingSection) return;
    if (currentChild) {
      currentChild.bodyLines.push(line);
    } else if (currentSection) {
      currentSection.bodyLines.push(line);
    } else {
      introLines.push(line);
    }
  };

  for (const line of lines) {
    if (FENCE_RE.test(line)) {
      inFence = !inFence;
      pushBody(line);
      continue;
    }

    const heading = inFence ? null : HEADING_RE.exec(line);
    if (!heading) {
      // Drop the trailing "Full Changelog" compare link; the digest links to
      // the release page instead.
      if (!inFence && FULL_CHANGELOG_RE.test(line)) continue;
      pushBody(line);
      continue;
    }

    const level = heading[1].length;
    const text = heading[2].trim();

    if (level === 1) {
      // The `# v<version>` title line — ignored (version is supplied).
      continue;
    }

    if (level === 2) {
      currentChild = null;
      if (text.toLowerCase() === "all changes") {
        // Exclude the raw PR list from the digest.
        skippingSection = true;
        currentSection = null;
        continue;
      }
      skippingSection = false;
      currentSection = { heading: text, bodyLines: [], children: [] };
      sections.push(currentSection);
      continue;
    }

    if (level === 3 && !skippingSection) {
      const child: MutableSection = {
        heading: text,
        bodyLines: [],
        children: [],
      };
      if (currentSection) {
        currentSection.children.push(child);
        currentChild = child;
      } else {
        // An H3 with no enclosing H2 — promote it to a top-level section so it
        // still appears rather than being silently dropped.
        sections.push(child);
        currentSection = child;
        currentChild = null;
      }
      continue;
    }

    // Level 4+ (or an H3 inside an excluded section): treat as body content so
    // the heading still renders inside its section.
    pushBody(line);
  }

  return {
    version,
    intro: trimBlankLines(introLines),
    sections: sections.map(finalizeSection),
    releaseUrl,
  };
}
