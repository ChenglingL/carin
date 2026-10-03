import type { DocRecord, PathRecord } from "./types.ts";

/**
 * The doc map as the model sees it: one line per content doc, in reading-path order.
 * `path | title | keyword, keyword, …`
 * It goes first in every prompt and doesn't depend on the reader, so it can be cached.
 */
export function renderDocMap(docs: readonly DocRecord[], readingPath: readonly PathRecord[]): string {
  const byPath = new Map(docs.map((doc) => [doc.path, doc]));
  const lines: string[] = [];
  for (const { path } of readingPath) {
    const doc = byPath.get(path);
    if (doc?.kind !== "doc") continue;
    const parts = [doc.path, doc.title];
    if (doc.keywords.length > 0) parts.push(doc.keywords.join(", "));
    lines.push(parts.join(" | "));
  }
  return lines.join("\n");
}

// Offline estimate, good enough for budgets and tests. Chinese runs about one token
// per character; other text about 3.5 characters per token. `npm run index -- --count-tokens`
// asks the API for the real count; adjust these if the two drift more than ~15% apart.
export const TOKENS_PER_CJK_CHAR = 1.0;
export const CHARS_PER_OTHER_TOKEN = 3.5;

const CJK = /[　-〿㐀-䶿一-鿿豈-﫿＀-￯]/;

export function estimateTokens(text: string): number {
  let cjk = 0;
  let other = 0;
  for (const char of text) {
    if (CJK.test(char)) cjk++;
    else other++;
  }
  return Math.round(cjk * TOKENS_PER_CJK_CHAR + other / CHARS_PER_OTHER_TOKEN);
}
