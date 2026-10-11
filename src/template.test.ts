import { describe, it, expect } from "bun:test";
import {
  substitute,
  yamlQuote,
  yamlFlowSequence,
  sanitizeFileName,
  formatDate,
  buildTemplateSource,
  renderFileName,
  renderFrontmatter,
  renderBody,
  assembleNote,
} from "./template";
import type { PendingItem } from "./model";

const baseItem: PendingItem = {
  queueId: "q1",
  sourceId: "src-1",
  title: "My Article",
  url: "https://example.com/a",
  publishedAt: "2026-08-26T10:00:00.000Z",
  feedTitle: "Example Feed",
  summary: "A short summary.",
  body: "Full body text.",
  isSaved: false,
  tags: ["ai", "reading"],
};

describe("substitute", () => {
  it("leaves an unknown placeholder verbatim so typos stay visible", () => {
    expect(substitute("{{nope}}", () => null)).toBe("{{nope}}");
  });

  it("replaces every occurrence of a known placeholder", () => {
    expect(substitute("{{a}}-{{a}}", (name) => (name === "a" ? "x" : null))).toBe("x-x");
  });
});

describe("yamlQuote", () => {
  it("escapes quotes, backslashes and control characters", () => {
    expect(yamlQuote('Re: "quoted" / slashed: thing')).toBe('"Re: \\"quoted\\" / slashed: thing"');
    expect(yamlQuote("line1\nline2")).toBe('"line1\\nline2"');
    expect(yamlQuote("back\\slash")).toBe('"back\\\\slash"');
  });
});

describe("yamlFlowSequence", () => {
  it("renders an empty array as []", () => {
    expect(yamlFlowSequence([])).toBe("[]");
  });

  it("quotes every element", () => {
    expect(yamlFlowSequence(["a", "b:c"])).toBe('["a", "b:c"]');
  });
});

describe("sanitizeFileName", () => {
  it("collapses illegal characters to spaces", () => {
    expect(sanitizeFileName('a/b:c*d?e"f<g>h|i#j^k[l]m')).toBe("a b c d e f g h i j k l m");
  });

  it("strips leading dots and trailing dots/spaces", () => {
    expect(sanitizeFileName("...hidden. ")).toBe("hidden");
  });

  it("falls back to untitled when nothing survives sanitization", () => {
    expect(sanitizeFileName("***")).toBe("untitled");
  });

  it("escapes Windows reserved device names", () => {
    expect(sanitizeFileName("CON")).toBe("_CON");
    expect(sanitizeFileName("com1")).toBe("_com1");
  });

  it("truncates on a code-point boundary without splitting surrogate pairs", () => {
    const emoji = "😀".repeat(80); // each is a surrogate pair
    const result = sanitizeFileName(emoji, 10);
    expect(Array.from(result).length).toBeLessThanOrEqual(10);
    expect(result).not.toContain("\uFFFD");
  });
});

describe("formatDate", () => {
  it("prefers the ISO date prefix over Date parsing", () => {
    expect(formatDate("2026-08-26T10:00:00.000Z")).toBe("2026-08-26");
  });

  it("falls back to today for an unparseable timestamp", () => {
    const today = new Date().toISOString().slice(0, 10);
    expect(formatDate("not-a-date")).toBe(today);
  });

  it("falls back to today for an empty timestamp", () => {
    const today = new Date().toISOString().slice(0, 10);
    expect(formatDate("")).toBe(today);
  });
});

describe("buildTemplateSource", () => {
  it("substitutes null title/feedTitle/summary/body with empty strings", () => {
    const source = buildTemplateSource({ ...baseItem, title: null, feedTitle: null, summary: null, body: null });
    expect(source.title).toBe("");
    expect(source.feedTitle).toBe("");
    expect(source.summary).toBe("");
    expect(source.body).toBe("");
  });

  it("collapses newlines in title and url into spaces", () => {
    const source = buildTemplateSource({
      ...baseItem,
      title: "Line one\nLine two\r\nLine three",
      url: "https://example.com/a\nb",
    });
    expect(source.title).toBe("Line one Line two Line three");
    expect(source.url).toBe("https://example.com/a b");
  });
});

describe("renderFileName", () => {
  it("renders and sanitizes in one pass", () => {
    const source = buildTemplateSource(baseItem);
    expect(renderFileName("{{date}} {{title}}", source)).toBe("2026-08-26 My Article");
  });

  it("joins tags with spaces, not commas", () => {
    const source = buildTemplateSource(baseItem);
    expect(renderFileName("{{tags}}", source)).toBe("ai reading");
  });
});

describe("renderFrontmatter", () => {
  it("always includes source_id even when the template omits it", () => {
    const source = buildTemplateSource(baseItem);
    const rendered = renderFrontmatter("title: {{title}}", source);
    expect(rendered).toContain(`source_id: "src-1"`);
    expect(rendered.split("\n")[0]).toBe(`source_id: "src-1"`);
  });

  it("does not duplicate source_id when the template already declares it", () => {
    const source = buildTemplateSource(baseItem);
    const rendered = renderFrontmatter("source_id: {{sourceId}}\ntitle: {{title}}", source);
    const matches = rendered.split("\n").filter((line) => line.startsWith("source_id:"));
    expect(matches).toHaveLength(1);
  });

  it("strips a stray leading/trailing --- fence pasted by the user", () => {
    const source = buildTemplateSource(baseItem);
    const rendered = renderFrontmatter("---\ntitle: {{title}}\n---", source);
    expect(rendered.split("\n")).not.toContain("---");
  });

  it("YAML-escapes a title containing colons and quotes", () => {
    const source = buildTemplateSource({ ...baseItem, title: 'Re: "quoted": thing' });
    const rendered = renderFrontmatter("title: {{title}}", source);
    expect(rendered).toContain('title: "Re: \\"quoted\\": thing"');
  });
});

describe("renderBody", () => {
  it("joins tags with commas, unlike the filename layer", () => {
    const source = buildTemplateSource(baseItem);
    expect(renderBody("{{tags}}", source)).toBe("ai, reading");
  });

  it("inlines values verbatim when they carry no Markdown-special characters", () => {
    const source = buildTemplateSource({ ...baseItem, summary: 'Has "quotes" and: colons' });
    expect(renderBody("{{summary}}", source)).toBe('Has "quotes" and: colons');
  });

  it("escapes HTML/Templater angle brackets", () => {
    const source = buildTemplateSource({ ...baseItem, summary: "<%* tp.file.create_new() %>" });
    expect(renderBody("{{summary}}", source)).toBe("&lt;%* tp.file.create_new() %&gt;");
  });

  it("escapes a code fence so DataviewJS cannot execute", () => {
    const source = buildTemplateSource({ ...baseItem, body: "```dataviewjs\n`$=1+1`\n```" });
    expect(renderBody("{{body}}", source)).toBe("\\`\\`\\`dataviewjs\n\\`$=1+1\\`\n\\`\\`\\`");
  });

  it("escapes image embeds and wikilinks via the leading bracket", () => {
    const source = buildTemplateSource({
      ...baseItem,
      title: "![tracker](https://evil.test/t.png) [[Private Note]]",
    });
    expect(renderBody("{{title}}", source)).toBe(
      "!\\[tracker](https://evil.test/t.png) \\[\\[Private Note]]",
    );
  });
});

describe("assembleNote", () => {
  it("wraps frontmatter in fences and trims the body", () => {
    expect(assembleNote("source_id: \"x\"", "  body text  \n")).toBe(
      '---\nsource_id: "x"\n---\n\nbody text\n',
    );
  });
});
