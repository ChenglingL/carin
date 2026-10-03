import { describe, expect, it } from "vitest";
import { classifyDoc, textOutsideLinks } from "./classify.ts";

const article = "这是一段很长的正文。".repeat(60); // 600 characters

describe("classifyDoc", () => {
  it("treats a page of links as a hub", () => {
    const body = "# 路线\n\n1. [第一篇](a.md)\n2. [第二篇](b.md)\n3. [第三篇](c.md)\n";
    expect(classifyDoc(body, 3)).toBe("hub");
  });

  it("treats a long page as a doc even when it links a lot", () => {
    expect(classifyDoc(`${article}${article}\n[a](a.md) [b](b.md) [c](c.md)`, 3)).toBe("doc");
  });

  it("treats a near-empty page as a stub", () => {
    expect(classifyDoc("# 本文已迁移\n\n请前往 [新位置](../new.md)。", 1)).toBe("stub");
  });

  it("treats an ordinary article as a doc", () => {
    expect(classifyDoc(article, 0)).toBe("doc");
  });
});

describe("textOutsideLinks", () => {
  it("counts text, not links, markup or whitespace", () => {
    expect(textOutsideLinks("# 标题\n\n- [链接文字](x.md) 正文 <b>粗</b>")).toBe("标题正文粗".length);
  });
});
