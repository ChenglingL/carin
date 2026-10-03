// The M0 gate, checked on the real index. Needs `npm run index -- --repo ChenglingL/llm-master` first.

import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { estimateTokens, renderDocMap } from "../src/index/doc-map.ts";
import { splitFrontmatter } from "../src/index/frontmatter.ts";
import { cleanBody, extractLinks } from "../src/index/markdown.ts";
import { unzipMarkdown } from "../src/index/source.ts";
import type { RepoIndex } from "../src/index/types.ts";
import { INDEX_PATH, zipCachePath } from "./paths.ts";

const index: RepoIndex | null = existsSync(INDEX_PATH) ? JSON.parse(readFileSync(INDEX_PATH, "utf8")) : null;
const zipPath = index ? zipCachePath(index.meta.repo, index.meta.commit) : null;
const files = zipPath && existsSync(zipPath) ? unzipMarkdown(new Uint8Array(readFileSync(zipPath))) : null;
const ready = index !== null && files !== null;
if (!ready) console.warn("M0 gate skipped: run `npm run index -- --repo ChenglingL/llm-master` first.");

// A skipped describe body still runs while Vitest collects tests, so nothing here may assume the index exists.
describe.skipIf(!ready)("M0 gate on the built index", () => {
  const idx = index ?? ({ docs: [], sections: [], concepts: [], readingPath: [] } as unknown as RepoIndex);
  const repoFiles = files ?? [];
  const contentDocs = new Set(idx.docs.filter((d) => d.kind === "doc").map((d) => d.path));

  it("doc map is about 15K tokens", () => {
    const tokens = estimateTokens(renderDocMap(idx.docs, idx.readingPath));
    expect(tokens).toBeGreaterThan(12_000);
    expect(tokens).toBeLessThan(18_000);
  });

  it("KV Cache entry lists the docs a plain text search finds", () => {
    // The search: every content doc whose file contains "kv cache", any case.
    const found = repoFiles
      .filter((f) => contentDocs.has(f.path) && f.text.toLowerCase().includes("kv cache"))
      .map((f) => f.path)
      .sort();
    const entry = idx.concepts.find((c) => c.id === "kv cache");
    expect(entry, "no KV Cache concept").toBeDefined();
    const listed = [...(entry?.explains ?? []), ...(entry?.uses ?? [])].map((r) => r.doc).sort();

    expect(found.length).toBeGreaterThanOrEqual(10);
    expect(listed).toEqual(found);
    expect(entry?.explains.map((r) => r.doc)).toContain("docs/llm/app/kv_cache_paged_attention.md");
  });

  // Links in llm-master that are broken on GitHub too (checked against GitHub's rendered HTML, Oct 2026):
  // - "#_1-…" anchors are the repo website's style (VuePress puts "_" before a leading digit); GitHub doesn't.
  // - a table-of-contents entry for a heading that has since been renamed.
  const brokenOnGitHub = (target: string, anchor: string) =>
    /^_\d/.test(anchor) || `${target}#${anchor}` === "docs/llm/intro/llm_pricing.md#10-怎么选给你一个决策公式";

  it("every in-repo heading link points at an indexed section", () => {
    const sectionIds = new Set(idx.sections.map((s) => s.id));
    const paths = new Set(repoFiles.map((f) => f.path));
    const broken: string[] = [];
    let checked = 0;
    for (const file of repoFiles) {
      const body = cleanBody(splitFrontmatter(file.text).body);
      for (const link of extractLinks(file.path, body)) {
        if (link.anchor === null || !paths.has(link.target) || brokenOnGitHub(link.target, link.anchor)) continue;
        checked++;
        if (!sectionIds.has(`${link.target}#${link.anchor.toLowerCase()}`)) {
          broken.push(`${file.path} → ${link.target}#${link.anchor}`);
        }
      }
    }
    expect(checked).toBeGreaterThan(50);
    expect(broken).toEqual([]);
  });
});
