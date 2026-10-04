// Shared setup for the Node entry points that call the model: the API key, the index, the model.

import { existsSync, readFileSync } from "node:fs";
import { GEMINI_FALLBACKS, GEMINI_MODEL, geminiClient } from "../src/core/gemini.ts";
import { anthropicClient, CHEAP_MODEL, DEFAULT_MODEL, withModelFallback, withRetries, type ModelClient } from "../src/core/model.ts";
import { openRepo, type Repo } from "../src/core/repo.ts";
import type { RepoIndex } from "../src/index/types.ts";
import { INDEX_PATH } from "./paths.ts";

/** An API key from .env or the environment; exits with a hint when there is none. */
function key(name: "GEMINI_API_KEY" | "ANTHROPIC_API_KEY"): string {
  try {
    process.loadEnvFile(".env");
  } catch {
    // no .env; the key may be in the environment
  }
  const value = process.env[name];
  if (!value) {
    console.error(`${name} isn't set. Add it to .env (see .env.example).`);
    process.exit(1);
  }
  return value;
}

/** The client for a model id: Gemini models go to Google, everything else to Anthropic. */
export function client(model: string): ModelClient {
  const base = model.startsWith("gemini")
    ? geminiClient({ apiKey: key("GEMINI_API_KEY"), fetch })
    : anthropicClient({ apiKey: key("ANTHROPIC_API_KEY"), fetch });
  const retrying = withRetries(base, {
    sleep: (ms) => {
      console.warn(`  (model busy or rate-limited; retrying in ${Math.round(ms / 1000)}s)`);
      return new Promise((resolve) => setTimeout(resolve, ms));
    },
  });
  // Gemini's free tier has a daily quota per model: when one runs out, use the next.
  return withModelFallback(retrying, GEMINI_FALLBACKS, (from, to) => console.warn(`  (${from} is out of quota; using ${to})`));
}

export function repo(): Repo {
  if (!existsSync(INDEX_PATH)) {
    console.error(`${INDEX_PATH} is missing. Run: npm run index -- --repo ChenglingL/llm-master`);
    process.exit(1);
  }
  return openRepo(JSON.parse(readFileSync(INDEX_PATH, "utf8")) as RepoIndex);
}

/** "gemini" (default, free tier), "sonnet", "haiku", or a full model id. */
export function model(name: string | undefined): string {
  if (!name || name === "gemini") return GEMINI_MODEL;
  if (name === "sonnet") return DEFAULT_MODEL;
  if (name === "haiku") return CHEAP_MODEL;
  return name;
}
