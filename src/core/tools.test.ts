import { describe, expect, it } from "vitest";
import { openRepo } from "./repo.ts";
import { emptyMemory, sampleIndex } from "./testing.ts";
import { capTokens, TOOL_DEFINITIONS, toolRunner } from "./tools.ts";

const repo = openRepo(sampleIndex());
const run = toolRunner(repo, { ...emptyMemory, readDocs: ["docs/app/kv.md"] });

describe("tool definitions", () => {
  it("are strict and list every property as required", () => {
    for (const tool of TOOL_DEFINITIONS) {
      expect(tool.strict).toBe(true);
      const schema = tool.input_schema as { properties: object; required: string[]; additionalProperties: boolean };
      expect(schema.additionalProperties).toBe(false);
      expect(schema.required.sort()).toEqual(Object.keys(schema.properties).sort());
    }
  });
});

describe("search_repo", () => {
  it("lists doc#anchor, heading, path position and read status", async () => {
    const out = await run("search_repo", { query: "KV Cache", page: 1 });
    expect(out.isError).toBe(false);
    expect(out.content).toMatch(/^Results for "KV Cache", page 1 of 1 \(2 docs match\)/);
    expect(out.content).toContain("docs/app/kv.md#");
    expect(out.content).toMatch(/docs\/app\/kv\.md#.*path #1 · read/);
    expect(out.content).toMatch(/docs\/app\/quant\.md#.*path #2 · unread/);
  });

  it("says so when nothing matches", async () => {
    expect((await run("search_repo", { query: "量子纠缠", page: 1 })).content).toMatch(/^No sections match/);
  });

  it("rejects a missing query", async () => {
    expect(await run("search_repo", { page: 1 })).toMatchObject({ isError: true });
  });
});

describe("read_section", () => {
  it("returns the text with its heading trail", async () => {
    const out = await run("read_section", { doc: "docs/app/kv.md", anchor: "pagedattention-怎么省显存" });
    expect(out.isError).toBe(false);
    expect(out.content).toContain("KV Cache 详解 › PagedAttention 怎么省显存");
    expect(out.content).toContain("把 KV Cache 切成块");
  });

  it("accepts a leading #, percent-encoding, or the heading text", async () => {
    for (const anchor of ["#前缀缓存", encodeURIComponent("前缀缓存"), "前缀缓存"]) {
      expect((await run("read_section", { doc: "docs/app/kv.md", anchor })).isError).toBe(false);
    }
    expect((await run("read_section", { doc: "docs/app/kv.md", anchor: "PagedAttention 怎么省显存" })).isError).toBe(false);
  });

  it("lists the doc's anchors when the anchor is wrong", async () => {
    const out = await run("read_section", { doc: "docs/app/kv.md", anchor: "nope" });
    expect(out.isError).toBe(true);
    expect(out.content).toContain("Its anchors: kv-cache-详解, 为什么需要-kv-cache");
  });

  it("rejects an unknown doc", async () => {
    expect(await run("read_section", { doc: "docs/nope.md", anchor: "x" })).toMatchObject({ isError: true });
  });

  it("lists subsections of a parent section", async () => {
    const out = await run("read_section", { doc: "docs/app/kv.md", anchor: "kv-cache-详解" });
    expect(out.content).toContain("Subsections: 为什么需要-kv-cache, pagedattention-怎么省显存, 前缀缓存");
  });
});

describe("unknown tools and long sections", () => {
  it("returns an error for an unknown tool", async () => {
    expect(await run("delete_repo", {})).toMatchObject({ isError: true });
  });

  it("caps long text", () => {
    const capped = capTokens("缓".repeat(5000), 3000);
    expect(capped.length).toBeLessThan(3100);
    expect(capped).toContain("[Truncated at about 3,000 tokens.]");
  });
});
