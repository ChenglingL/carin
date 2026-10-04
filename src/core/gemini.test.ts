import { describe, expect, it } from "vitest";
import { fromGemini, GEMINI_MODEL, geminiClient, toGemini } from "./gemini.ts";
import type { MessageRequest, PostFetch } from "./model.ts";

const request: MessageRequest = {
  model: GEMINI_MODEL,
  max_tokens: 16000,
  system: [
    { type: "text", text: "rules" },
    { type: "text", text: "doc map", cache_control: { type: "ephemeral" } },
  ],
  tools: [{ name: "search_repo", description: "search", strict: true, input_schema: { type: "object", properties: {} } }],
  output_config: { effort: "medium", format: { type: "json_schema", schema: { type: "object" } } },
  messages: [
    { role: "user", content: "Where else is KV Cache used?" },
    {
      role: "assistant",
      content: [
        { type: "thinking", thinking: "", signature: "sig-1" },
        { type: "tool_use", id: "call-1", name: "search_repo", input: { query: "KV Cache", page: 1 } },
        { type: "tool_use", id: "gemini-local-2", name: "search_repo", input: { query: "KV缓存", page: 1 } },
      ],
    },
    {
      role: "user",
      content: [
        { type: "tool_result", tool_use_id: "call-1", content: "Results…" },
        { type: "tool_result", tool_use_id: "gemini-local-2", content: "No sections match", is_error: true },
      ],
    },
  ],
};

describe("toGemini", () => {
  const body = toGemini(request) as Record<string, any>;

  it("joins system blocks into the system instruction", () => {
    expect(body.systemInstruction).toEqual({ parts: [{ text: "rules\n\ndoc map" }] });
  });

  it("maps roles, tool calls and tool results, naming each result after its call", () => {
    expect(body.contents.map((c: { role: string }) => c.role)).toEqual(["user", "model", "user"]);
    expect(body.contents[1].parts).toEqual([
      { functionCall: { id: "call-1", name: "search_repo", args: { query: "KV Cache", page: 1 } }, thoughtSignature: "sig-1" },
      { functionCall: { name: "search_repo", args: { query: "KV缓存", page: 1 } } },
    ]);
    expect(body.contents[2].parts).toEqual([
      { functionResponse: { id: "call-1", name: "search_repo", response: { result: "Results…" } } },
      { functionResponse: { name: "search_repo", response: { error: "No sections match" } } },
    ]);
  });

  it("maps tools, the answer schema and effort", () => {
    expect(body.tools[0].functionDeclarations[0]).toEqual({
      name: "search_repo",
      description: "search",
      parametersJsonSchema: { type: "object", properties: {} },
    });
    expect(body.toolConfig).toEqual({ functionCallingConfig: { mode: "AUTO" } });
    expect(body.generationConfig).toEqual({
      maxOutputTokens: 16000,
      responseMimeType: "application/json",
      responseJsonSchema: { type: "object" },
      thinkingConfig: { thinkingLevel: "medium" },
    });
  });

  it("turns tool_choice none into mode NONE", () => {
    const none = toGemini({ ...request, tool_choice: { type: "none" } }) as Record<string, any>;
    expect(none.toolConfig.functionCallingConfig.mode).toBe("NONE");
  });
});

describe("fromGemini", () => {
  it("turns function calls into tool_use blocks, keeping signatures as thinking blocks", () => {
    const response = fromGemini(
      {
        candidates: [
          {
            content: { parts: [{ functionCall: { name: "search_repo", args: { query: "Rerank", page: 1 } }, thoughtSignature: "sig-9" }] },
            finishReason: "STOP",
          },
        ],
        usageMetadata: { promptTokenCount: 20000, cachedContentTokenCount: 18000, candidatesTokenCount: 40, thoughtsTokenCount: 200 },
      },
      GEMINI_MODEL,
    );
    expect(response.stop_reason).toBe("tool_use");
    expect(response.content).toEqual([
      { type: "thinking", thinking: "", signature: "sig-9" },
      { type: "tool_use", id: "gemini-local-1", name: "search_repo", input: { query: "Rerank", page: 1 } },
    ]);
    expect(response.usage).toEqual({ input_tokens: 2000, output_tokens: 240, cache_creation_input_tokens: 0, cache_read_input_tokens: 18000 });
  });

  it("round-trips a reply through toGemini unchanged", () => {
    const parts = [{ text: "{\"points\":[]}", thoughtSignature: "sig-3" }];
    const response = fromGemini({ candidates: [{ content: { parts }, finishReason: "STOP" }] }, GEMINI_MODEL);
    const back = toGemini({ ...request, messages: [{ role: "assistant", content: response.content }] }) as Record<string, any>;
    expect(back.contents[0].parts).toEqual(parts);
  });

  it("maps finish reasons", () => {
    const finish = (finishReason: string) =>
      fromGemini({ candidates: [{ content: { parts: [{ text: "x" }] }, finishReason }] }, GEMINI_MODEL).stop_reason;
    expect(finish("STOP")).toBe("end_turn");
    expect(finish("MAX_TOKENS")).toBe("max_tokens");
    expect(finish("SAFETY")).toBe("refusal");
    expect(fromGemini({ promptFeedback: { blockReason: "SAFETY" } }, GEMINI_MODEL).stop_reason).toBe("refusal");
  });
});

describe("geminiClient", () => {
  it("posts to generateContent with the key in a header", async () => {
    const calls: { url: string; headers: Record<string, string> }[] = [];
    const fetch: PostFetch = async (url, init) => {
      calls.push({ url, headers: init.headers });
      const body = { candidates: [{ content: { parts: [{ text: "hi" }] }, finishReason: "STOP" }] };
      return { ok: true, status: 200, json: async () => body, text: async () => "" };
    };
    const response = await geminiClient({ apiKey: "test-key", fetch }).createMessage(request);
    expect(calls[0]?.url).toBe(`https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent`);
    expect(calls[0]?.headers["x-goog-api-key"]).toBe("test-key");
    expect(response.content).toEqual([{ type: "text", text: "hi" }]);
  });
});
