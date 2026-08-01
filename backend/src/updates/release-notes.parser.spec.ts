import { parseReleaseNotes } from "./release-notes.parser";

const RELEASE_URL = "https://github.com/kenlasko/monize/releases/tag/v1.2.3";

describe("parseReleaseNotes", () => {
  it("extracts the intro paragraph before the first section", () => {
    const md = [
      "# v1.2.3",
      "",
      "A big release with lots of goodies.",
      "",
      "## Loans",
      "",
      "Some loan content.",
    ].join("\n");

    const notes = parseReleaseNotes(md, "1.2.3", RELEASE_URL);

    expect(notes.version).toBe("1.2.3");
    expect(notes.releaseUrl).toBe(RELEASE_URL);
    expect(notes.intro).toBe("A big release with lots of goodies.");
  });

  it("ignores the H1 title line (version comes from the caller)", () => {
    const md = ["# v9.9.9", "", "Intro.", "", "## Section", "", "Body."].join(
      "\n",
    );

    const notes = parseReleaseNotes(md, "1.2.3", RELEASE_URL);

    expect(notes.intro).toBe("Intro.");
    expect(notes.intro).not.toContain("9.9.9");
  });

  it("builds H2 sections with nested H3 subsections", () => {
    const md = [
      "# v1.2.3",
      "",
      "Intro.",
      "",
      "## Loans & Mortgages",
      "",
      "Section lead paragraph.",
      "",
      "### Goal seek",
      "",
      "Detail about goal seek.",
      "",
      "### Comparison chart",
      "",
      "Detail about the chart.",
      "",
      "## Transactions",
      "",
      "Only a lead, no subsections.",
    ].join("\n");

    const notes = parseReleaseNotes(md, "1.2.3", RELEASE_URL);

    expect(notes.sections).toHaveLength(2);

    const loans = notes.sections[0];
    expect(loans.heading).toBe("Loans & Mortgages");
    expect(loans.body).toBe("Section lead paragraph.");
    expect(loans.children).toHaveLength(2);
    expect(loans.children[0].heading).toBe("Goal seek");
    expect(loans.children[0].body).toBe("Detail about goal seek.");
    expect(loans.children[1].heading).toBe("Comparison chart");

    const transactions = notes.sections[1];
    expect(transactions.heading).toBe("Transactions");
    expect(transactions.body).toBe("Only a lead, no subsections.");
    expect(transactions.children).toHaveLength(0);
  });

  it("excludes the 'All Changes' section (case-insensitive)", () => {
    const md = [
      "# v1.2.3",
      "",
      "Intro.",
      "",
      "## Features",
      "",
      "A feature.",
      "",
      "## all changes",
      "* PR one by @a",
      "* PR two by @b",
    ].join("\n");

    const notes = parseReleaseNotes(md, "1.2.3", RELEASE_URL);

    expect(notes.sections).toHaveLength(1);
    expect(notes.sections[0].heading).toBe("Features");
    expect(JSON.stringify(notes)).not.toContain("PR one");
  });

  it("resumes normal sections after an excluded All Changes section", () => {
    const md = [
      "## All Changes",
      "* PR by @a",
      "## Afterword",
      "",
      "Still shown.",
    ].join("\n");

    const notes = parseReleaseNotes(md, "1.2.3", RELEASE_URL);

    expect(notes.sections.map((s) => s.heading)).toEqual(["Afterword"]);
    expect(notes.sections[0].body).toBe("Still shown.");
  });

  it("strips the trailing Full Changelog compare link", () => {
    const md = [
      "# v1.2.3",
      "",
      "Intro.",
      "",
      "## Changes",
      "",
      "- Did a thing.",
      "",
      "**Full Changelog**: https://github.com/kenlasko/monize/compare/v1.2.2...v1.2.3",
    ].join("\n");

    const notes = parseReleaseNotes(md, "1.2.3", RELEASE_URL);

    expect(JSON.stringify(notes)).not.toContain("Full Changelog");
    expect(notes.sections[0].body).toBe("- Did a thing.");
  });

  it("handles a tiny maintenance release", () => {
    const md = [
      "# v1.9.15",
      "",
      "A maintenance release with no user-facing changes.",
      "",
      "## Changes",
      "",
      "- Updated the container build script for the new DNS domain.",
      "",
      "**Full Changelog**: https://github.com/kenlasko/monize/compare/v1.9.14...v1.9.15",
    ].join("\n");

    const notes = parseReleaseNotes(md, "1.9.15", RELEASE_URL);

    expect(notes.intro).toBe(
      "A maintenance release with no user-facing changes.",
    );
    expect(notes.sections).toHaveLength(1);
    expect(notes.sections[0].heading).toBe("Changes");
    expect(notes.sections[0].children).toHaveLength(0);
  });

  it("does not treat '#' inside a fenced code block as a heading", () => {
    const md = [
      "# v1.2.3",
      "",
      "Intro.",
      "",
      "## Config",
      "",
      "```sh",
      "# this is a shell comment, not a heading",
      "## neither is this",
      "```",
    ].join("\n");

    const notes = parseReleaseNotes(md, "1.2.3", RELEASE_URL);

    expect(notes.sections).toHaveLength(1);
    expect(notes.sections[0].heading).toBe("Config");
    expect(notes.sections[0].body).toContain("# this is a shell comment");
    expect(notes.sections[0].body).toContain("## neither is this");
  });

  it("promotes an orphan H3 (no enclosing H2) to a top-level section", () => {
    const md = ["Intro.", "", "### Lonely", "", "Body."].join("\n");

    const notes = parseReleaseNotes(md, "1.2.3", RELEASE_URL);

    expect(notes.intro).toBe("Intro.");
    expect(notes.sections).toHaveLength(1);
    expect(notes.sections[0].heading).toBe("Lonely");
    expect(notes.sections[0].body).toBe("Body.");
  });

  it("keeps H4+ headings as part of the section body", () => {
    const md = ["## Section", "", "#### Deep heading", "", "Deep body."].join(
      "\n",
    );

    const notes = parseReleaseNotes(md, "1.2.3", RELEASE_URL);

    expect(notes.sections).toHaveLength(1);
    expect(notes.sections[0].body).toContain("#### Deep heading");
    expect(notes.sections[0].body).toContain("Deep body.");
  });

  it("returns empty intro and sections for an empty document", () => {
    const notes = parseReleaseNotes("", "1.2.3", RELEASE_URL);

    expect(notes.intro).toBe("");
    expect(notes.sections).toHaveLength(0);
  });
});
