// Shapes of data/index.json. From M2 on, each array is one IndexedDB table,
// so records stay plain JSON: strings, numbers, arrays, nested plain objects.

/** doc: a page worth reading and citing. hub: a page of links (roadmap, topic index).
 *  stub: a near-empty page (a redirect, or a pointer to another site). */
export type DocKind = "doc" | "hub" | "stub";

export interface IndexMeta {
  schemaVersion: 1;
  repo: string; // "owner/name"
  ref: string; // branch or tag the index was built from
  commit: string; // SHA of that ref at build time
  builtAt: string; // ISO timestamp
  start: string; // page the reading path starts from
}

/** Table "docs", key `path`. The doc map is this table's `kind: "doc"` rows. */
export interface DocRecord {
  path: string; // repo-relative, e.g. "docs/llm/app/kv_cache_paged_attention.md"
  kind: DocKind;
  title: string; // frontmatter title, else first H1, else file name
  keywords: string[]; // frontmatter, exactly as written
  tags: string[];
  description: string | null;
  chars: number; // length of the whole file
}

/** Table "sections", key `id`, indexed by `doc`. */
export interface SectionRecord {
  id: string; // `${doc}#${anchor}`
  doc: string;
  anchor: string; // GitHub's heading anchor; "" for text before the first heading
  heading: string; // heading as plain text
  level: number; // 1–6; 0 for text before the first heading
  trail: string[]; // parent headings, outermost first
  order: number; // position in the doc, from 0
  text: string; // Markdown under the heading, up to the next heading of any level
}

export interface ConceptRef {
  doc: string;
  mentions: number; // times the term appears in the file
  sections: string[]; // anchors of the sections that mention it
}

/** Table "concepts", key `id`. */
export interface ConceptRecord {
  id: string; // normalized term, e.g. "kv cache"
  term: string; // display spelling, e.g. "KV Cache"
  explains: ConceptRef[]; // docs with the term in their title
  uses: ConceptRef[]; // other docs that mention it
}

/** Table "readingPath", key `path`. */
export interface PathRecord {
  path: string;
  position: number; // from 1
  via: string | null; // hub page that linked it; null if appended after the walk
}

export interface RepoIndex {
  meta: IndexMeta;
  docs: DocRecord[];
  sections: SectionRecord[];
  concepts: ConceptRecord[];
  readingPath: PathRecord[];
}
