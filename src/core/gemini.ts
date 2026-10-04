// Google's Gemini API behind the same ModelClient interface, so nothing above this file
// knows which provider answered. Requests and responses keep the Messages API shape used
// everywhere in src/core; this file translates both ways.
//
// Mapping:
//   system blocks            → systemInstruction
//   user / assistant         → "user" / "model" contents
//   tool_use / tool_result   → functionCall / functionResponse
//   tools                    → functionDeclarations (parametersJsonSchema)
//   output_config.format     → responseMimeType + responseJsonSchema
//   output_config.effort     → thinkingConfig.thinkingLevel
//   thoughtSignature on a part → a thinking block just before that part's block, carrying the
//                                signature, so the tool loop passes it back unchanged like any thinking block.
// cache_control is ignored: Gemini caches repeated prefixes on its own.

import {
  ModelError,
  type ContentBlock,
  type Effort,
  type MessageRequest,
  type MessageResponse,
  type ModelClient,
  type PostFetch,
  type StopReason,
} from "./model.ts";

export const GEMINI_MODEL = "gemini-3.7-flash"; // 3.8 was often overloaded on the free tier (Oct 2026)
/** Free-tier models to fall back on, in order, when one's daily quota runs out (20 requests/day each, Oct 2026). */
export const GEMINI_FALLBACKS = [GEMINI_MODEL, "gemini-3.8-flash", "gemini-3.6-flash", "gemini-3.5-flash", "gemini-2.5-flash"];

interface GeminiPart {
  text?: string;
  thought?: boolean;
  thoughtSignature?: string;
  functionCall?: { id?: string; name: string; args?: unknown };
  functionResponse?: { id?: string; name: string; response: Record<string, unknown> };
}

interface GeminiContent {
  role: "user" | "model";
  parts: GeminiPart[];
}

interface GeminiResponse {
  candidates?: { content?: { parts?: GeminiPart[] }; finishReason?: string }[];
  promptFeedback?: { blockReason?: string };
  usageMetadata?: {
    promptTokenCount?: number;
    cachedContentTokenCount?: number;
    candidatesTokenCount?: number;
    thoughtsTokenCount?: number;
  };
  modelVersion?: string;
  responseId?: string;
}

export interface GeminiOptions {
  apiKey: string;
  fetch: PostFetch;
  baseUrl?: string;
}

export function geminiClient(options: GeminiOptions): ModelClient {
  const baseUrl = options.baseUrl ?? "https://generativelanguage.googleapis.com";
  return {
    async createMessage(request) {
      const res = await options.fetch(`${baseUrl}/v1beta/models/${request.model}:generateContent`, {
        method: "POST",
        headers: { "x-goog-api-key": options.apiKey, "content-type": "application/json" },
        body: JSON.stringify(toGemini(request)),
      });
      if (!res.ok) throw new ModelError(res.status, await res.text());
      return fromGemini((await res.json()) as GeminiResponse, request.model);
    },
  };
}

// Ids we made up because Gemini sent none; they aren't sent back to Gemini.
const LOCAL_ID = "gemini-local-";

const THINKING_LEVEL: Record<Effort, string> = { low: "low", medium: "medium", high: "high", xhigh: "high", max: "high" };

