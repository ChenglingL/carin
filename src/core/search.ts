import MiniSearch from "minisearch";
import { countTerm, normalizeTerm } from "../index/concepts.ts";
import type { ConceptRecord, RepoIndex, SectionRecord } from "../index/types.ts";

export const SEARCH_PAGE_SIZE = 8;
// A section the concept index lists for a term in the query gets its score multiplied by these.
export const EXPLAINS_BOOST = 2;
export const USES_BOOST = 1.5;

export interface SearchHit {
  doc: string;
  anchor: string;
  heading: string;
  snippet: string; // about 200 characters around the first match
  score: number;
}

export interface SearchPage {
  hits: SearchHit[]; // one best section per doc, best first
  page: number;
  totalDocs: number; // docs with any match, across all pages
}

const segmenter = new Intl.Segmenter("zh", { granularity: "word" });
const HAN = /^[㐀-䶿一-鿿豈-﫿]+$/;

/**
 * Search terms for Chinese and English text.
 * Intl.Segmenter splits words; its dictionary misses domain terms, so 前缀缓存 comes back
 * as four single characters. Runs of Chinese characters are therefore also indexed as
 * overlapping pairs (前缀, 缀缓, 缓存), which matches unknown terms without a custom dictionary.
 */
export function tokenize(text: string): string[] {
  const tokens: string[] = [];
  let run = "";
  const flush = () => {
    if (run.length === 1) tokens.push(run);
    for (let i = 0; i + 2 <= run.length; i++) tokens.push(run.slice(i, i + 2));
    run = "";
  };
  for (const { segment, isWordLike } of segmenter.segment(normalizeTerm(text))) {
    if (isWordLike && HAN.test(segment)) {
      if (segment.length > 2) tokens.push(segment); // a dictionary word longer than a pair
      run += segment;
      continue;
    }
    flush();
    if (isWordLike) tokens.push(segment);
  }
  flush();
  return tokens;
}

/** Keyword search over content-doc sections, boosted by the concept index. */
export function createSearch(index: RepoIndex): (query: string, page?: number) => SearchPage {
  const contentDocs = new Set(index.docs.filter((d) => d.kind === "doc").map((d) => d.path));
  const sections = index.sections.filter((s) => contentDocs.has(s.doc));
  const byId = new Map(sections.map((s) => [s.id, s]));

  const mini = new MiniSearch<SectionRecord>({
    idField: "id",
    fields: ["heading", "text"],
    tokenize,
    processTerm: (term) => term, // tokenize already normalized it
    searchOptions: { boost: { heading: 2 } },
  });
  mini.addAll(sections);

  return (query, page = 1) => {
    const boosts = conceptBoosts(index.concepts, query);
    const bestPerDoc = new Map<string, { section: SectionRecord; score: number }>();
    for (const result of mini.search(query)) {
      const section = byId.get(String(result.id));
      if (!section) continue;
      const score = result.score * (boosts.get(section.id) ?? 1);
      const best = bestPerDoc.get(section.doc);
      if (!best || score > best.score) bestPerDoc.set(section.doc, { section, score });
    }
    const ranked = [...bestPerDoc.values()].sort((a, b) => b.score - a.score);
    const start = (Math.max(1, page) - 1) * SEARCH_PAGE_SIZE;
    return {
      hits: ranked.slice(start, start + SEARCH_PAGE_SIZE).map(({ section, score }) => ({
        doc: section.doc,
        anchor: section.anchor,
        heading: section.heading,
        snippet: snippet(section, query),
        score: Math.round(score * 100) / 100,
      })),
      page: Math.max(1, page),
      totalDocs: ranked.length,
    };
  };
}

/** Section id → boost, for sections the concept index lists under a term found in the query. */
function conceptBoosts(concepts: readonly ConceptRecord[], query: string): Map<string, number> {
  const normalized = normalizeTerm(query);
  const boosts = new Map<string, number>();
  for (const concept of concepts) {
    if (concept.id.length < 2 || countTerm(normalized, concept.id) === 0) continue;
    const lists: [ConceptRecord["explains"], number][] = [
      [concept.explains, EXPLAINS_BOOST],
      [concept.uses, USES_BOOST],
    ];
    for (const [refs, factor] of lists) {
      for (const ref of refs) {
        for (const anchor of ref.sections) {
          const id = `${ref.doc}#${anchor}`;
          boosts.set(id, Math.max(boosts.get(id) ?? 1, factor));
        }
      }
    }
  }
  return boosts;
}

/** About 200 characters of plain text around the first place the query (or one of its terms) appears. */
export function snippet(section: SectionRecord, query: string, length = 200): string {
  const text = section.text
    .replace(/<[^>]+>/g, "")
    .replace(/!\[[^\]]*\]\([^)]*\)/g, "")
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/\s+/g, " ")
    .trim();
  const lower = text.toLowerCase();
  const needles = [normalizeTerm(query), ...tokenize(query).sort((a, b) => b.length - a.length)];
  const found = needles.map((n) => lower.indexOf(n)).find((at) => at >= 0) ?? 0;
  const start = Math.max(0, found - 60);
  const piece = text.slice(start, start + length);
  return `${start > 0 ? "…" : ""}${piece}${start + length < text.length ? "…" : ""}`;
}
