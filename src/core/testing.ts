// Test helpers for the agent core: a model that replays canned responses, and a tiny repo.
import { buildIndex } from "../index/build.ts";
import type { RepoIndex } from "../index/types.ts";
import type { ContentBlock, MessageRequest, MessageResponse, ModelClient, StopReason } from "./model.ts";
import type { Answer, MemorySlice } from "./types.ts";

export type Scripted = MessageResponse | ((request: MessageRequest) => MessageResponse);

/** A ModelClient that answers from a script, in order, and records every request it gets. */
export function fakeClient(script: Scripted[]): ModelClient & { requests: MessageRequest[] } {
  const requests: MessageRequest[] = [];
  return {
    requests,
    async createMessage(request) {
      requests.push(JSON.parse(JSON.stringify(request)) as MessageRequest); // a snapshot, not a live reference
      const next = script[requests.length - 1];
      if (!next) throw new Error(`fakeClient: no scripted response for call ${requests.length}`);
      return typeof next === "function" ? next(request) : next;
    },
  };
}

let ids = 0;

export function reply(content: ContentBlock[], stopReason: StopReason = "end_turn"): MessageResponse {
  ids++;
  return {
    id: `msg_fake_${ids}`,
    model: "fake",
    role: "assistant",
    content,
    stop_reason: stopReason,
    usage: { input_tokens: 100, output_tokens: 50, cache_creation_input_tokens: 0, cache_read_input_tokens: 1000 },
  };
}

/** A final reply carrying an answer, preceded by a thinking block like Sonnet 5.5 sends. */
export function answerReply(answer: Answer): MessageResponse {
  return reply([
    { type: "thinking", thinking: "", signature: "sig" },
    { type: "text", text: JSON.stringify(answer) },
  ]);
}

export function toolUseReply(calls: { name: string; input: unknown }[]): MessageResponse {
  return reply(
    calls.map((call, i) => ({ type: "tool_use", id: `toolu_${ids}_${i}`, name: call.name, input: call.input })),
    "tool_use",
  );
}

const filler = "这一段是正文，用来让文档足够长。".repeat(25);
const article = (title: string, keywords: string[], body: string) =>
  `---\ntitle: ${title}\nkeywords: [${keywords.join(", ")}]\n---\n\n# ${title}\n\n${filler}\n\n${body}\n`;

/** A tiny repo index built with the real M0 pipeline: three app docs, a roadmap hub, a stub. */
export function sampleIndex(): RepoIndex {
  const files = [
    { path: "docs/roadmap/README.md", text: "# 路线\n\n1. [KV](../app/kv.md)\n2. [量化](../app/quant.md)\n3. [RAG](../app/rag.md)\n" },
    {
      path: "docs/app/kv.md",
      text: article(
        "KV Cache 详解",
        ["KV Cache", "PagedAttention", "前缀缓存"],
        "## 为什么需要 KV Cache\n\nPrefill 阶段写入 KV Cache，Decode 阶段读取。\n\n## PagedAttention 怎么省显存\n\nPagedAttention 把 KV Cache 切成块。\n\n## 前缀缓存\n\n相同前缀复用 KV 块。\n",
      ),
    },
    {
      path: "docs/app/quant.md",
      text: article("模型量化", ["量化", "KV Cache量化"], "## KV Cache量化\n\n把 KV Cache 存成 FP8。\n\n## 权重量化\n\n只量化权重。\n"),
    },
    {
      path: "docs/app/rag.md",
      text: article("RAG 优化", ["Rerank", "RAG"], "## Rerank 精排\n\nRerank 在召回之后重排序。\n\n## 存储\n\nThe storage layer is not about rag.\n"),
    },
    { path: "docs/old.md", text: "# 已迁移\n\n见 [新文](app/kv.md)\n" },
  ];
  return buildIndex({ repo: "owner/repo", ref: "main", commit: "abc1234", files }, { builtAt: "2026-10-02T00:00:00.000Z" }).index;
}

export const emptyMemory: MemorySlice = {
  profile: { language: "match", length: "short", background: "", skip: [] },
  readDocs: [],
  concepts: [],
  threads: [],
};
