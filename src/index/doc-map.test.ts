import { describe, expect, it } from "vitest";
import { estimateTokens, renderDocMap } from "./doc-map.ts";
import type { DocRecord } from "./types.ts";

const record = (path: string, kind: DocRecord["kind"], title: string, keywords: string[]): DocRecord => ({
  path,
  kind,
  title,
  keywords,
  tags: [],
  description: null,
  chars: 0,
});

describe("renderDocMap", () => {
  it("lists content docs in reading-path order, one line each", () => {
    const docs = [
      record("a.md", "doc", "第一篇", ["KV Cache", "显存"]),
      record("b.md", "doc", "第二篇", []),
      record("hub.md", "hub", "路线", ["路线"]),
    ];
    const path = [
      { path: "b.md", position: 1, via: "hub.md" },
      { path: "a.md", position: 2, via: "hub.md" },
    ];
    expect(renderDocMap(docs, path)).toBe("b.md | 第二篇\na.md | 第一篇 | KV Cache, 显存");
  });
});

describe("estimateTokens", () => {
  it("counts CJK characters as one token and other text at 3.5 characters a token", () => {
    expect(estimateTokens("缓存？")).toBe(3);
    expect(estimateTokens("abcdefg")).toBe(2);
    expect(estimateTokens("")).toBe(0);
  });
});
