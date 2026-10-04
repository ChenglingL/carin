import { describe, expect, it } from "vitest";
import { anthropicClient, CHEAP_MODEL, costUsd, DEFAULT_MODEL, ModelError, withModelFallback, withRetries, type MessageRequest, type PostFetch } from "./model.ts";

function recordingFetch(status = 200, body: unknown = { content: [] }) {
  const calls: { url: string; headers: Record<string, string>; body: Record<string, unknown> }[] = [];
  const fetch: PostFetch = async (url, init) => {
    calls.push({ url, headers: init.headers, body: JSON.parse(init.body) });
    return { ok: status < 400, status, json: async () => body, text: async () => JSON.stringify(body) };
  };
  return { fetch, calls };
}

const request = (model: string): MessageRequest => ({
  model,
  max_tokens: 1000,
  messages: [{ role: "user", content: "hi" }],
  output_config: { effort: "low" },
});

describe("anthropicClient", () => {
  it("posts to the Messages API with the key and version", async () => {
    const { fetch, calls } = recordingFetch();
    await anthropicClient({ apiKey: "test-key", fetch }).createMessage(request(DEFAULT_MODEL));
    expect(calls[0]?.url).toBe("https://api.anthropic.com/v1/messages");
    expect(calls[0]?.headers).toMatchObject({ "x-api-key": "test-key", "anthropic-version": "2023-06-01" });
    expect(calls[0]?.headers).not.toHaveProperty("anthropic-dangerous-direct-browser-access");
  });

  it("opts Sonnet 5.5 into refusal fallbacks and keeps its effort", async () => {
    const { fetch, calls } = recordingFetch();
    await anthropicClient({ apiKey: "k", fetch }).createMessage(request(DEFAULT_MODEL));
    expect(calls[0]?.headers["anthropic-beta"]).toBe("server-side-fallback-2026-07-01");
    expect(calls[0]?.body).toMatchObject({ fallbacks: "default", output_config: { effort: "low" } });
  });

  it("drops effort and fallbacks for Haiku 4.5, which rejects them", async () => {
    const { fetch, calls } = recordingFetch();
    await anthropicClient({ apiKey: "k", fetch }).createMessage(request(CHEAP_MODEL));
    expect(calls[0]?.body).not.toHaveProperty("fallbacks");
    expect(calls[0]?.body.output_config).toBeUndefined();
    expect(calls[0]?.headers).not.toHaveProperty("anthropic-beta");
  });

  it("adds the browser header in the extension", async () => {
    const { fetch, calls } = recordingFetch();
    await anthropicClient({ apiKey: "k", fetch, browser: true }).createMessage(request(DEFAULT_MODEL));
    expect(calls[0]?.headers["anthropic-dangerous-direct-browser-access"]).toBe("true");
  });

  it("throws ModelError with the status and body on failure", async () => {
    const { fetch } = recordingFetch(429, { error: { type: "rate_limit_error" } });
    const call = anthropicClient({ apiKey: "k", fetch }).createMessage(request(DEFAULT_MODEL));
    await expect(call).rejects.toBeInstanceOf(ModelError);
    await expect(call).rejects.toMatchObject({ status: 429 });
  });
});

describe("costUsd", () => {
  it("prices input, output and cache tokens separately", () => {
    const usage = { input_tokens: 1_000_000, output_tokens: 100_000, cache_read_input_tokens: 1_000_000, cache_creation_input_tokens: 0 };
    expect(costUsd(DEFAULT_MODEL, usage)).toBeCloseTo(2 + 1 + 0.2);
  });
});

describe("withRetries", () => {
  const failing = (statuses: number[]) => {
    let calls = 0;
    const client = {
      async createMessage() {
        const status = statuses[calls++];
        if (status) throw new ModelError(status, "busy");
        return { id: "ok", model: "m", role: "assistant" as const, content: [], stop_reason: "end_turn" as const, usage: { input_tokens: 0, output_tokens: 0 } };
      },
    };
    return { client, calls: () => calls };
  };
  const waits: number[] = [];
  const sleep = async (ms: number) => void waits.push(ms);

  it("retries busy and rate-limited calls with doubling waits", async () => {
    waits.length = 0;
    const { client, calls } = failing([503, 429]);
    await withRetries(client, { sleep }).createMessage(request(DEFAULT_MODEL));
    expect(calls()).toBe(3);
    expect(waits).toEqual([2000, 4000]);
  });

  it("gives up after the last retry, and never retries other errors", async () => {
    await expect(withRetries(failing([503, 503]).client, { sleep, retries: 1 }).createMessage(request(DEFAULT_MODEL))).rejects.toMatchObject({ status: 503 });
    const bad = failing([400]);
    await expect(withRetries(bad.client, { sleep }).createMessage(request(DEFAULT_MODEL))).rejects.toMatchObject({ status: 400 });
    expect(bad.calls()).toBe(1);
  });
});

describe("ModelError", () => {
  it("keeps only the API's own message and reads how long to wait", () => {
    const body = JSON.stringify({ error: { code: 429, message: "Quota exceeded.\n* limit: 5", details: [{ retryDelay: "33s" }] } });
    const error = new ModelError(429, body);
    expect(error.message).toBe("Model API 429: Quota exceeded.");
    expect(error.retryAfterMs).toBe(33000);
    expect(new ModelError(429, '{"error":{"message":"Please retry in 21h1m53.2s."}}').retryAfterMs).toBe(75713200);
  });
});

describe("withRetries and the API's requested wait", () => {
  it("waits as long as asked, and gives up when that's too long", async () => {
    const waits: number[] = [];
    let calls = 0;
    const flaky = {
      async createMessage() {
        calls++;
        if (calls === 1) throw new ModelError(429, '{"error":{"message":"slow down"},"retryDelay": "20s"}');
        if (calls === 2) throw new ModelError(429, '{"error":{"message":"Please retry in 21h1m3s."}}');
        throw new Error("unreachable");
      },
    };
    const call = withRetries(flaky, { sleep: async (ms) => void waits.push(ms) }).createMessage(request(DEFAULT_MODEL));
    await expect(call).rejects.toMatchObject({ status: 429 });
    expect(waits).toEqual([20000]);
  });
});

describe("withModelFallback", () => {
  it("moves to the next model on a 429 and skips exhausted models afterwards", async () => {
    const seen: string[] = [];
    const client = {
      async createMessage(req: MessageRequest) {
        seen.push(req.model);
        if (req.model === "a") throw new ModelError(429, "{}");
        return { id: "ok", model: req.model, role: "assistant" as const, content: [], stop_reason: "end_turn" as const, usage: { input_tokens: 0, output_tokens: 0 } };
      },
    };
    const switches: string[] = [];
    const fallback = withModelFallback(client, ["a", "b"], (from, to) => switches.push(`${from}→${to}`));
    expect((await fallback.createMessage(request("a"))).model).toBe("b");
    expect((await fallback.createMessage(request("a"))).model).toBe("b");
    expect(seen).toEqual(["a", "b", "b"]);
    expect(switches).toEqual(["a→b"]);
  });

  it("passes other errors and other models through", async () => {
    const client = { async createMessage(): Promise<never> { throw new ModelError(400, "{}"); } };
    await expect(withModelFallback(client, ["a", "b"]).createMessage(request("a"))).rejects.toMatchObject({ status: 400 });
  });
});
