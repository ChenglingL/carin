import GithubSlugger from "github-slugger";

export interface ParsedSection {
  level: number; // 1–6; 0 for text before the first heading
  heading: string; // plain text
  anchor: string; // GitHub's anchor; "" for text before the first heading
  trail: string[]; // parent headings, outermost first
  text: string; // Markdown under the heading, up to the next heading of any level
}

export interface DocLink {
  target: string; // repo-relative path, as written after resolving ./ and ../
  anchor: string | null; // decoded, without "#"
}

// A fence may be indented (inside a list item); it closes with the same character, at least as long.
const FENCE = /^[ \t]*(`{3,}|~{3,})/;
// ATX heading: 1–6 "#", then a space or end of line, optional closing "#"s.
const ATX = /^ {0,3}(#{1,6})(?:[ \t]+(.*?))?(?:[ \t]+#+)?[ \t]*$/;

/** Removes what GitHub never renders as text: HTML comments and script/style blocks. */
export function cleanBody(body: string): string {
  return body.replace(/<!--[\s\S]*?-->/g, "").replace(/<(script|style)\b[\s\S]*?<\/\1>/gi, "");
}

/**
 * Calls `onLine` for every line outside fenced code blocks,
 * and `onCode` for lines inside them (fence lines included).
 */
function scanLines(body: string, onLine: (line: string) => void, onCode: (line: string) => void = () => {}): void {
  let fence: { char: string; length: number } | null = null;
  for (const line of body.split("\n")) {
    const marker = FENCE.exec(line)?.[1];
    if (fence) {
      if (marker && marker[0] === fence.char && marker.length >= fence.length && line.trim() === marker) fence = null;
      onCode(line);
    } else if (marker) {
      fence = { char: marker[0] ?? "`", length: marker.length };
      onCode(line);
    } else {
      onLine(line);
    }
  }
}

/**
 * Heading text as GitHub renders it, which is what its anchor is built from:
 * links keep their text, images vanish, emphasis and code markers go.
 */
export function headingText(raw: string): string {
  return raw
    .replace(/!\[[^\]]*\]\([^)]*\)/g, "") // images
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1") // inline links
    .replace(/\[([^\]]*)\]\[[^\]]*\]/g, "$1") // reference links
    .replace(/<[^>]+>/g, "") // HTML tags
    .replace(/`([^`]*)`/g, "$1") // code spans
    .replace(/(\*{1,3}|~~)(\S(?:.*?\S)?)\1/g, "$2") // *em*, **strong**, ~~strike~~
    .replace(/(^|[^\p{L}\p{N}_])(_{1,3})(\S(?:.*?\S)?)\2(?=$|[^\p{L}\p{N}_])/gu, "$1$3") // _em_, __strong__
    .replace(/\\([!-/:-@[-`{-~])/g, "$1") // backslash escapes
    .trim();
}

/** Splits a Markdown body into flat sections, one per heading, with GitHub anchors. */
export function splitSections(body: string): ParsedSection[] {
  const slugger = new GithubSlugger(); // one per doc: repeated headings get -1, -2, … like on GitHub
  const sections: ParsedSection[] = [];
  const parents: { level: number; heading: string }[] = [];
  let current: ParsedSection = { level: 0, heading: "", anchor: "", trail: [], text: "" };
  let lines: string[] = [];

  const finish = () => {
    const text = lines.join("\n").trim();
    if (current.level > 0 || text !== "") sections.push({ ...current, text });
  };

  scanLines(
    body,
    (line) => {
      const match = ATX.exec(line);
      if (!match) {
        lines.push(line);
        return;
      }
      finish();
      const level = match[1]?.length ?? 1;
      const heading = headingText(match[2] ?? "");
      while (parents.length > 0 && (parents.at(-1)?.level ?? 0) >= level) parents.pop();
      current = { level, heading, anchor: slugger.slug(heading), trail: parents.map((p) => p.heading), text: "" };
      parents.push({ level, heading });
      lines = [];
    },
    (line) => lines.push(line),
  );
  finish();
  return sections;
}

/** Links to files in the same repo, in document order. External links and images are skipped. */
export function extractLinks(fromPath: string, body: string): DocLink[] {
  const links: DocLink[] = [];
  const LINK = /(?<!!)\[[^\]]*\]\(\s*<?([^)\s>]*)>?(?:\s+"[^"]*")?\s*\)/g;
  scanLines(body, (line) => {
    const withoutCode = line.replace(/`[^`]*`/g, "");
    for (const match of withoutCode.matchAll(LINK)) {
      const link = resolveLink(fromPath, match[1] ?? "");
      if (link) links.push(link);
    }
  });
  return links;
}

/** Resolves a link target against the linking file. Returns null for external links. */
export function resolveLink(fromPath: string, href: string): DocLink | null {
  if (href === "" || /^[a-z][a-z0-9+.-]*:/i.test(href) || href.startsWith("//")) return null;
  const hashAt = href.indexOf("#");
  const rawPath = (hashAt === -1 ? href : href.slice(0, hashAt)).split("?")[0] ?? "";
  const rawAnchor = hashAt === -1 ? null : href.slice(hashAt + 1);
  const target =
    rawPath === ""
      ? fromPath
      : rawPath.startsWith("/")
        ? joinPath("", safeDecode(rawPath.slice(1)))
        : joinPath(dirname(fromPath), safeDecode(rawPath));
  return { target, anchor: rawAnchor === null || rawAnchor === "" ? null : safeDecode(rawAnchor) };
}

function dirname(path: string): string {
  const slash = path.lastIndexOf("/");
  return slash === -1 ? "" : path.slice(0, slash);
}

function joinPath(dir: string, relative: string): string {
  const parts = dir === "" ? [] : dir.split("/");
  for (const segment of relative.split("/")) {
    if (segment === "" || segment === ".") continue;
    if (segment === "..") parts.pop();
    else parts.push(segment);
  }
  return parts.join("/");
}

function safeDecode(text: string): string {
  try {
    return decodeURIComponent(text);
  } catch {
    return text;
  }
}
