// Checks the eval cases against the real index. Needs `npm run index -- --repo ChenglingL/llm-master` first.

import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { openRepo } from "../src/core/repo.ts";
import type { RepoIndex } from "../src/index/types.ts";
import { INDEX_PATH } from "../scripts/paths.ts";
import { loadCases, memoryOf } from "./cases.ts";

const cases = loadCases();
const index: RepoIndex | null = existsSync(INDEX_PATH) ? JSON.parse(readFileSync(INDEX_PATH, "utf8")) : null;

describe("eval cases", () => {
  it("have unique ids", () => {
    const ids = cases.map((c) => c.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("include six Where it's used cases, for the gate", () => {
    expect(cases.filter((c) => c.action === "where-used")).toHaveLength(6);
  });
});

describe.skipIf(!index)("eval cases against the index", () => {
  const repo = index ? openRepo(index) : null;

  it("quote each selection from its section", () => {
    for (const c of cases) {
      const section = repo?.section(c.doc, c.anchor);
      expect(section, `${c.id}: no section ${c.doc}#${c.anchor}`).toBeDefined();
      expect(`${section?.heading}\n${section?.text}`, `${c.id}: selection not in its section`).toContain(c.selection);
    }
  });

  it("only name docs that exist", () => {
    for (const c of cases) {
      for (const doc of [...c.proposed, ...c.expected]) expect(repo?.doc(doc), `${c.id}: unknown doc ${doc}`).toBeDefined();
    }
  });

  it("turn memory sketches into read docs", () => {
    const kv = cases.find((c) => c.id === "explain-kv-quant");
    const memory = kv && repo ? memoryOf(kv.memory, repo) : null;
    expect(memory?.readDocs).toHaveLength(52);
    expect(memory?.readDocs).toContain("docs/llm/app/kv_cache_paged_attention.md");
    expect(memory?.concepts).toEqual([{ term: "FP8", status: "unclear" }]);
  });
});
