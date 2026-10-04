// Loads the eval cases and turns each into the Question and MemorySlice the agent core takes.

import { readFileSync } from "node:fs";
import { parse } from "yaml";
import type { Repo } from "../src/core/repo.ts";
import type { Action, MemorySlice, Question } from "../src/core/types.ts";

export const CASES_PATH = "evals/fixtures/llm-master/cases.yaml";
const ACTIONS: Action[] = ["explain", "example", "where-used", "ask"];

/** A sketch of what the reader has done, e.g. "finished docs 1–46, marked FP8 unclear". */
export interface MemorySketch {
  readUpTo?: number;
  read?: string[];
  known?: string[];
  unclear?: string[];
  language?: string;
}

export interface EvalCase {
  id: string;
  action: Action;
  doc: string;
  anchor: string;
  selection: string;
  question?: string;
  concept?: string;
  memory: MemorySketch;
  notes?: string;
  proposed: string[];
  expected: string[];
  mustNotMention: string[];
}

export function loadCases(path = CASES_PATH): EvalCase[] {
  const data = parse(readFileSync(path, "utf8")) as unknown;
  if (!Array.isArray(data)) throw new Error(`${path}: expected a list of cases`);
  return data.map((raw, i) => {
    const c = raw as Partial<EvalCase>;
    const where = `${path} case ${c.id ?? `#${i + 1}`}`;
    if (typeof c.id !== "string" || !c.id) throw new Error(`${where}: missing id`);
    if (!c.action || !ACTIONS.includes(c.action)) throw new Error(`${where}: action must be one of ${ACTIONS.join(", ")}`);
    if (typeof c.doc !== "string" || typeof c.anchor !== "string") throw new Error(`${where}: missing doc or anchor`);
    if (typeof c.selection !== "string") throw new Error(`${where}: missing selection (use "" for none)`);
    if (c.action === "ask" && !c.question) throw new Error(`${where}: an ask case needs a question`);
    return {
      id: c.id,
      action: c.action,
      doc: c.doc,
      anchor: c.anchor,
      selection: c.selection,
      question: c.question,
      concept: c.concept,
      memory: c.memory ?? {},
      notes: c.notes,
      proposed: c.proposed ?? [],
      expected: c.expected ?? [],
      mustNotMention: c.mustNotMention ?? [],
    };
  });
}

export function questionOf(c: EvalCase): Question {
  return { doc: c.doc, anchor: c.anchor, selection: c.selection, text: c.question ?? null };
}

/** Expands a memory sketch into the slice the agent core takes. */
export function memoryOf(sketch: MemorySketch, repo: Repo): MemorySlice {
  const upTo = sketch.readUpTo ?? 0;
  const readDocs = repo.index.readingPath.filter((r) => r.position <= upTo).map((r) => r.path);
  return {
    profile: { language: sketch.language ?? "match", length: "short", background: "", skip: [] },
    readDocs: [...new Set([...readDocs, ...(sketch.read ?? [])])],
    concepts: [
      ...(sketch.known ?? []).map((term) => ({ term, status: "got-it" as const })),
      ...(sketch.unclear ?? []).map((term) => ({ term, status: "unclear" as const })),
    ],
    threads: [],
  };
}
