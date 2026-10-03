import { classifyDoc } from "./classify.ts";
import { buildConcepts } from "./concepts.ts";
import { splitFrontmatter } from "./frontmatter.ts";
import { cleanBody, extractLinks, splitSections, type DocLink, type ParsedSection } from "./markdown.ts";
import { buildReadingPath, findStartPage } from "./reading-path.ts";
import type { RepoSnapshot } from "./source.ts";
import type { DocKind, DocRecord, RepoIndex, SectionRecord } from "./types.ts";

export interface BuildOptions {
  start?: string; // reading-path start page; found automatically when omitted
  builtAt?: string; // ISO timestamp; pass one for reproducible output
}

export interface BuildResult {
  index: RepoIndex;
  warnings: string[];
}

interface ParsedFile {
  path: string;
  text: string;
  record: DocRecord;
  sections: ParsedSection[];
  links: DocLink[];
}

/** Turns a repo snapshot into the index. Pure: no I/O, same input → same output. */
export function buildIndex(snapshot: RepoSnapshot, options: BuildOptions = {}): BuildResult {
  const warnings: string[] = [];
  const paths = new Set(snapshot.files.map((file) => file.path));

  const files: ParsedFile[] = snapshot.files.map((file) => {
    const { frontmatter, body: rawBody, warning } = splitFrontmatter(file.text);
    if (warning) warnings.push(`${file.path}: ${warning}`);
    const body = cleanBody(rawBody);
    const sections = splitSections(body);
    const links = extractLinks(file.path, body).map((link) => ({ ...link, target: toKnownPath(link.target, paths) }));
    const linkedDocs = new Set(links.filter((l) => paths.has(l.target) && l.target !== file.path).map((l) => l.target));
    const h1 = sections.find((s) => s.level === 1)?.heading;
    const record: DocRecord = {
      path: file.path,
      kind: classifyDoc(body, linkedDocs.size),
      title: frontmatter?.title ?? h1 ?? fileName(file.path),
      keywords: frontmatter?.keywords ?? [],
      tags: frontmatter?.tags ?? [],
      description: frontmatter?.description ?? null,
      chars: file.text.length,
    };
    return { path: file.path, text: file.text, record, sections, links };
  });

  const start = options.start ?? findStartPage([...paths]);
  if (!start || !paths.has(start)) throw new Error(`Reading-path start page not found: ${start ?? "(none)"}`);

  const kinds = new Map<string, DocKind>(files.map((f) => [f.path, f.record.kind]));
  const linkTargets = new Map(files.map((f) => [f.path, f.links.map((l) => l.target).filter((t) => paths.has(t))]));
  const readingPath = buildReadingPath(start, kinds, linkTargets);

  const contentFiles = files.filter((f) => f.record.kind === "doc");
  const concepts = buildConcepts(
    files.flatMap((f) => f.record.keywords),
    contentFiles.map((f) => ({
      path: f.path,
      titles: [f.record.title, f.sections.find((s) => s.level === 1)?.heading ?? ""].filter((t) => t !== ""),
      text: f.text,
      sections: f.sections,
    })),
  );

  const sections: SectionRecord[] = files.flatMap((f) =>
    f.sections.map((s, order) => ({
      id: `${f.path}#${s.anchor}`,
      doc: f.path,
      anchor: s.anchor,
      heading: s.heading,
      level: s.level,
      trail: s.trail,
      order,
      text: s.text,
    })),
  );

  return {
    index: {
      meta: {
        schemaVersion: 1,
        repo: snapshot.repo,
        ref: snapshot.ref,
        commit: snapshot.commit,
        builtAt: options.builtAt ?? new Date().toISOString(),
        start,
      },
      docs: files.map((f) => f.record),
      sections,
      concepts,
      readingPath,
    },
    warnings,
  };
}

/** A link to a folder means its README, as on GitHub. */
function toKnownPath(target: string, paths: ReadonlySet<string>): string {
  if (paths.has(target)) return target;
  const readme = target === "" ? "README.md" : `${target.replace(/\/$/, "")}/README.md`;
  return paths.has(readme) ? readme : target;
}

function fileName(path: string): string {
  return (path.split("/").at(-1) ?? path).replace(/\.md$/i, "");
}
