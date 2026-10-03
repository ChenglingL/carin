import { describe, expect, it } from "vitest";
import { buildReadingPath, findStartPage } from "./reading-path.ts";
import type { DocKind } from "./types.ts";

describe("buildReadingPath", () => {
  const kinds = new Map<string, DocKind>([
    ["roadmap.md", "hub"],
    ["stage-1.md", "hub"],
    ["stage-2.md", "hub"],
    ["a.md", "doc"],
    ["b.md", "doc"],
    ["c.md", "doc"],
    ["d.md", "doc"],
    ["z.md", "doc"],
    ["moved.md", "stub"],
  ]);

  it("opens hubs in place, adds docs once, and skips stubs", () => {
    const links = new Map([
      ["roadmap.md", ["stage-1.md", "c.md", "stage-2.md"]],
      ["stage-1.md", ["a.md", "moved.md", "b.md", "roadmap.md"]],
      ["stage-2.md", ["b.md", "d.md", "stage-1.md"]],
      ["a.md", ["z.md"]], // links inside docs are not followed
    ]);
    const path = buildReadingPath("roadmap.md", kinds, links);
    expect(path.map((r) => [r.position, r.path, r.via])).toEqual([
      [1, "a.md", "stage-1.md"],
      [2, "b.md", "stage-1.md"],
      [3, "c.md", "roadmap.md"],
      [4, "d.md", "stage-2.md"],
      [5, "z.md", null], // never reached: appended at the end
    ]);
  });

  it("opens the start page even when it is a doc", () => {
    const docs = new Map<string, DocKind>([
      ["README.md", "doc"],
      ["b.md", "doc"],
      ["a.md", "doc"],
    ]);
    const path = buildReadingPath("README.md", docs, new Map([["README.md", ["b.md"]]]));
    expect(path.map((r) => r.path)).toEqual(["b.md", "README.md", "a.md"]);
  });
});

describe("findStartPage", () => {
  it("prefers a roadmap folder's README, then roadmap.md, then the root README", () => {
    expect(findStartPage(["README.md", "docs/roadmap.md", "docs/roadmap/README.md"])).toBe("docs/roadmap/README.md");
    expect(findStartPage(["README.md", "docs/roadmap.md"])).toBe("docs/roadmap.md");
    expect(findStartPage(["README.md", "docs/a.md"])).toBe("README.md");
    expect(findStartPage(["docs/a.md"])).toBeNull();
  });
});
