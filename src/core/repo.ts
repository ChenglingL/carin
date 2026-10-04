import { normalizeTerm } from "../index/concepts.ts";
import { renderDocMap } from "../index/doc-map.ts";
import type { ConceptRecord, DocRecord, RepoIndex, SectionRecord } from "../index/types.ts";
import { createSearch, type SearchPage } from "./search.ts";

/** The repo index with lookups. One per repo; the agent core reads everything through it. */
export interface Repo {
  index: RepoIndex;
  name: string; // "owner/name"
  docMap: string; // rendered once; the stable part of every prompt
  doc(path: string): DocRecord | undefined;
  section(doc: string, anchor: string): SectionRecord | undefined;
  sectionsOf(doc: string): SectionRecord[]; // in document order
  concept(term: string): ConceptRecord | undefined; // any spelling: "KV Cache", "kv cache"
  position(path: string): number | null; // place on the reading path, from 1
  search(query: string, page?: number): SearchPage;
  url(doc: string, anchor?: string): string; // github.com link at the indexed commit
}

export function openRepo(index: RepoIndex): Repo {
  const docs = new Map(index.docs.map((d) => [d.path, d]));
  const sections = new Map(index.sections.map((s) => [s.id, s]));
  const sectionsByDoc = new Map<string, SectionRecord[]>();
  for (const section of index.sections) {
    const list = sectionsByDoc.get(section.doc) ?? [];
    list.push(section);
    sectionsByDoc.set(section.doc, list);
  }
  const concepts = new Map(index.concepts.map((c) => [c.id, c]));
  const positions = new Map(index.readingPath.map((r) => [r.path, r.position]));
  let search: ((query: string, page?: number) => SearchPage) | null = null; // built on first use

  return {
    index,
    name: index.meta.repo,
    docMap: renderDocMap(index.docs, index.readingPath),
    doc: (path) => docs.get(path),
    section: (doc, anchor) => sections.get(`${doc}#${anchor}`),
    sectionsOf: (doc) => sectionsByDoc.get(doc) ?? [],
    concept: (term) => concepts.get(normalizeTerm(term)),
    position: (path) => positions.get(path) ?? null,
    search(query, page) {
      search ??= createSearch(index);
      return search(query, page);
    },
    url: (doc, anchor) =>
      `https://github.com/${index.meta.repo}/blob/${index.meta.commit}/${encodeURI(doc)}${anchor ? `#${encodeURIComponent(anchor)}` : ""}`,
  };
}
