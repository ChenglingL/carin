import { compareStrings } from "./source.ts";
import type { DocKind, PathRecord } from "./types.ts";

/**
 * Orders docs the way the repo's roadmap links them.
 *
 * Starting from `start`, follow links depth-first in document order:
 * a hub is opened where its link appears, a doc joins the path the first time
 * it's seen, stubs are skipped. Links inside docs are not followed, so an article's
 * "see also" can't reorder the curriculum. Docs the walk never reaches go last, in path order.
 *
 * @param kinds every page in the repo and its kind
 * @param links each page's links to other pages, in document order
 */
export function buildReadingPath(
  start: string,
  kinds: ReadonlyMap<string, DocKind>,
  links: ReadonlyMap<string, readonly string[]>,
): PathRecord[] {
  const path: PathRecord[] = [];
  const onPath = new Set<string>();
  const opened = new Set<string>();

  const add = (page: string, via: string | null) => {
    onPath.add(page);
    path.push({ path: page, position: path.length + 1, via });
  };

  const open = (hub: string) => {
    opened.add(hub);
    for (const target of links.get(hub) ?? []) {
      const kind = kinds.get(target);
      if (kind === "hub" && !opened.has(target)) open(target);
      else if (kind === "doc" && !onPath.has(target)) add(target, hub);
    }
  };

  open(start); // the start page is opened even when it's a doc, e.g. a README
  const rest = [...kinds].filter(([page, kind]) => kind === "doc" && !onPath.has(page)).map(([page]) => page);
  for (const page of rest.sort(compareStrings)) add(page, null);
  return path;
}

/** The roadmap page to start from: a roadmap folder's README, else roadmap.md, else the root README. */
export function findStartPage(paths: readonly string[]): string | null {
  const patterns = [/(^|\/)roadmap\/readme\.md$/i, /(^|\/)roadmap\.md$/i, /^readme\.md$/i];
  for (const pattern of patterns) {
    const found = [...paths].sort(compareStrings).find((p) => pattern.test(p));
    if (found) return found;
  }
  return null;
}
