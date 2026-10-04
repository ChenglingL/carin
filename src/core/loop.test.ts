// The spec for the tool loop (M1 step B3).

import { describe, expect, it } from "vitest";
import { runToolLoop } from "./loop.ts";
import type { MessageRequest } from "./model.ts";
import { answerReply, fakeClient, reply, toolUseReply } from "./testing.ts";
import type { ToolRunner } from "./tools.ts";
import { TOOL_DEFINITIONS } from "./tools.ts";
import type { Answer } from "./types.ts";

const request: MessageRequest = {
  model: "test-model",
  max_tokens: 16000,
  system: [{ type: "text", text: "rules + doc map", cache_control: { type: "ephemeral" } }],
  tools: TOOL_DEFINITIONS,
  messages: [{ role: "user", content: "Where else is KV Cache used?" }],
};
const answer: Answer = { points: [], ahead: [], followUps: [], conceptsExplained: [] };
const echoTool: ToolRunner = async (name, input) => ({ content: `${name} ran with ${JSON.stringify(input)}`, isError: false });

describe("runToolLoop", () => {
  it("returns at once when the model answers without tools", async () => {
    const client = fakeClient([answerReply(answer)]);
    const result = await runToolLoop(client, request, echoTool, { maxSteps: 5 });
    expect(client.requests).toHaveLength(1);
    expect(result.responses).toHaveLength(1);
    expect(result.response.stop_reason).toBe("end_turn");
    expect(result.messages.at(-1)).toEqual({ role: "assistant", content: result.response.content });
    expect(result.toolCalls).toEqual([]);
  });

  it("runs every tool call and sends all results back in one user message", async () => {
    const first = toolUseReply([
      { name: "search_repo", input: { query: "KV Cache", page: 1 } },
      { name: "search_repo", input: { query: "KV缓存", page: 1 } },
    ]);
    const client = fakeClient([first, answerReply(answer)]);
    const result = await runToolLoop(client, request, echoTool, { maxSteps: 5 });

    const second = client.requests[1];
    expect(second?.messages[1]).toEqual({ role: "assistant", content: first.content }); // unchanged
    const ids = first.content.map((block) => (block.type === "tool_use" ? block.id : ""));
    expect(second?.messages[2]).toEqual({
      role: "user",
      content: [
        { type: "tool_result", tool_use_id: ids[0], content: 'search_repo ran with {"query":"KV Cache","page":1}' },
        { type: "tool_result", tool_use_id: ids[1], content: 'search_repo ran with {"query":"KV缓存","page":1}' },
      ],
    });
    expect(result.toolCalls.map((call) => call.input)).toEqual([
      { query: "KV Cache", page: 1 },
      { query: "KV缓存", page: 1 },
    ]);
  });

  it("only ever appends: each request starts with the previous one's messages", async () => {
    const client = fakeClient([
      toolUseReply([{ name: "search_repo", input: { query: "a", page: 1 } }]),
      toolUseReply([{ name: "read_section", input: { doc: "d", anchor: "x" } }]),
      answerReply(answer),
    ]);
    await runToolLoop(client, request, echoTool, { maxSteps: 5 });
    for (let i = 1; i < client.requests.length; i++) {
      const before = client.requests[i - 1]?.messages ?? [];
      expect(client.requests[i]?.messages.slice(0, before.length)).toEqual(before);
      expect(client.requests[i]?.system).toEqual(request.system);
      expect(client.requests[i]?.tools).toEqual(request.tools);
    }
    expect(request.messages).toHaveLength(1); // the caller's request isn't mutated
  });

  it("returns tool failures to the model as errors instead of stopping", async () => {
    const failing: ToolRunner = async (name) => {
      if (name === "read_section") throw new Error("disk on fire");
      return { content: "No section x. Its anchors: a, b", isError: true };
    };
    const client = fakeClient([
      toolUseReply([
        { name: "search_repo", input: { query: "a", page: 1 } },
        { name: "read_section", input: { doc: "d", anchor: "x" } },
      ]),
      answerReply(answer),
    ]);
    const result = await runToolLoop(client, request, failing, { maxSteps: 5 });
    const results = client.requests[1]?.messages[2]?.content;
    expect(results).toMatchObject([
      { type: "tool_result", is_error: true, content: "No section x. Its anchors: a, b" },
      { type: "tool_result", is_error: true, content: expect.stringContaining("disk on fire") },
    ]);
    expect(result.toolCalls.map((call) => call.isError)).toEqual([true, true]);
  });

  it("turns tools off for the last step so the model must answer", async () => {
    const search = () => toolUseReply([{ name: "search_repo", input: { query: "again", page: 1 } }]);
    const client = fakeClient([search(), search(), (req) => (req.tool_choice?.type === "none" ? answerReply(answer) : search())]);
    const result = await runToolLoop(client, request, echoTool, { maxSteps: 3 });
    expect(client.requests).toHaveLength(3);
    expect(client.requests.slice(0, 2).map((r) => r.tool_choice)).toEqual([undefined, undefined]);
    expect(client.requests[2]?.tool_choice).toEqual({ type: "none" });
    expect(result.response.stop_reason).toBe("end_turn");
  });

  it("stops without running tools on a refusal or a cut-off reply", async () => {
    for (const stopReason of ["refusal", "max_tokens"] as const) {
      let ran = false;
      const tool: ToolRunner = async () => {
        ran = true;
        return { content: "", isError: false };
      };
      const cutOff = reply([{ type: "tool_use", id: "t1", name: "search_repo", input: { query: "KV" } }], stopReason);
      const client = fakeClient([cutOff]);
      const result = await runToolLoop(client, request, tool, { maxSteps: 5 });
      expect(ran).toBe(false);
      expect(result.response.stop_reason).toBe(stopReason);
    }
  });

  it("asks for the growing conversation to be cached between steps", async () => {
    const client = fakeClient([toolUseReply([{ name: "search_repo", input: { query: "a", page: 1 } }]), answerReply(answer)]);
    await runToolLoop(client, request, echoTool, { maxSteps: 5 });
    expect(client.requests.every((r) => r.cache_control?.type === "ephemeral")).toBe(true);
  });
});
