import { describe, expect, it } from "vitest";
import { openRepo } from "./repo.ts";
import { snippet, tokenize } from "./search.ts";
import { sampleIndex } from "./testing.ts";

describe("tokenize", () => {
  it("keeps English words and adds Chinese character pairs", () => {
    expect(tokenize("KV Cache量化")).toEqual(["kv", "cache", "量化"]);
    expect(tokenize("前缀缓存")).toEqual(expect.arrayContaining(["前缀", "缀缓", "缓存"]));
  });

  it("drops punctuation and folds full-width letters", () => {
    expect(tokenize("ＲＡＧ，Rerank！")).toEqual(["rag", "rerank"]);
  });
});

describe("repo.search", () => {
  const repo = openRepo(sampleIndex());

  it("ranks the doc whose title explains the concept first", () => {
    const { hits } = repo.search("KV Cache");
    expect(hits[0]?.doc).toBe("docs/app/kv.md");
    expect(hits.map((h) => h.doc)).toContain("docs/app/quant.md");
  });

  it("returns at most one section per doc", () => {
    const docs = repo.search("KV Cache").hits.map((h) => h.doc);
    expect(new Set(docs).size).toBe(docs.length);
  });

  it("finds Chinese terms the segmenter splits into characters", () => {
    expect(repo.search("前缀缓存").hits[0]).toMatchObject({ doc: "docs/app/kv.md", anchor: "前缀缓存" });
  });

  it("only searches content docs", () => {
    const docs = repo.search("KV").hits.map((h) => h.doc);
    expect(docs).not.toContain("docs/roadmap/README.md");
    expect(docs).not.toContain("docs/old.md");
  });

  it("pages through results", () => {
    const first = repo.search("KV Cache", 1);
    expect(first.totalDocs).toBe(2);
    expect(repo.search("KV Cache", 2).hits).toEqual([]);
  });
});

describe("snippet", () => {
  it("centres on the match and strips links", () => {
    const section = {
      id: "d#a", doc: "d", anchor: "a", heading: "h", level: 2, trail: [], order: 0,
      text: `${"前文".repeat(100)} 见 [链接](x.md) 这里讲 Rerank 的作用 ${"后文".repeat(100)}`,
    };
    const text = snippet(section, "rerank");
    expect(text).toContain("Rerank");
    expect(text).toContain("见 链接");
    expect(text.startsWith("…")).toBe(true);
  });
});
