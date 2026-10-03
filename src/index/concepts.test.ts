import { describe, expect, it } from "vitest";
import { buildConcepts, countTerm, normalizeTerm, type ConceptDoc } from "./concepts.ts";

describe("normalizeTerm", () => {
  it("folds case, full-width characters and whitespace", () => {
    expect(normalizeTerm("  ＫＶ   Cache ")).toBe("kv cache");
  });
});

describe("countTerm", () => {
  it("matches inside Chinese text without word boundaries", () => {
    expect(countTerm("什么是前缀缓存？前缀缓存省prefill", "前缀缓存")).toBe(2);
    expect(countTerm(normalizeTerm("KV Cache量化"), "kv cache")).toBe(1);
  });

  it("won't match an ASCII term glued to other letters or digits", () => {
    expect(countTerm("storage and drag", "rag")).toBe(0);
    expect(countTerm("rag系统, (rag), rag.", "rag")).toBe(3);
    expect(countTerm("fp8 fp16", "fp1")).toBe(0);
  });

  it("only checks the edges that are ASCII letters or digits", () => {
    expect(countTerm("use c++17", "c++")).toBe(1);
  });
});

describe("buildConcepts", () => {
  const doc = (path: string, title: string, text: string): ConceptDoc => ({
    path,
    titles: [title],
    text: `# ${title}\n${text}`,
    sections: [
      { anchor: "intro", heading: title, text },
      { anchor: "more", heading: "More", text: "nothing here" },
    ],
  });

  const docs = [
    doc("a.md", "KV Cache 是什么", "KV Cache 保存 K 和 V。"),
    doc("b.md", "量化", "也可以量化 kv cache，kv cache 会变小。"),
    doc("c.md", "无关", "这里不提那个词。"),
  ];

  it("puts title matches in explains and other mentions in uses", () => {
    const [kv] = buildConcepts(["KV Cache"], docs);
    expect(kv?.explains.map((r) => r.doc)).toEqual(["a.md"]);
    expect(kv?.uses).toEqual([{ doc: "b.md", mentions: 2, sections: ["intro"] }]);
  });

  it("merges spellings and shows the most common one", () => {
    const concepts = buildConcepts(["kv cache", "KV Cache", "KV Cache"], docs);
    expect(concepts.map((c) => [c.id, c.term])).toEqual([["kv cache", "KV Cache"]]);
  });

  it("drops keywords no content doc mentions", () => {
    expect(buildConcepts(["PagedAttention"], docs)).toEqual([]);
  });

  it("sorts each list by mentions, most first", () => {
    const [concept] = buildConcepts(["缓存"], [doc("x.md", "一", "缓存"), doc("y.md", "二", "缓存 缓存 缓存")]);
    expect(concept?.uses.map((r) => r.doc)).toEqual(["y.md", "x.md"]);
  });
});
