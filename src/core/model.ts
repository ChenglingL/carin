// The Claude Messages API, through plain fetch (docs/PLAN.md: "No SDK needed, and easy to read").
// Only the fields Cairn sends and reads are typed. Block types the API adds later
// (e.g. a refusal-fallback block) arrive at runtime and are passed back untouched.

export type Effort = "low" | "medium" | "high" | "xhigh" | "max";
export type StopReason = "end_turn" | "max_tokens" | "stop_sequence" | "tool_use" | "pause_turn" | "refusal";

export interface CacheControl {
  type: "ephemeral";
  ttl?: "5m" | "1h";
}

export interface TextBlock {
  type: "text";
  text: string;
  cache_control?: CacheControl;
}
export interface ThinkingBlock {
  type: "thinking";
  thinking: string; // empty unless display is "summarized"; send it back unchanged anyway
  signature: string;
}
export interface RedactedThinkingBlock {
  type: "redacted_thinking";
  data: string;
}
export interface ToolUseBlock {
  type: "tool_use";
  id: string;
  name: string;
  input: unknown;
}
export interface ToolResultBlock {
  type: "tool_result";
  tool_use_id: string;
  content: string;
  is_error?: boolean;
  cache_control?: CacheControl;
}
export type ContentBlock = TextBlock | ThinkingBlock | RedactedThinkingBlock | ToolUseBlock | ToolResultBlock;

export interface MessageParam {
  role: "user" | "assistant";
  content: string | ContentBlock[];
}

export type JsonSchema = { [key: string]: unknown };

export interface ToolDefinition {
  name: string;
  description: string;
  input_schema: JsonSchema;
  strict?: boolean;
  cache_control?: CacheControl;
}

export interface MessageRequest {
  model: string;
  max_tokens: number;
  system?: TextBlock[];
  messages: MessageParam[];
  tools?: ToolDefinition[];
  tool_choice?: { type: "auto" | "none" }; // "any" and "tool" are rejected by Sonnet 5.5
  output_config?: { effort?: Effort; format?: { type: "json_schema"; schema: JsonSchema } };
  cache_control?: CacheControl; // top-level: caches up to the last cacheable block
}

export interface Usage {
  input_tokens: number; // uncached input only
  output_tokens: number; // includes thinking
  cache_creation_input_tokens?: number | null;
  cache_read_input_tokens?: number | null;
}

export interface MessageResponse {
  id: string;
  model: string;
  role: "assistant";
  content: ContentBlock[];
  stop_reason: StopReason | null;
  usage: Usage;
}

/** Everything that talks to the model goes through this, so tests and evals can swap it. */
export interface ModelClient {
  createMessage(request: MessageRequest): Promise<MessageResponse>;
}

export const DEFAULT_MODEL = "claude-sonnet-5-5";
export const CHEAP_MODEL = "claude-haiku-4-5-20251001";

interface ModelInfo {
  effort: boolean; // accepts output_config.effort
  fallbacks: boolean; // accepts server-side refusal fallbacks: "default"
  price: { input: number; output: number; cacheWrite: number; cacheRead: number }; // USD per million tokens
}

const MODELS: Record<string, ModelInfo> = {
  [DEFAULT_MODEL]: { effort: true, fallbacks: true, price: { input: 2, output: 10, cacheWrite: 2.5, cacheRead: 0.2 } },
  [CHEAP_MODEL]: { effort: false, fallbacks: false, price: { input: 1, output: 5, cacheWrite: 1.25, cacheRead: 0.1 } },
};

function modelInfo(model: string): ModelInfo {
  return MODELS[model] ?? { effort: true, fallbacks: false, price: { input: 0, output: 0, cacheWrite: 0, cacheRead: 0 } };
}

/** Rough cost of one response, in USD. Unknown models count as free. */
export function costUsd(model: string, usage: Usage): number {
  const { price } = modelInfo(model);
  return (
    (usage.input_tokens * price.input +
      usage.output_tokens * price.output +
      (usage.cache_creation_input_tokens ?? 0) * price.cacheWrite +
      (usage.cache_read_input_tokens ?? 0) * price.cacheRead) /
    1_000_000
  );
}

// Only the parts of fetch used here, so src/core needs neither DOM nor Node types.
export type PostFetch = (
  url: string,
  init: { method: "POST"; headers: Record<string, string>; body: string },
) => Promise<{ ok: boolean; status: number; json(): Promise<unknown>; text(): Promise<string> }>;

export class ModelError extends Error {
  status: number;
  body: string;
  retryAfterMs: number | null; // how long the API asked us to wait, when it said
  constructor(status: number, body: string) {
    super(`Model API ${status}: ${shortMessage(body)}`);
    this.name = "ModelError";
    this.status = status;
    this.body = body;
    this.retryAfterMs = retryAfter(body);
  }
}

