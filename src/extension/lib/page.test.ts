import { describe, expect, it } from "vitest";
import { parseGithubUrl } from "./page.ts";

describe("parseGithubUrl", () => {
  it("reads repo, ref and doc path from a blob URL", () => {
    expect(
      parseGithubUrl("https://github.com/ChenglingL/llm-master/blob/main/docs/llm/app/model_quantization.md#%E7%AE%80%E8%A6%81"),
    ).toEqual({
      repo: "ChenglingL/llm-master",
      ref: "main",
      path: "docs/llm/app/model_quantization.md",
      url: "https://github.com/ChenglingL/llm-master/blob/main/docs/llm/app/model_quantization.md#%E7%AE%80%E8%A6%81",
    });
  });

  it("decodes encoded paths", () => {
    expect(parseGithubUrl("https://github.com/o/r/blob/main/docs/%E6%96%87.md")?.path).toBe("docs/文.md");
  });

  it("treats a repo's front page as its README", () => {
    expect(parseGithubUrl("https://github.com/o/r")).toMatchObject({ repo: "o/r", ref: "HEAD", path: "README.md" });
    expect(parseGithubUrl("https://github.com/o/r/?tab=readme")).toMatchObject({ path: "README.md" });
  });

  it("ignores pages that aren't Markdown docs", () => {
    expect(parseGithubUrl("https://github.com/o/r/blob/main/src/index.ts")).toBeNull();
    expect(parseGithubUrl("https://github.com/o/r/issues/3")).toBeNull();
    expect(parseGithubUrl("https://github.com/settings/profile")).toBeNull();
    expect(parseGithubUrl("https://example.com/o/r/blob/main/a.md")).toBeNull();
  });
});
