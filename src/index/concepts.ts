import { compareStrings } from "./source.ts";
import type { ConceptRecord, ConceptRef } from "./types.ts";

/** What the concept index needs to know about one content doc. */
export interface ConceptDoc {
  path: string;
  titles: string[]; // frontmatter title and H1
  text: string; // the whole file, frontmatter included
  sections: { anchor: string; heading: string; text: string }[];
}

/** One spelling per concept: full-width → half-width (NFKC), lowercase, single spaces. */
export function normalizeTerm(text: string): string {
  return text.normalize("NFKC").toLowerCase().replace(/\s+/g, " ").trim();
}

const ASCII_WORD_CHAR = /[a-z0-9]/;

/**
 * Times `term` occurs in `text`, both normalized. Plain substring matching, which
 * suits Chinese (no spaces between words). One guard: where the term begins or ends
 * with an ASCII letter or digit, the character next to it must not be one, so
 * "rag" doesn't match inside "storage".
 */
export function countTerm(text: string, term: string): number {
  if (term === "") return 0;
  const checkStart = ASCII_WORD_CHAR.test(term[0] ?? "");
  const checkEnd = ASCII_WORD_CHAR.test(term.at(-1) ?? "");
  let count = 0;
  for (let at = text.indexOf(term); at !== -1; at = text.indexOf(term, at + 1)) {
    if (checkStart && ASCII_WORD_CHAR.test(text[at - 1] ?? "")) continue;
    if (checkEnd && ASCII_WORD_CHAR.test(text[at + term.length] ?? "")) continue;
    count++;
  }
  return count;
}

/**
 * Builds the concept index from frontmatter keywords (`seeds`).
 * A doc explains a concept when the term is in its title, and uses it when
 * the term appears anywhere else in the file. Each doc lands in one list only.
 */
export function buildConcepts(seeds: string[], docs: ConceptDoc[]): ConceptRecord[] {
  const spellings = groupSpellings(seeds);
  const prepared = docs.map((doc) => ({
    path: doc.path,
    titles: doc.titles.map(normalizeTerm),
    text: normalizeTerm(doc.text),
    sections: doc.sections.map((s) => ({ anchor: s.anchor, text: normalizeTerm(`${s.heading}\n${s.text}`) })),
  }));

  const concepts: ConceptRecord[] = [];
  for (const [id, term] of spellings) {
    const explains: ConceptRef[] = [];
    const uses: ConceptRef[] = [];
    for (const doc of prepared) {
      const mentions = countTerm(doc.text, id);
      if (mentions === 0) continue;
      const sections = doc.sections.filter((s) => countTerm(s.text, id) > 0).map((s) => s.anchor);
      const ref = { doc: doc.path, mentions, sections };
      if (doc.titles.some((title) => countTerm(title, id) > 0)) explains.push(ref);
      else uses.push(ref);
    }
    if (explains.length + uses.length === 0) continue;
    concepts.push({ id, term, explains: explains.sort(byMentions), uses: uses.sort(byMentions) });
  }
  return concepts.sort((a, b) => compareStrings(a.id, b.id));
}

/** Normalized id → the spelling used most often in frontmatter (first seen wins a tie). */
function groupSpellings(seeds: string[]): Map<string, string> {
  const counts = new Map<string, Map<string, number>>();
  for (const seed of seeds) {
    const id = normalizeTerm(seed);
    if (id === "") continue;
    const forId = counts.get(id) ?? new Map<string, number>();
    forId.set(seed.trim(), (forId.get(seed.trim()) ?? 0) + 1);
    counts.set(id, forId);
  }
  const result = new Map<string, string>();
  for (const [id, forId] of counts) {
    let best = "";
    let bestCount = 0;
    for (const [spelling, count] of forId) {
      if (count > bestCount) [best, bestCount] = [spelling, count];
    }
    result.set(id, best);
  }
  return result;
}

function byMentions(a: ConceptRef, b: ConceptRef): number {
  return b.mentions - a.mentions || compareStrings(a.doc, b.doc);
}
