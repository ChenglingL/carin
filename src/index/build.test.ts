import { describe, expect, it } from "vitest";
import { buildIndex } from "./build.ts";
import type { RepoSnapshot } from "./source.ts";

const article = (title: string, keywords: string, text: string) =>
  `---\ntitle: ${title}\nkeywords: [${keywords}]\n---\n\n# ${title}\n\n${"正文内容。".repeat(80)}\n\n## 小结\n\n${text}\n`;

const snapshot: RepoSnapshot = {
  repo: "owner/repo",
  ref: "main",
  commit: "abc123",
  files: [
    { path: "README.md", text: "# Repo\n\nSee the [roadmap](docs/roadmap/) and [topics](docs/topics.md).\n" + "介绍。".repeat(150) },
    { path: "docs/roadmap/README.md", text: "# 路线\n\n1. [缓存](../app/cache.md)\n2. [量化](../app/quant.md)\n3. [专题](../topics.md)\n" },
    { path: "docs/topics.md", text: "# 专题\n\n- [量化](app/quant.md)\n- [旧文](old.md)\n- [部署](app/deploy.md#小结)\n" },
    { path: "docs/app/cache.md", text: article("KV Cache 详解", "KV Cache, Prefill", "Prefill 之后写入 KV Cache。") },
    { path: "docs/app/quant.md", text: article("模型量化", "量化", "KV Cache 也能量化。") },
    { path: "docs/app/deploy.md", text: article("部署", "部署", "上线。") },
    { path: "docs/old.md", text: "# 已迁移\n\n见 [新文](app/cache.md)\n" },
  ],
};

describe("buildIndex", () => {
  const { index, warnings } = buildIndex(snapshot, { builtAt: "2026-10-02T00:00:00.000Z" });
  const kindOf = (path: string) => index.docs.find((d) => d.path === path)?.kind;

  it("classifies pages and finds the roadmap", () => {
    expect(index.meta).toMatchObject({ repo: "owner/repo", commit: "abc123", start: "docs/roadmap/README.md" });
    expect(kindOf("docs/roadmap/README.md")).toBe("hub");
    expect(kindOf("docs/topics.md")).toBe("hub");
    expect(kindOf("docs/old.md")).toBe("stub");
    expect(kindOf("docs/app/cache.md")).toBe("doc");
    expect(kindOf("README.md")).toBe("doc");
    expect(warnings).toEqual([]);
  });

  it("takes titles from frontmatter, then the H1", () => {
    expect(index.docs.find((d) => d.path === "docs/app/cache.md")?.title).toBe("KV Cache 详解");
    expect(index.docs.find((d) => d.path === "docs/topics.md")?.title).toBe("专题");
  });

  it("keys sections by doc and anchor", () => {
    const ids = index.sections.filter((s) => s.doc === "docs/app/deploy.md").map((s) => s.id);
    expect(ids).toEqual(["docs/app/deploy.md#部署", "docs/app/deploy.md#小结"]);
  });

  it("orders the reading path by the roadmap, then the rest", () => {
    expect(index.readingPath.map((r) => r.path)).toEqual([
      "docs/app/cache.md",
      "docs/app/quant.md",
      "docs/app/deploy.md",
      "README.md",
    ]);
  });

  it("builds explains and uses from content docs only", () => {
    const kv = index.concepts.find((c) => c.id === "kv cache");
    expect(kv?.explains.map((r) => r.doc)).toEqual(["docs/app/cache.md"]);
    expect(kv?.uses.map((r) => r.doc)).toEqual(["docs/app/quant.md"]);
  });

  it("is reproducible", () => {
    expect(buildIndex(snapshot, { builtAt: "2026-10-02T00:00:00.000Z" }).index).toEqual(index);
  });
});
