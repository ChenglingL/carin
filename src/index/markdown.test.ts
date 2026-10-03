import { describe, expect, it } from "vitest";
import { cleanBody, extractLinks, headingText, resolveLink, splitSections } from "./markdown.ts";

describe("splitSections", () => {
  it("splits at every heading level and keeps parent headings as a trail", () => {
    const sections = splitSections("intro\n\n# Top\ntop text\n## Child\nchild text\n### Grandchild\n## Sibling\n");
    expect(sections.map((s) => [s.level, s.heading, s.trail, s.text])).toEqual([
      [0, "", [], "intro"],
      [1, "Top", [], "top text"],
      [2, "Child", ["Top"], "child text"],
      [3, "Grandchild", ["Top", "Child"], ""],
      [2, "Sibling", ["Top"], ""],
    ]);
  });

  it("ignores # lines inside fenced code", () => {
    const body = "# Real\n```python\n# a comment\n```\n~~~~\n## not a heading\n~~~\n~~~~\n## Also real\n";
    expect(splitSections(body).map((s) => s.heading)).toEqual(["Real", "Also real"]);
    expect(splitSections(body)[0]?.text).toContain("# a comment");
  });

  it("needs a space after the #s and drops closing #s", () => {
    const sections = splitSections("#NotHeading\n## Title ##\n");
    expect(sections.map((s) => [s.level, s.heading, s.text])).toEqual([
      [0, "", "#NotHeading"],
      [2, "Title", ""],
    ]);
  });

  it("builds GitHub anchors, Chinese and punctuation included", () => {
    const anchors = splitSections(
      "# KV Cache为什么会吃光显存？从PagedAttention到Prefix Cache\n## 1. Token 是什么？一个汉字几个 token？\n",
    ).map((s) => s.anchor);
    expect(anchors).toEqual(["kv-cache为什么会吃光显存从pagedattention到prefix-cache", "1-token-是什么一个汉字几个-token"]);
  });

  it("numbers repeated headings like GitHub does", () => {
    expect(splitSections("## 小结\n## 小结\n## 小结\n").map((s) => s.anchor)).toEqual(["小结", "小结-1", "小结-2"]);
  });

  it("omits an empty preamble", () => {
    expect(splitSections("\n\n# Only\n")).toHaveLength(1);
  });
});

describe("headingText", () => {
  it("keeps what GitHub renders as text", () => {
    expect(headingText("**Bold** and `code` [link](x.md) ![img](a.png) <em>html</em>")).toBe("Bold and code link  html");
    expect(headingText("__strong__ snake_case_name")).toBe("strong snake_case_name");
    expect(headingText("C\\# escaped")).toBe("C# escaped");
  });
});

describe("extractLinks", () => {
  it("resolves relative links and skips external links, images and code", () => {
    const body = [
      "[a](../app/a.md) [b](./b.md#Part-2) [web](https://example.com) ![img](pic.png)",
      "`[code](c.md)` [root](/docs/r.md) [self](#local)",
      "```",
      "[fenced](f.md)",
      "```",
    ].join("\n");
    expect(extractLinks("docs/llm/intro/x.md", body)).toEqual([
      { target: "docs/llm/app/a.md", anchor: null },
      { target: "docs/llm/intro/b.md", anchor: "Part-2" },
      { target: "docs/r.md", anchor: null },
      { target: "docs/llm/intro/x.md", anchor: "local" },
    ]);
  });
});

describe("resolveLink", () => {
  it("decodes percent-encoded anchors and paths", () => {
    expect(resolveLink("README.md", "docs/a%20b.md#%E7%BC%93%E5%AD%98")).toEqual({ target: "docs/a b.md", anchor: "缓存" });
  });

  it("returns null for other schemes", () => {
    expect(resolveLink("README.md", "mailto:x@example.com")).toBeNull();
    expect(resolveLink("README.md", "//cdn.example.com/x.md")).toBeNull();
  });
});

describe("cleanBody", () => {
  it("drops HTML comments and script blocks", () => {
    expect(cleanBody("a<!-- # hidden -->b\n<script>\nwindow.x = 1\n</script>\nc")).toBe("ab\n\nc");
  });
});
