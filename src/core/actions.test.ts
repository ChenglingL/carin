import { describe, expect, it } from "vitest";
import { RefusalError, runAction } from "./actions.ts";
import type { BuildInput } from "./context.ts";
import type { MessageRequest } from "./model.ts";
import { openRepo } from "./repo.ts";
import { answerReply, emptyMemory, fakeClient, reply, sampleIndex } from "./testing.ts";
import type { Answer, Question } from "./types.ts";

const repo = openRepo(sampleIndex());
const question: Question = { doc: "docs/app/quant.md", anchor: "kv-cache量化", selection: "KV Cache量化", text: null };

// Stand-in for the context builder until it's written.
const buildRequest = (input: BuildInput): MessageRequest => ({
  model: input.model,
  max_tokens: 1000,
  system: [{ type: "text", text: "rules + doc map", cache_control: { type: "ephemeral" } }],
  messages: [{ role: "user", content: `${input.action}: ${input.question.selection}` }],
});

const cited = (anchor: string): Answer => ({
  points: [{ text: "KV Cache 可以存成 FP8。", source: "repo", citations: [{ doc: "docs/app/quant.md", anchor }] }],
  ahead: [],
  followUps: [],
  conceptsExplained: ["KV Cache量化"],
});

const deps = (client: ReturnType<typeof fakeClient>) => ({ client, repo, model: "claude-sonnet-5-5", buildRequest });

describe("runAction, one-call actions", () => {
  it("returns a checked answer and a trace", async () => {
    const client = fakeClient([answerReply(cited("kv-cache量化"))]);
    const { answer, trace } = await runAction("explain", question, emptyMemory, deps(client));
    expect(answer).toEqual(cited("kv-cache量化"));
    expect(trace).toMatchObject({ action: "explain", calls: 1, retried: false, firstTryProblems: [], dropped: [] });
    expect(trace.usage).toEqual({ input: 100, output: 50, cacheRead: 1000, cacheWrite: 0 });
  });

  it("retries once by appending the problems, keeping earlier turns unchanged", async () => {
    const client = fakeClient([answerReply(cited("made-up")), answerReply(cited("kv-cache量化"))]);
    const { answer, trace } = await runAction("explain", question, emptyMemory, deps(client));
    expect(answer).toEqual(cited("kv-cache量化"));
    expect(trace).toMatchObject({ calls: 2, retried: true, dropped: [] });
    expect(trace.firstTryProblems[0]).toContain("made-up");

    const [first, retry] = client.requests;
    expect(retry?.system).toEqual(first?.system);
    expect(retry?.messages.slice(0, 1)).toEqual(first?.messages);
    expect(retry?.messages[1]).toMatchObject({ role: "assistant" }); // the first answer, thinking block included
    expect(retry?.messages[2]?.content).toMatch(/^Your answer has problems:/);
  });

  it("drops points that still fail after the retry", async () => {
    const client = fakeClient([answerReply(cited("made-up")), answerReply(cited("still-made-up"))]);
    const { answer, trace } = await runAction("explain", question, emptyMemory, deps(client));
    expect(answer.points).toEqual([]);
    expect(trace.dropped).toHaveLength(1);
  });

  it("recovers from a reply that isn't JSON", async () => {
    const client = fakeClient([reply([{ type: "text", text: "oops" }]), answerReply(cited("kv-cache量化"))]);
    const { trace } = await runAction("explain", question, emptyMemory, deps(client));
    expect(trace.firstTryProblems[0]).toMatch(/isn't valid JSON/);
  });

  it("throws on a refusal", async () => {
    const client = fakeClient([reply([], "refusal")]);
    await expect(runAction("explain", question, emptyMemory, deps(client))).rejects.toBeInstanceOf(RefusalError);
  });
});

describe("runAction, agent actions", () => {
  it("runs the tool loop and counts every reply", async () => {
    const client = fakeClient([]);
    const final = answerReply(cited("kv-cache量化"));
    const { trace } = await runAction("where-used", question, emptyMemory, {
      ...deps(client),
      runToolLoop: async (_client, request, runTool, options) => {
        expect(options.maxSteps).toBe(5);
        const search = await runTool("search_repo", { query: "KV Cache", page: 1 });
        expect(search.isError).toBe(false);
        return {
          response: final,
          messages: [...request.messages, { role: "assistant", content: final.content }],
          responses: [answerReply(cited("x")), final],
          toolCalls: [{ name: "search_repo", input: { query: "KV Cache", page: 1 }, isError: false }],
        };
      },
    });
    expect(trace).toMatchObject({ calls: 2, retried: false });
    expect(trace.toolCalls).toHaveLength(1);
  });
});
