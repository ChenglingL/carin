import { strFromU8, unzipSync } from "fflate";

export interface RepoFile {
  path: string; // repo-relative
  text: string;
}

export interface RepoSnapshot {
  repo: string; // "owner/name"
  ref: string;
  commit: string;
  files: RepoFile[]; // Markdown files only, sorted by path
}

/** Where a repo's files come from. The Node script caches zips on disk;
 *  the extension (M2) will keep them in IndexedDB. */
export interface RepoSource {
  load(): Promise<RepoSnapshot>;
}

// Only the parts of fetch used here, so this file needs neither DOM nor Node types.
export interface FetchResponse {
  ok: boolean;
  status: number;
  statusText: string;
  json(): Promise<unknown>;
  arrayBuffer(): Promise<ArrayBuffer>;
}
export type FetchLike = (url: string, init?: { headers?: Record<string, string> }) => Promise<FetchResponse>;

/** One GitHub API call: the commit SHA a branch or tag points to. */
export async function fetchCommitSha(fetch: FetchLike, repo: string, ref: string): Promise<string> {
  const res = await fetch(`https://api.github.com/repos/${repo}/commits/${encodeURIComponent(ref)}`, {
    headers: { Accept: "application/vnd.github+json" },
  });
  if (!res.ok) throw new Error(`GitHub API: ${res.status} ${res.statusText} for ${repo}@${ref}`);
  const body = (await res.json()) as { sha?: unknown };
  if (typeof body.sha !== "string") throw new Error(`GitHub API: no commit SHA for ${repo}@${ref}`);
  return body.sha;
}

/** The whole repo at one commit, as a single zip download. */
export async function downloadRepoZip(fetch: FetchLike, repo: string, commit: string): Promise<Uint8Array> {
  const res = await fetch(`https://codeload.github.com/${repo}/zip/${commit}`);
  if (!res.ok) throw new Error(`Zip download: ${res.status} ${res.statusText} for ${repo}@${commit}`);
  return new Uint8Array(await res.arrayBuffer());
}

/** Markdown files from a GitHub zip. GitHub puts everything under one top folder
 *  ("llm-master-<sha>/"), which is dropped from the paths. Line endings become \n. */
export function unzipMarkdown(zip: Uint8Array): RepoFile[] {
  const entries = unzipSync(zip, { filter: (file) => file.name.toLowerCase().endsWith(".md") });
  return Object.entries(entries)
    .map(([name, bytes]) => ({
      path: name.slice(name.indexOf("/") + 1),
      text: strFromU8(bytes).replace(/^﻿/, "").replace(/\r\n?/g, "\n"),
    }))
    .filter((file) => file.path !== "")
    .sort((a, b) => compareStrings(a.path, b.path));
}

/** Plain code-point order, the same in every runtime (localeCompare isn't). */
export function compareStrings(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}
