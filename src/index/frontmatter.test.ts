import { describe, expect, it } from "vitest";
import { splitFrontmatter } from "./frontmatter.ts";

describe("splitFrontmatter", () => {
  it("reads title, inline keyword list, tags and description", () => {
    const doc = splitFrontmatter(
      "---\ntitle: 缓存入门\ndescription: 讲缓存\nkeywords: [KV Cache, 前缀缓存, 2026]\ntags: [推理]\n---\n\n# 缓存入门\n",
    );
    expect(doc.frontmatter).toEqual({
      title: "缓存入门",
      keywords: ["KV Cache", "前缀缓存", "2026"],
      tags: ["推理"],
      description: "讲缓存",
    });
    expect(doc.body).toBe("\n# 缓存入门\n");
    expect(doc.warning).toBeNull();
  });

  it("reads block lists and ignores fields it doesn't use", () => {
    const doc = splitFrontmatter("---\ntitle: A\nkeywords:\n  - One\n  - Two\nmeta:\n  - name: robots\n---\nbody");
    expect(doc.frontmatter?.keywords).toEqual(["One", "Two"]);
    expect(doc.body).toBe("body");
  });

  it("accepts comma-separated keywords, including the Chinese comma", () => {
    expect(splitFrontmatter("---\nkeywords: RAG，Agent, MCP\n---\n").frontmatter?.keywords).toEqual(["RAG", "Agent", "MCP"]);
  });

  it("returns the text unchanged when there is no frontmatter", () => {
    const doc = splitFrontmatter("# Title\n---\nnot frontmatter\n---\n");
    expect(doc.frontmatter).toBeNull();
    expect(doc.body).toBe("# Title\n---\nnot frontmatter\n---\n");
  });

  it("warns on invalid YAML and still strips the block", () => {
    const doc = splitFrontmatter("---\ntitle: [unclosed\n---\nbody");
    expect(doc.frontmatter).toBeNull();
    expect(doc.body).toBe("body");
    expect(doc.warning).toMatch(/invalid frontmatter/);
  });
});
