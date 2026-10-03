import { parse } from "yaml";

export interface Frontmatter {
  title: string | null;
  keywords: string[];
  tags: string[];
  description: string | null;
}

export interface SplitDoc {
  frontmatter: Frontmatter | null;
  body: string; // everything after the frontmatter block
  warning: string | null; // set when a frontmatter block exists but isn't valid YAML
}

const BLOCK = /^---[ \t]*\n([\s\S]*?)\n---[ \t]*(?:\n|$)/;

/** Separates the YAML frontmatter from the Markdown body and reads the fields the index uses. */
export function splitFrontmatter(text: string): SplitDoc {
  const match = BLOCK.exec(text);
  if (!match) return { frontmatter: null, body: text, warning: null };
  const body = text.slice(match[0].length);

  let data: unknown;
  try {
    data = parse(match[1] ?? "");
  } catch (error) {
    return { frontmatter: null, body, warning: `invalid frontmatter YAML: ${(error as Error).message}` };
  }
  if (data === null || typeof data !== "object" || Array.isArray(data)) {
    return { frontmatter: null, body, warning: "frontmatter is not a YAML mapping" };
  }

  const fields = data as Record<string, unknown>;
  return {
    frontmatter: {
      title: asText(fields.title),
      keywords: asList(fields.keywords),
      tags: asList(fields.tags),
      description: asText(fields.description),
    },
    body,
    warning: null,
  };
}

function asText(value: unknown): string | null {
  if (typeof value === "string") return value.trim() || null;
  if (typeof value === "number") return String(value);
  return null;
}

/** Accepts a YAML list (inline or block) or a comma-separated string. */
function asList(value: unknown): string[] {
  const items = Array.isArray(value) ? value : typeof value === "string" ? value.split(/[,，]/) : [];
  return items
    .filter((item) => typeof item === "string" || typeof item === "number")
    .map((item) => String(item).trim())
    .filter((item) => item !== "");
}
