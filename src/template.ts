import type { PendingItem } from "./model";

/** Variables usable in all three template layers. */
export const TEMPLATE_VARIABLES = [
  "sourceId",
  "title",
  "url",
  "publishedAt",
  "feedTitle",
  "summary",
  "body",
  "tags",
  "date",
] as const;

/** Raw (unescaped) values for one item; each layer escapes them its own way. */
export interface TemplateSource {
  sourceId: string;
  title: string;
  url: string;
  publishedAt: string;
  feedTitle: string;
  summary: string;
  body: string;
  tags: string[];
  date: string;
}

export const DEFAULT_FILENAME_TEMPLATE = "{{date}} {{title}}";

export const DEFAULT_FRONTMATTER_TEMPLATE = [
  "source_id: {{sourceId}}",
  "title: {{title}}",
  "url: {{url}}",
  "feed: {{feedTitle}}",
  "published: {{publishedAt}}",
  "tags: {{tags}}",
].join("\n");

export const DEFAULT_BODY_TEMPLATE = [
  "# {{title}}",
  "",
  "[元記事を開く]({{url}})",
  "",
  "{{summary}}",
  "",
  "---",
  "",
  "{{body}}",
].join("\n");

/** The frontmatter key that makes an upsert possible; never omitted from a note. */
export const SOURCE_ID_KEY = "source_id";

export const MAX_FILE_NAME_LENGTH = 120;

const PLACEHOLDER = /\{\{\s*([A-Za-z_][A-Za-z0-9_]*)\s*\}\}/g;

// Illegal on Windows/macOS plus the characters that break Obsidian's own links.
const ILLEGAL_FILE_NAME_CHARS = /[\\/:*?"<>|#^[\]]/g;
const CONTROL_CHARS = /[\u0000-\u001f\u007f]/g;
const WINDOWS_RESERVED_NAMES = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/i;
const ISO_DATE_PREFIX = /^(\d{4}-\d{2}-\d{2})/;
/** Matches a top-level `source_id:` key in a rendered frontmatter block. */
const SOURCE_ID_LINE = /^source_id\s*:/;

/**
 * Neutralizes Markdown/Templater syntax a feed item could smuggle into a note:
 * `<`/`>` (also breaks Templater's `<%...%>`), backticks (also breaks code
 * fences and DataviewJS's `` `$= `` inline queries), and `[` (also breaks
 * `![...]` image embeds and `[[...]]` wikilinks, since CommonMark only treats
 * those specially when the leading `[` is unescaped).
 */
function escapeMarkdown(value: string): string {
  return value.replace(/[<>`[]/g, (char) => {
    switch (char) {
      case "<":
        return "&lt;";
      case ">":
        return "&gt;";
      case "`":
        return "\\`";
      default:
        return "\\[";
    }
  });
}

/** A newline in title/url would otherwise split a rendered note mid-line. */
function stripNewlines(value: string): string {
  return value.replace(/[\r\n]+/g, " ").trim();
}

/**
 * Substitutes `{{name}}` placeholders. Unknown names are left verbatim so a
 * typo in a user template is visible in the note instead of silently vanishing.
 */
export function substitute(template: string, resolve: (name: string) => string | null): string {
  return template.replace(PLACEHOLDER, (match, name: string) => resolve(name) ?? match);
}

/**
 * Renders a string as a YAML double-quoted scalar. Always quoting is what keeps
 * a title like `Re: "quoted" / slashed: thing` from corrupting the note: colons,
 * quotes, newlines and leading indicator characters all become inert.
 */
export function yamlQuote(value: string): string {
  let out = '"';
  for (const char of value) {
    const code = char.codePointAt(0) ?? 0;
    if (char === "\\") out += "\\\\";
    else if (char === '"') out += '\\"';
    else if (char === "\n") out += "\\n";
    else if (char === "\r") out += "\\r";
    else if (char === "\t") out += "\\t";
    else if (code < 0x20 || code === 0x7f) out += `\\x${code.toString(16).padStart(2, "0")}`;
    else out += char;
  }
  return `${out}"`;
}

/** Renders tags as a YAML flow sequence, each element quoted. */
export function yamlFlowSequence(values: string[]): string {
  if (values.length === 0) return "[]";
  return `[${values.map(yamlQuote).join(", ")}]`;
}

