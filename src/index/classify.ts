import type { DocKind } from "./types.ts";

// Thresholds, checked against llm-master: its roadmap and topic pages have
// 20–700 characters outside links; its shortest real doc has over 2,000.
export const HUB_MIN_LINKS = 3;
export const HUB_MAX_TEXT = 1000;
export const STUB_MAX_TEXT = 300;

/**
 * Characters a reader would read that aren't link text, markup or whitespace.
 * Pages made of links score low even when they're long.
 */
export function textOutsideLinks(body: string): number {
  return body
    .replace(/<[^>]+>/g, "")
    .replace(/!?\[[^\]]*\]\([^)]*\)/g, "")
    .replace(/[#>*|\-\s]/g, "").length;
}

/**
 * hub: links to at least 3 other docs in the repo, with little text of its own.
 * stub: almost no text (a redirect, or a pointer to another site).
 * doc: everything else.
 */
export function classifyDoc(body: string, linkedDocCount: number): DocKind {
  const text = textOutsideLinks(body);
  if (linkedDocCount >= HUB_MIN_LINKS && text < HUB_MAX_TEXT) return "hub";
  if (text < STUB_MAX_TEXT) return "stub";
  return "doc";
}