/** The error's own message (both APIs nest it under error.message), first line only. */
function shortMessage(body: string): string {
  try {
    const parsed = JSON.parse(body) as { error?: { message?: unknown } };
    if (typeof parsed.error?.message === "string") return parsed.error.message.split("\n")[0]?.slice(0, 300) ?? "";
  } catch {
    // not JSON
  }
  return body.slice(0, 300);
}

/** Gemini says how long to wait, e.g. "retryDelay": "33s" or "Please retry in 21h1m53s". */
function retryAfter(body: string): number | null {
  const delay = /"retryDelay":\s*"(\d+(?:\.\d+)?)s"/.exec(body);
  if (delay?.[1]) return Math.ceil(Number(delay[1]) * 1000);
  const text = /retry in ((?:\d+h)?(?:\d+m)?(?:\d+(?:\.\d+)?s)?)/.exec(body)?.[1];
  if (!text) return null;
  const part = (unit: string) => Number(new RegExp(`(\\d+(?:\\.\\d+)?)${unit}`).exec(text)?.[1] ?? 0);
  return Math.ceil((part("h") * 3600 + part("m") * 60 + part("s")) * 1000) || null;
}

export interface ClientOptions {
  apiKey: string;
  fetch: PostFetch;
  browser?: boolean; // true in the extension: direct browser calls need an extra header
  baseUrl?: string;
}

/**
 * A ModelClient over the Messages API. It adapts each request to its model:
 * Sonnet 5.5 gets server-side refusal fallbacks; models that reject `effort` lose it.
 * No retries yet: errors surface as ModelError.
 */
export function anthropicClient(options: ClientOptions): ModelClient {
  const baseUrl = options.baseUrl ?? "https://api.anthropic.com";
  return {
    async createMessage(request) {
      const info = modelInfo(request.model);
      const headers: Record<string, string> = {
        "x-api-key": options.apiKey,
        "anthropic-version": "2023-06-01",
        "content-type": "application/json",
      };
      const body: Record<string, unknown> = { ...request };

      if (!info.effort && request.output_config?.effort) {
        const { effort: _dropped, ...rest } = request.output_config;
        body.output_config = Object.keys(rest).length > 0 ? rest : undefined;
      }
      if (info.fallbacks) {
        body.fallbacks = "default";
        headers["anthropic-beta"] = "server-side-fallback-2026-07-01";
      }
      if (options.browser) headers["anthropic-dangerous-direct-browser-access"] = "true";

      const res = await options.fetch(`${baseUrl}/v1/messages`, { method: "POST", headers, body: JSON.stringify(body) });
      if (!res.ok) throw new ModelError(res.status, await res.text());
      return (await res.json()) as MessageResponse;
    },
  };
}

const RETRYABLE = new Set([429, 500, 502, 503, 504, 529]); // rate limits and temporary overload

export interface RetryOptions {
  sleep: (ms: number) => Promise<void>; // injected: timers aren't part of the portable core
  retries?: number; // extra attempts after the first (default 3)
  baseMs?: number; // first wait; doubles each time (default 2000)
  maxWaitMs?: number; // longer waits the API asks for aren't worth it: fail instead (default 65000)
}

/** Wraps a client so busy or rate-limited calls are retried with growing waits. Other errors pass through. */
export function withRetries(client: ModelClient, options: RetryOptions): ModelClient {
  const retries = options.retries ?? 3;
  const baseMs = options.baseMs ?? 2000;
  return {
    async createMessage(request) {
      for (let attempt = 0; ; attempt++) {
        try {
          return await client.createMessage(request);
        } catch (error) {
          if (!(error instanceof ModelError) || !RETRYABLE.has(error.status) || attempt >= retries) throw error;
          const wait = error.retryAfterMs ?? baseMs * 2 ** attempt;
          if (wait > (options.maxWaitMs ?? 65_000)) throw error; // e.g. a daily quota: retrying won't help
          await options.sleep(wait);
        }
      }
    },
  };
}

/**
 * Moves to the next model in `models` when one is out of quota (a 429 the API won't lift soon),
 * and remembers that, so later calls skip it. Meant for free tiers with a daily quota per model.
 * Requests for a model outside the list pass through unchanged.
 */
export function withModelFallback(client: ModelClient, models: string[], onSwitch?: (from: string, to: string) => void): ModelClient {
  const exhausted = new Set<string>();
  return {
    async createMessage(request) {
      const start = models.indexOf(request.model);
      if (start === -1) return client.createMessage(request);
      for (const model of models.slice(start)) {
        if (exhausted.has(model)) continue;
        try {
          return await client.createMessage({ ...request, model });
        } catch (error) {
          if (!(error instanceof ModelError) || error.status !== 429) throw error;
          exhausted.add(model);
          const next = models.slice(models.indexOf(model) + 1).find((m) => !exhausted.has(m));
          if (next) onSwitch?.(model, next);
        }
      }
      throw new ModelError(429, `{"error":{"message":"Every model in the fallback list is out of quota: ${models.join(", ")}"}}`);
    },
  };
}