/**
 * Makes a rendered filename safe on every platform: illegal and control
 * characters collapse to spaces, hidden-file and trailing-dot forms are
 * rejected, Windows device names are escaped, and the result is truncated on a
 * code-point boundary so surrogate pairs are never split.
 */
export function sanitizeFileName(raw: string, maxLength: number = MAX_FILE_NAME_LENGTH): string {
  let name = raw.replace(CONTROL_CHARS, " ").replace(ILLEGAL_FILE_NAME_CHARS, " ");
  name = name.replace(/\s+/g, " ").trim();
  name = name.replace(/^\.+/, "").replace(/[. ]+$/, "").trim();

  const chars = Array.from(name);
  if (chars.length > maxLength) {
    name = chars.slice(0, maxLength).join("").replace(/[. ]+$/, "").trim();
  }
  if (name.length === 0) return "untitled";
  return WINDOWS_RESERVED_NAMES.test(name) ? `_${name}` : name;
}

/**
 * `YYYY-MM-DD` for the `{{date}}` variable. The ISO prefix is preferred over
 * `Date` parsing so a timezone offset can never shift the day. Unparseable
 * timestamps fall back to today, keeping date-prefixed filenames sortable.
 */
export function formatDate(publishedAt: string): string {
  const prefix = ISO_DATE_PREFIX.exec(publishedAt);
  if (prefix?.[1] !== undefined) return prefix[1];

  const parsed = publishedAt.length > 0 ? new Date(publishedAt) : new Date(Number.NaN);
  const date = Number.isNaN(parsed.getTime()) ? new Date() : parsed;
  return date.toISOString().slice(0, 10);
}

export function buildTemplateSource(item: PendingItem): TemplateSource {
  return {
    sourceId: item.sourceId,
    title: stripNewlines(item.title ?? ""),
    url: stripNewlines(item.url),
    publishedAt: item.publishedAt,
    feedTitle: item.feedTitle ?? "",
    summary: item.summary ?? "",
    body: item.body ?? "",
    tags: item.tags,
    date: formatDate(item.publishedAt),
  };
}

function plainValue(source: TemplateSource, name: string): string | null {
  switch (name) {
    case "sourceId":
      return source.sourceId;
    case "title":
      return source.title;
    case "url":
      return source.url;
    case "publishedAt":
      return source.publishedAt;
    case "feedTitle":
      return source.feedTitle;
    case "summary":
      return source.summary;
    case "body":
      return source.body;
    case "date":
      return source.date;
    default:
      return null;
  }
}

/** Filename layer: values inlined raw, then the whole result sanitized once. */
export function renderFileName(template: string, source: TemplateSource): string {
  const rendered = substitute(template, (name) =>
    name === "tags" ? source.tags.join(" ") : plainValue(source, name),
  );
  return sanitizeFileName(rendered);
}

/** Frontmatter layer: every value YAML-escaped, `source_id` guaranteed present. */
export function renderFrontmatter(template: string, source: TemplateSource): string {
  const rendered = substitute(template, (name) => {
    if (name === "tags") return yamlFlowSequence(source.tags);
    const value = plainValue(source, name);
    return value === null ? null : yamlQuote(value);
  });

  // Users edit this template freely, so tolerate stray fences and a deleted
  // source_id rather than emitting a note the next sync cannot recognise.
  const lines = rendered.split("\n").filter((line, index, all) => {
    const isFence = line.trim() === "---";
    return !(isFence && (index === 0 || index === all.length - 1));
  });
  const body = lines.join("\n").trim();

  const hasSourceId = lines.some((line) => SOURCE_ID_LINE.test(line));
  const sourceIdLine = `${SOURCE_ID_KEY}: ${yamlQuote(source.sourceId)}`;
  if (hasSourceId) return body;
  return body.length > 0 ? `${sourceIdLine}\n${body}` : sourceIdLine;
}

/** Body layer: every value Markdown-escaped, since it is embedded verbatim into the note. */
export function renderBody(template: string, source: TemplateSource): string {
  return substitute(template, (name) => {
    if (name === "tags") return source.tags.map(escapeMarkdown).join(", ");
    const value = plainValue(source, name);
    return value === null ? null : escapeMarkdown(value);
  });
}

export function assembleNote(frontmatter: string, body: string): string {
  return `---\n${frontmatter}\n---\n\n${body.trim()}\n`;
}