export function toGemini(request: MessageRequest): Record<string, unknown> {
  const toolNames = new Map<string, string>(); // tool_use id → function name, for functionResponse
  const contents: GeminiContent[] = request.messages.map((message) => {
    const blocks: ContentBlock[] =
      typeof message.content === "string" ? [{ type: "text", text: message.content }] : message.content;
    const parts: GeminiPart[] = [];
    let signature: string | undefined; // from a thinking block, for the next part
    const push = (part: GeminiPart) => {
      parts.push(signature ? { ...part, thoughtSignature: signature } : part);
      signature = undefined;
    };
    for (const block of blocks) {
      switch (block.type) {
        case "thinking":
          signature = block.signature || undefined;
          break;
        case "redacted_thinking":
          break;
        case "text":
          push({ text: block.text });
          break;
        case "tool_use":
          toolNames.set(block.id, block.name);
          push({
            functionCall: {
              ...(block.id.startsWith(LOCAL_ID) ? {} : { id: block.id }),
              name: block.name,
              args: block.input ?? {},
            },
          });
          break;
        case "tool_result":
          push({
            functionResponse: {
              ...(block.tool_use_id.startsWith(LOCAL_ID) ? {} : { id: block.tool_use_id }),
              name: toolNames.get(block.tool_use_id) ?? "unknown_tool",
              response: block.is_error ? { error: block.content } : { result: block.content },
            },
          });
          break;
      }
    }
    if (signature) parts.push({ text: "", thoughtSignature: signature }); // a signature with nothing after it
    return { role: message.role === "assistant" ? "model" : "user", parts };
  });

  const generationConfig: Record<string, unknown> = { maxOutputTokens: request.max_tokens };
  const format = request.output_config?.format;
  if (format) {
    generationConfig.responseMimeType = "application/json";
    generationConfig.responseJsonSchema = format.schema;
  }
  const effort = request.output_config?.effort;
  if (effort) generationConfig.thinkingConfig = { thinkingLevel: THINKING_LEVEL[effort] };

  const body: Record<string, unknown> = { contents, generationConfig };
  if (request.system?.length) {
    body.systemInstruction = { parts: [{ text: request.system.map((block) => block.text).join("\n\n") }] };
  }
  if (request.tools?.length) {
    body.tools = [
      {
        functionDeclarations: request.tools.map((tool) => ({
          name: tool.name,
          description: tool.description,
          parametersJsonSchema: tool.input_schema,
        })),
      },
    ];
    body.toolConfig = { functionCallingConfig: { mode: request.tool_choice?.type === "none" ? "NONE" : "AUTO" } };
  }
  return body;
}

const REFUSALS = new Set(["SAFETY", "PROHIBITED_CONTENT", "BLOCKLIST", "SPII", "RECITATION", "IMAGE_SAFETY"]);

export function fromGemini(response: GeminiResponse, model: string): MessageResponse {
  const candidate = response.candidates?.[0];
  const content: ContentBlock[] = [];
  let calls = 0;
  for (const part of candidate?.content?.parts ?? []) {
    if (part.thoughtSignature) content.push({ type: "thinking", thinking: "", signature: part.thoughtSignature });
    if (part.thought) continue; // thought summaries aren't requested; keep only the signature
    if (part.functionCall) {
      calls++;
      content.push({
        type: "tool_use",
        id: part.functionCall.id ?? `${LOCAL_ID}${calls}`,
        name: part.functionCall.name,
        input: part.functionCall.args ?? {},
      });
    } else if (part.text !== undefined && part.text !== "") {
      content.push({ type: "text", text: part.text });
    }
  }

  let stopReason: StopReason;
  if (!candidate && response.promptFeedback?.blockReason) stopReason = "refusal";
  else if (calls > 0) stopReason = "tool_use";
  else if (candidate?.finishReason === "MAX_TOKENS") stopReason = "max_tokens";
  else if (REFUSALS.has(candidate?.finishReason ?? "")) stopReason = "refusal";
  else stopReason = "end_turn";

  const usage = response.usageMetadata ?? {};
  const cached = usage.cachedContentTokenCount ?? 0;
  return {
    id: response.responseId ?? "gemini",
    model: response.modelVersion ?? model,
    role: "assistant",
    content,
    stop_reason: stopReason,
    usage: {
      input_tokens: (usage.promptTokenCount ?? 0) - cached,
      output_tokens: (usage.candidatesTokenCount ?? 0) + (usage.thoughtsTokenCount ?? 0),
      cache_creation_input_tokens: 0,
      cache_read_input_tokens: cached,
    },
  };
}
