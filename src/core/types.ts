import type { StopReason } from "./model.ts";

export type Action = "explain" | "example" | "where-used" | "ask";

/** What the reader is looking at and asking about. */
export interface Question {
  doc: string; // the doc open on github.com
  anchor: string | null; // the section the selection is in, when known
  selection: string; // the selected text; "" for a typed question with nothing selected
  text: string | null; // the typed question (Ask)
}

export type ConceptStatus = "seen" | "explained" | "got-it" | "unclear";

/**
 * The small part of memory one question uses (docs/PLAN.md § Memory, "What one question uses").
 * In M1 eval cases supply it; in M3 it's picked from storage.
 */
export interface MemorySlice {
  profile: {
    language: string; // "match" = answer in the question's language
    length: "short" | "normal";
    background: string;
    skip: string[];
  };
  readDocs: string[]; // docs marked done
  concepts: { term: string; status: ConceptStatus }[];
  threads: { question: string; answer: string }[]; // the last few on this doc
}

export interface Citation {
  doc: string;
  anchor: string;
}

/** One claim in an answer. Repo claims carry their own citations, so an unsupported one can be dropped alone. */
export interface AnswerPoint {
  text: string;
  source: "repo" | "outside";
  citations: Citation[];
}

/** The JSON every action returns (schema in answer.ts). */
export interface Answer {
  points: AnswerPoint[];
  ahead: { doc: string }[]; // later docs on the reader's path worth pointing to
  followUps: string[]; // up to 3 questions the repo can answer
  conceptsExplained: string[];
}

export interface ToolCall {
  name: string;
  input: unknown;
  isError: boolean;
}

export interface Trace {
  action: Action;
  model: string;
  calls: number; // model calls, retries included
  toolCalls: ToolCall[];
  usage: { input: number; output: number; cacheRead: number; cacheWrite: number };
  costUsd: number;
  firstTryProblems: string[]; // what the checks found before the retry
  retried: boolean;
  dropped: AnswerPoint[]; // points removed because they still failed after the retry
  remainingProblems: string[]; // problems left in the shown answer (e.g. over the length limit)
  stopReason: StopReason | null;
  ms: number;
}

export interface AnswerResult {
  answer: Answer;
  trace: Trace;
}
