// Reading the GitHub page: which repo and doc, and which section a selection is in.

export interface PageInfo {
  repo: string; // "owner/name"
  ref: string; // branch, tag or SHA from the URL; "HEAD" on the repo's front page
  path: string; // repo-relative Markdown path
  url: string;
}

/** What the content script reports when the reader selects text. */
export interface SelectionInfo {
  page: PageInfo;
  selection: string;
  anchor: string | null; // GitHub's anchor of the section the selection starts in
}

const NOT_REPOS = new Set(["settings", "orgs", "features", "marketplace", "notifications", "pulls", "issues", "explore", "topics", "sponsors", "login", "search"]);

/** A Markdown doc on github.com: a blob URL ending in .md, or a repo's front page (its README). */
export function parseGithubUrl(url: string): PageInfo | null {
  const match = /^https:\/\/github\.com\/([^/?#]+)\/([^/?#]+)(?:\/blob\/([^/?#]+)\/([^?#]+))?\/?(?:[?#].*)?$/.exec(url);
  if (!match) return null;
  const [, owner, name, ref, rawPath] = match;
  if (!owner || !name || NOT_REPOS.has(owner)) return null;
  if (!ref || !rawPath) return { repo: `${owner}/${name}`, ref: "HEAD", path: "README.md", url };
  let path = rawPath;
  try {
    path = decodeURIComponent(rawPath);
  } catch {
    // keep it as written
  }
  if (!/\.md$/i.test(path)) return null;
  return { repo: `${owner}/${name}`, ref, path, url };
}

/**
 * The anchor of the section that contains `node`: the last heading anchor before it in the rendered
 * Markdown. GitHub renders each heading with an `a.anchor` link whose href is "#<anchor>".
 */
export function sectionAnchorBefore(node: Node): string | null {
  const start = node instanceof Element ? node : node.parentElement;
  const body = start?.closest(".markdown-body") ?? document.querySelector(".markdown-body");
  if (!body || !start) return null;

  const ownHeading = start.closest(".markdown-heading")?.querySelector<HTMLAnchorElement>("a.anchor[href^='#']");
  if (ownHeading) return decode(ownHeading.getAttribute("href") ?? "");

  let found: string | null = null;
  for (const link of body.querySelectorAll<HTMLAnchorElement>("a.anchor[href^='#']")) {
    const linkIsBefore = (link.compareDocumentPosition(start) & Node.DOCUMENT_POSITION_FOLLOWING) !== 0;
    if (!linkIsBefore) break;
    found = link.getAttribute("href");
  }
  return found ? decode(found) : null;
}

function decode(href: string): string {
  const anchor = href.replace(/^#/, "");
  try {
    return decodeURIComponent(anchor);
  } catch {
    return anchor;
  }
}
