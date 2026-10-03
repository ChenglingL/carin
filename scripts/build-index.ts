// Builds data/index.json from a GitHub repo of Markdown docs.
//
//   npm run index -- --repo ChenglingL/llm-master
//   options: --ref main   --start docs/roadmap/README.md   --count-tokens
//
// --count-tokens asks the Claude API for the doc map's exact token count
// (needs ANTHROPIC_API_KEY in .env; the count_tokens endpoint is free).

import { mkdir, readFile, readdir, stat, writeFile } from "node:fs/promises";
import { parseArgs } from "node:util";
import { buildIndex } from "../src/index/build.ts";
import { estimateTokens, renderDocMap } from "../src/index/doc-map.ts";
import { downloadRepoZip, fetchCommitSha, unzipMarkdown, type RepoSource } from "../src/index/source.ts";
import type { RepoIndex } from "../src/index/types.ts";
import { CACHE_DIR, INDEX_PATH, zipCachePath } from "./paths.ts";

const MODEL = "claude-sonnet-5-5"; // the default model in CLAUDE.md, so counts match what M1 sends

const { values: args } = parseArgs({
  options: {
    repo: { type: "string" },
    ref: { type: "string", default: "main" },
    start: { type: "string" },
    "count-tokens": { type: "boolean", default: false },
  },
});

if (!args.repo || !/^[\w.-]+\/[\w.-]+$/.test(args.repo)) {
  console.error("Usage: npm run index -- --repo owner/name [--ref main] [--start path] [--count-tokens]");
  process.exit(1);
}

const snapshot = await cachedGitHubSource(args.repo, args.ref).load();
const { index, warnings } = buildIndex(snapshot, { start: args.start });
const json = JSON.stringify(index, null, 2);
await mkdir("data", { recursive: true });
await writeFile(INDEX_PATH, json);

const docMap = renderDocMap(index.docs, index.readingPath);
const exact = args["count-tokens"] ? await countTokens(docMap) : null;
printReport(index, docMap, exact, json.length, warnings);

/** GitHub as a RepoSource, with each commit's zip cached under data/cache. */
function cachedGitHubSource(repo: string, ref: string): RepoSource {
  return {
    async load() {
      let commit: string;
      try {
        commit = await fetchCommitSha(fetch, repo, ref);
      } catch (error) {
        const cached = await newestCachedCommit(repo);
        if (!cached) throw error;
        console.warn(`${(error as Error).message}\nOffline? Using the cached zip for ${cached.slice(0, 7)}.`);
        commit = cached;
      }

      const zipPath = zipCachePath(repo, commit);
      let zip: Uint8Array;
      try {
        zip = new Uint8Array(await readFile(zipPath));
        console.log(`Using cached ${zipPath}`);
      } catch {
        console.log(`Downloading ${repo}@${commit.slice(0, 7)} …`);
        zip = await downloadRepoZip(fetch, repo, commit);
        await mkdir(CACHE_DIR, { recursive: true });
        await writeFile(zipPath, zip);
      }
      return { repo, ref, commit, files: unzipMarkdown(zip) };
    },
  };
}

async function newestCachedCommit(repo: string): Promise<string | null> {
  const prefix = `${repo.replace("/", "-")}-`;
  const names = await readdir(CACHE_DIR).catch(() => [] as string[]);
  const zips = names.filter((name) => name.startsWith(prefix) && name.endsWith(".zip"));
  if (zips.length === 0) return null;
  const dated = await Promise.all(zips.map(async (name) => ({ name, at: (await stat(`${CACHE_DIR}/${name}`)).mtimeMs })));
  const newest = dated.sort((a, b) => b.at - a.at)[0]?.name ?? "";
  return newest.slice(prefix.length, -".zip".length);
}

/** Exact count from the Claude API's count_tokens endpoint. */
async function countTokens(text: string): Promise<number | null> {
  try {
    process.loadEnvFile(".env");
  } catch {
    // no .env file; the key may still be in the environment
  }
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) {
    console.warn("--count-tokens: ANTHROPIC_API_KEY isn't set in .env or the environment; skipping the exact count.");
    return null;
  }
  const res = await fetch("https://api.anthropic.com/v1/messages/count_tokens", {
    method: "POST",
    headers: { "x-api-key": key, "anthropic-version": "2023-06-01", "content-type": "application/json" },
    body: JSON.stringify({ model: MODEL, messages: [{ role: "user", content: text }] }),
  });
  if (!res.ok) throw new Error(`count_tokens: ${res.status} ${await res.text()}`);
  const body = (await res.json()) as { input_tokens: number };
  return body.input_tokens;
}

function printReport(index: RepoIndex, docMap: string, exact: number | null, bytes: number, warnings: string[]): void {
  const { meta, docs, sections, concepts, readingPath } = index;
  const count = (kind: string) => docs.filter((d) => d.kind === kind).length;
  const estimate = estimateTokens(docMap);
  const topConcepts = [...concepts]
    .map((c) => ({ term: c.term, docs: c.explains.length + c.uses.length }))
    .sort((a, b) => b.docs - a.docs)
    .slice(0, 15);
  const kv = concepts.find((c) => c.id === "kv cache");
  const k = (n: number) => `${(n / 1000).toFixed(1)}K`;

  console.log(`
Built ${INDEX_PATH} from ${meta.repo}@${meta.ref} (${meta.commit.slice(0, 7)}), ${(bytes / 1e6).toFixed(1)} MB
  files        ${docs.length}: ${count("doc")} docs, ${count("hub")} hubs, ${count("stub")} stubs
  sections     ${sections.length}
  concepts     ${concepts.length}
  reading path ${readingPath.length} docs, starting from ${meta.start}
${readingPath.slice(0, 10).map((r) => `               ${r.position}. ${r.path}`).join("\n")}
  doc map      ${docMap.split("\n").length} lines, ${docMap.length} chars, ~${k(estimate)} tokens (estimate)${
    exact === null ? "" : `\n               ${k(exact)} tokens (count_tokens, ${MODEL}); estimate is off by ${(((estimate - exact) / exact) * 100).toFixed(0)}%`
  }
  KV Cache     ${kv ? `explained in ${kv.explains.length}, used in ${kv.uses.length}: ${[...kv.explains, ...kv.uses].map((r) => r.doc.split("/").at(-1)).join(", ")}` : "(no concept)"}
  most widely used concepts:
               ${topConcepts.map((c) => `${c.term} (${c.docs})`).join(", ")}`);

  if (warnings.length > 0) console.log(`\n${warnings.length} warnings:\n  ${warnings.join("\n  ")}`);
}
