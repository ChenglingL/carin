// The side panel's link to the agent core: loads (or builds) the repo index in the browser,
// makes the model client from the settings, and runs actions. Same src/index and src/core code as the Node scripts.

import { runAction } from "../../core/actions.ts";
import { GEMINI_FALLBACKS, geminiClient } from "../../core/gemini.ts";
import { anthropicClient, withModelFallback, withRetries, type ModelClient } from "../../core/model.ts";
import { openRepo, type Repo } from "../../core/repo.ts";
import type { Action, AnswerResult, MemorySlice, Question } from "../../core/types.ts";
import { buildIndex } from "../../index/build.ts";
import { downloadRepoZip, fetchCommitSha, unzipMarkdown } from "../../index/source.ts";
import { deleteIndex, getIndex, putIndex } from "./index-store.ts";
import type { Keys, Settings } from "./settings.ts";

const httpFetch = (url: string, init?: RequestInit) => fetch(url, init); // unbound fetch throws "Illegal invocation"

/**
 * The repo's index: from IndexedDB when it matches the latest commit, otherwise downloaded and built here.
 * One GitHub API call per load checks the latest commit (docs/PLAN.md § Repo index).
 */
export async function loadRepo(repo: string, ref: string, onStatus: (status: string) => void): Promise<Repo> {
  onStatus("Checking for changes…");
  const stored = await getIndex(repo);
  let commit: string;
  try {
    commit = await fetchCommitSha(httpFetch, repo, ref);
  } catch (error) {
    if (stored) return openRepo(stored); // offline or rate-limited: the last index is fine
    throw error;
  }
  if (stored?.meta.commit === commit) return openRepo(stored);

  onStatus(`Downloading ${repo}…`);
  const files = unzipMarkdown(await downloadRepoZip(httpFetch, repo, commit));
  onStatus(`Indexing ${files.length} docs…`);
  await new Promise((resolve) => setTimeout(resolve, 0)); // let the status render before the busy part
  const { index } = buildIndex({ repo, ref, commit, files });
  await putIndex(index);
  return openRepo(index);
}

export function forgetRepo(repo: string): Promise<void> {
  return deleteIndex(repo);
}

export function makeClient(settings: Settings, keys: Keys, onNote: (note: string) => void): ModelClient {
  const key = keys[settings.provider];
  if (!key) throw new Error(`Add your ${settings.provider === "gemini" ? "Gemini" : "Claude"} API key in Settings.`);
  const base =
    settings.provider === "gemini"
      ? geminiClient({ apiKey: key, fetch: httpFetch })
      : anthropicClient({ apiKey: key, fetch: httpFetch, browser: true });
  const retrying = withRetries(base, {
    sleep: (ms) => {
      onNote(`Model busy or rate-limited; retrying in ${Math.round(ms / 1000)}s…`);
      return new Promise((resolve) => setTimeout(resolve, ms));
    },
  });
  return withModelFallback(retrying, GEMINI_FALLBACKS, (from, to) => onNote(`${from} is out of today's quota; using ${to}.`));
}

/** No memory until M3: every question starts from a blank reader. */
export const BLANK_MEMORY: MemorySlice = {
  profile: { language: "match", length: "short", background: "", skip: [] },
  readDocs: [],
  concepts: [],
  threads: [],
};

export function ask(
  action: Action,
  question: Question,
  repo: Repo,
  settings: Settings,
  keys: Keys,
  onNote: (note: string) => void,
): Promise<AnswerResult> {
  const base = makeClient(settings, keys, onNote);
  let calls = 0;
  const client: ModelClient = {
    createMessage(request) {
      calls++;
      onNote(calls === 1 ? "Thinking…" : `Step ${calls}: reading what the search found…`);
      return base.createMessage(request);
    },
  };
  return runAction(action, question, BLANK_MEMORY, { client, repo, model: settings.model });
}
