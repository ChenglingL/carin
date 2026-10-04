// Fills each case's `proposed` docs from a text search over the index, keeping comments and
// everything else in the file as written. `expected` is never touched: that list is checked by hand.
//
//   npm run evals:propose

import { readFileSync, writeFileSync } from "node:fs";
import { isSeq, parseDocument } from "yaml";
import { normalizeTerm } from "../src/index/concepts.ts";
import type { Repo } from "../src/core/repo.ts";
import { repo as openIndexedRepo } from "../scripts/runtime.ts";
import { CASES_PATH, loadCases, type EvalCase } from "./cases.ts";

const repo = openIndexedRepo();
const cases = new Map(loadCases().map((c) => [c.id, c]));
const document = parseDocument(readFileSync(CASES_PATH, "utf8"));
if (!isSeq(document.contents)) throw new Error(`${CASES_PATH}: expected a list of cases`);

document.contents.items.forEach((_, i) => {
  const c = cases.get(String(document.getIn([i, "id"])));
  if (!c) return;
  const proposed = propose(c, repo);
  document.setIn([i, "proposed"], document.createNode(proposed));
  console.log(`${c.id.padEnd(28)} ${proposed.length} docs`);
});
writeFileSync(CASES_PATH, document.toString({ lineWidth: 0 }));
console.log(`Updated ${CASES_PATH}`);

function propose(c: EvalCase, repo: Repo): string[] {
  const term = c.concept ?? c.selection;
  const concept = term ? repo.concept(term) : undefined;
  const conceptDocs = concept ? [...concept.explains, ...concept.uses].map((r) => r.doc) : textSearch(term, repo);
  switch (c.action) {
    case "where-used":
      return conceptDocs.filter((doc) => doc !== c.doc);
    case "explain":
    case "example":
      return unique([c.doc, ...(concept?.explains.map((r) => r.doc) ?? [])]);
    case "ask":
      return unique([c.doc, ...repo.search(c.question ?? "").hits.slice(0, 5).map((h) => h.doc)]);
  }
}

/** Content docs that mention the term anywhere, most mentions first. */
function textSearch(term: string, repo: Repo): string[] {
  const needle = normalizeTerm(term);
  if (!needle) return [];
  const counts = new Map<string, number>();
  for (const section of repo.index.sections) {
    if (repo.doc(section.doc)?.kind !== "doc") continue;
    const text = normalizeTerm(`${section.heading}\n${section.text}`);
    const hits = text.split(needle).length - 1;
    if (hits > 0) counts.set(section.doc, (counts.get(section.doc) ?? 0) + hits);
  }
  return [...counts].sort((a, b) => b[1] - a[1]).map(([doc]) => doc);
}

function unique(docs: string[]): string[] {
  return [...new Set(docs)];
}
