import { estimateTokens } from "../index/doc-map.ts";
import type { SectionRecord } from "../index/types.ts";
import type { ToolDefinition } from "./model.ts";
import type { Repo } from "./repo.ts";
import { SEARCH_PAGE_SIZE } from "./search.ts";
import type { MemorySlice } from "./types.ts";

export const READ_TOKEN_CAP = 3000;

/** The two tools the agent actions get (docs/PLAN.md § Agent core, "The two tools"). */
export const TOOL_DEFINITIONS: ToolDefinition[] = [
  {
    name: "search_repo",
    description:
      "Keyword search over every section of this repo's docs. Returns up to 8 sections, at most one per doc, best first: " +
      "doc path, section anchor and heading, a short snippet around the match, the doc's place in the reader's path, " +
      "and whether the reader has read it. Chinese and English both work; try the repo's own spellings " +
      '(for example both "KV Cache" and "KV缓存"). Ask for page 2, 3, … to see more docs for the same query.',
    strict: true,
    input_schema: {
      type: "object",
      additionalProperties: false,
      required: ["query", "page"],
      properties: {
        query: { type: "string", description: "A few keywords, not a sentence." },
        page: { type: "integer", description: "1 for the best 8 docs, 2 for the next 8, and so on." },
      },
    },
  },
  {
    name: "read_section",
    description:
      "Returns one section's full text (up to about 3,000 tokens) with its heading trail and subsections. " +
      "Use the doc path and anchor exactly as search_repo returned them.",
    strict: true,
    input_schema: {
      type: "object",
      additionalProperties: false,
      required: ["doc", "anchor"],
      properties: {
        doc: { type: "string", description: "Repo-relative path, e.g. docs/llm/app/kv_cache_paged_attention.md" },
        anchor: { type: "string", description: "The section's anchor, without #" },
      },
    },
  },
];

export interface ToolOutput {
  content: string;
  isError: boolean; // sent back as tool_result.is_error, so the model knows to correct itself
}

export type ToolRunner = (name: string, input: unknown) => Promise<ToolOutput>;

/** Runs the agent's tools against one repo, for one reader. */
export function toolRunner(repo: Repo, memory: MemorySlice): ToolRunner {
  const readDocs = new Set(memory.readDocs);
  const where = (doc: string) => {
    const position = repo.position(doc);
    return `${position === null ? "not on path" : `path #${position}`} · ${readDocs.has(doc) ? "read" : "unread"}`;
  };

  return async (name, input) => {
    const args = (typeof input === "object" && input !== null ? input : {}) as Record<string, unknown>;
    if (name === "search_repo") {
      if (typeof args.query !== "string" || args.query.trim() === "") return error("search_repo needs a non-empty query.");
      const page = typeof args.page === "number" && args.page >= 1 ? Math.floor(args.page) : 1;
      return searchRepo(repo, args.query, page, where);
    }
    if (name === "read_section") {
      if (typeof args.doc !== "string" || typeof args.anchor !== "string") {
        return error("read_section needs doc and anchor strings.");
      }
      return readSection(repo, args.doc, args.anchor, where);
    }
    return error(`Unknown tool "${name}". The tools are search_repo and read_section.`);
  };
}

function searchRepo(repo: Repo, query: string, page: number, where: (doc: string) => string): ToolOutput {
  const result = repo.search(query, page);
  if (result.totalDocs === 0) return ok(`No sections match "${query}". Try other spellings, or fewer words.`);
  const pages = Math.ceil(result.totalDocs / SEARCH_PAGE_SIZE);
  if (result.hits.length === 0) return ok(`"${query}" has ${pages} page(s) of results; page ${page} is empty.`);
  const lines = result.hits.map(
    (hit, i) => `${i + 1}. ${hit.doc}#${hit.anchor} · ${hit.heading} · ${where(hit.doc)}\n   ${hit.snippet}`,
  );
  return ok(`Results for "${query}", page ${page} of ${pages} (${result.totalDocs} docs match):\n${lines.join("\n")}`);
}

function readSection(repo: Repo, doc: string, rawAnchor: string, where: (doc: string) => string): ToolOutput {
  if (!repo.doc(doc)) return error(`Unknown doc "${doc}". Use a path from the doc map or from search_repo.`);
  const section = findSection(repo, doc, rawAnchor);
  if (!section) {
    const anchors = repo.sectionsOf(doc).map((s) => s.anchor);
    return error(
      `No section "${rawAnchor}" in ${doc}. Its anchors: ${anchors.slice(0, 40).join(", ")}${anchors.length > 40 ? ", …" : ""}`,
    );
  }

  const all = repo.sectionsOf(doc);
  const children: string[] = [];
  for (const next of all.slice(section.order + 1)) {
    if (next.level <= section.level) break;
    children.push(next.anchor);
  }
  const header = [
    `${doc}#${section.anchor}`,
    [...section.trail, section.heading].filter((h) => h !== "").join(" › "),
    where(doc),
  ].join("\n");
  const subsections = children.length > 0 ? `\n\nSubsections: ${children.slice(0, 15).join(", ")}` : "";
  return ok(`${header}\n\n${capTokens(section.text || "(No text of its own.)", READ_TOKEN_CAP)}${subsections}`);
}

/** Accepts the anchor as given, with a leading "#", percent-encoded, or as the heading text. */
function findSection(repo: Repo, doc: string, raw: string): SectionRecord | undefined {
  let anchor = raw.trim().replace(/^#/, "");
  try {
    anchor = decodeURIComponent(anchor);
  } catch {
    // keep it as written
  }
  return (
    repo.section(doc, anchor) ??
    repo.section(doc, anchor.toLowerCase()) ??
    repo.sectionsOf(doc).find((s) => s.heading === raw.trim())
  );
}

export function capTokens(text: string, cap: number): string {
  const tokens = estimateTokens(text);
  if (tokens <= cap) return text;
  let end = Math.floor((text.length * cap) / tokens);
  while (end > 0 && estimateTokens(text.slice(0, end)) > cap) end = Math.floor(end * 0.95);
  return `${text.slice(0, end)}\n\n[Truncated at about ${cap.toLocaleString("en")} tokens.]`;
}

const ok = (content: string): ToolOutput => ({ content, isError: false });
const error = (content: string): ToolOutput => ({ content, isError: true });
