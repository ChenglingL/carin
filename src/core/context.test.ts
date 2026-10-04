// The spec for the context builder (M1 step B2). Written before it, so it can be built against them.

import { describe, expect, it } from "vitest";
import { ANSWER_SCHEMA } from "./answer.ts";
import { buildRequest, type BuildInput } from "./context.ts";
import { ACTIONS } from "./prompts/actions.ts";
import { answerRules } from "./prompts/answer-rules.ts";
import { openRepo } from "./repo.ts";
import { emptyMemory, sampleIndex } from "./testing.ts";
import { TOOL_DEFINITIONS } from "./tools.ts";
import type { MemorySlice } from "./types.ts";

const repo = openRepo(sampleIndex());
const memory: MemorySlice = {
  profile: { language: "Français", length: "short", background: "", skip: [] },
  readDocs: ["docs/app/kv.md"],
  concepts: [
    { term: "FP8", status: "unclear" },
    { term: "Prefill", status: "got-it" },
  ],
  threads: [],
};

const explain: BuildInput = {
  action: "explain",
  question: { doc: "docs/app/quant.md", anchor: "kv-cache量化", selection: "把 KV Cache 存成 FP8", text: null },
  memory,
  repo,
  model: "test-model",
};
const whereUsed: BuildInput = {
  action: "where-used",
  question: { doc: "docs/app/rag.md", anchor: "rerank-精排", selection: "在召回之后重排序", text: null },
  memory: emptyMemory,
  repo,
  model: "test-model",
};
const ask: BuildInput = {
  ...whereUsed,
  action: "ask",
  question: { doc: "docs/app/kv.md", anchor: "前缀缓存", selection: "", text: "前缀复用为什么省时间？" },
};

const systemText = (input: BuildInput) => JSON.stringify(buildRequest(input).system);
const messageText = (input: BuildInput) => JSON.stringify(buildRequest(input).messages);

describe("the cached prefix", () => {
  it("is byte-identical across actions, questions and readers", () => {
    expect(systemText(whereUsed)).toBe(systemText(explain));
    expect(systemText(ask)).toBe(systemText(explain));
  });

  it("holds the answer rules, then the doc map, with a cache breakpoint on the last block", () => {
    const system = buildRequest(explain).system ?? [];
    const text = system.map((block) => block.text).join("\n");
    expect(text).toContain(answerRules({ repo: repo.name }));
    expect(text).toContain(repo.docMap);
    expect(text.indexOf(repo.docMap)).toBeGreaterThan(text.indexOf(answerRules({ repo: repo.name })));
    expect(system.at(-1)?.cache_control).toEqual({ type: "ephemeral" });
  });

  it("contains nothing about this question or this reader", () => {
    for (const volatile of ["把 KV Cache 存成 FP8", "前缀复用为什么省时间", "Français", "FP8"]) {
      expect(systemText(explain)).not.toContain(volatile);
      expect(systemText(ask)).not.toContain(volatile);
    }
  });
});

describe("the question message", () => {
  it("is one user message: the first turn", () => {
    const { messages } = buildRequest(explain);
    expect(messages).toHaveLength(1);
    expect(messages[0]?.role).toBe("user");
  });

  it("carries the action's instruction, the selection and the typed question", () => {
    expect(messageText(explain)).toContain(JSON.stringify(ACTIONS.explain.instruction).slice(1, -1));
    expect(messageText(explain)).toContain("把 KV Cache 存成 FP8");
    expect(messageText(ask)).toContain("前缀复用为什么省时间？");
  });

  it("carries where the reader is: the doc and the current section with its anchor", () => {
    const text = messageText(explain);
    expect(text).toContain("docs/app/quant.md");
    expect(text).toContain("kv-cache量化");
    expect(text).toContain(JSON.stringify(repo.section("docs/app/quant.md", "kv-cache量化")?.text ?? "").slice(1, -1));
  });

  it("carries the memory slice: language, docs read, and concept statuses", () => {
    const text = messageText(explain);
    expect(text).toContain("Français");
    expect(text).toContain("docs/app/kv.md");
    expect(text).toContain("FP8");
    expect(text).toContain("Prefill");
  });
});

describe("tools and output", () => {
  it("gives agent actions both tools, and one-call actions none", () => {
    expect(buildRequest(whereUsed).tools).toEqual(TOOL_DEFINITIONS);
    expect(buildRequest(ask).tools).toEqual(TOOL_DEFINITIONS);
    expect(buildRequest(explain).tools ?? []).toEqual([]);
  });

  it("asks for the answer JSON at the action's effort", () => {
    for (const input of [explain, whereUsed]) {
      const { output_config, model, max_tokens } = buildRequest(input);
      expect(output_config?.format).toEqual({ type: "json_schema", schema: ANSWER_SCHEMA });
      expect(output_config?.effort).toBe(ACTIONS[input.action].effort);
      expect(model).toBe("test-model");
      expect(max_tokens).toBeGreaterThanOrEqual(4000);
    }
  });

  it("builds the same request every time for the same input", () => {
    expect(buildRequest(ask)).toEqual(buildRequest(ask));
  });
});
