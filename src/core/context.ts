import { ANSWER_SCHEMA } from "./answer.ts";
import type { MessageRequest } from "./model.ts";
import { ACTIONS } from "./prompts/actions.ts";
import { answerRules } from "./prompts/answer-rules.ts";
import type { Repo } from "./repo.ts";
import { capTokens, TOOL_DEFINITIONS } from "./tools.ts";
import type { Action, MemorySlice, Question } from "./types.ts";

export interface BuildInput {
  action: Action;
  question: Question;
  memory: MemorySlice;
  repo: Repo;
  model: string;
}

const MAX_TOKENS = 16000; // thinking counts toward it
const SECTION_TOKEN_CAP = 3000; // same cap as read_section
const ANCHOR_LIST_CAP = 60;

/**
 * The request for one action: what the model sees, in what order, and what gets cached.
 *
 * system   answer rules, then the doc map: identical for every question on this repo, so it caches
 * message  this question: where the reader is, the current section, what they know, what they
 *          selected, and last the action's instruction, closest to where the model starts writing
 */
export function buildRequest(input: BuildInput): MessageRequest {
  const { action, question, memory, repo, model } = input;
  const spec = ACTIONS[action];

  const parts = [
    readerPart(question, repo),
    sectionPart(question, repo),
    memoryPart(memory, repo),
    selectionPart(question),
    `## Task\n${spec.instruction}`,
  ].filter((part) => part !== "");

  return {
    model,
    max_tokens: MAX_TOKENS,
    system: [
      { type: "text", text: answerRules({ repo: repo.name }) },
      {
        type: "text",
        text: `## Doc map\nEvery doc in this repo, in reading-path order (path | title | keywords):\n${repo.docMap}`,
        cache_control: { type: "ephemeral" },
      },
    ],
    messages: [{ role: "user", content: parts.join("\n\n") }],
    ...(spec.kind === "agent" ? { tools: TOOL_DEFINITIONS } : {}),
    output_config: { effort: spec.effort, format: { type: "json_schema", schema: ANSWER_SCHEMA } },
  };
}

function readerPart(question: Question, repo: Repo): string {
  const doc = repo.doc(question.doc);
  const position = repo.position(question.doc);
  const total = repo.index.readingPath.length;
  return [
    "## Where the reader is",
    `Doc: ${question.doc}${doc ? ` (${doc.title})` : ""}`,
    `Reading path: ${position === null ? "not on the path" : `#${position} of ${total}`}`,
  ].join("\n");
}

/** The current section with its anchor, plus the doc's other anchors: the only anchors a one-call action can cite. */
function sectionPart(question: Question, repo: Repo): string {
  const sections = repo.sectionsOf(question.doc);
  const current = question.anchor === null ? undefined : repo.section(question.doc, question.anchor);
  const lines: string[] = [];
  if (current) {
    const trail = [...current.trail, current.heading].filter((h) => h !== "").join(" › ");
    lines.push(
      "## Current section",
      `${question.doc}#${current.anchor}`,
      trail,
      "",
      capTokens(current.text || "(No text of its own.)", SECTION_TOKEN_CAP),
    );
  }
  const others = sections.filter((s) => s.anchor !== current?.anchor).map((s) => s.anchor);
  if (others.length > 0) {
    const shown = others.slice(0, ANCHOR_LIST_CAP);
    lines.push(
      "",
      `## Other sections in ${question.doc} (anchors)`,
      `${shown.join(", ")}${others.length > shown.length ? `, … (${others.length - shown.length} more)` : ""}`,
    );
  }
  return lines.join("\n").trim();
}

/** What the reader knows. Docs read in path order collapse to a range, so 52 read docs cost one line. */
function memoryPart(memory: MemorySlice, repo: Repo): string {
  const lines = ["## The reader", `Language: ${memory.profile.language}`];
  if (memory.profile.background) lines.push(`Background: ${memory.profile.background}`);
  if (memory.profile.skip.length > 0) lines.push(`Skip: ${memory.profile.skip.join(", ")}`);

  const read = new Set(memory.readDocs);
  let prefix = 0;
  for (const record of repo.index.readingPath) {
    if (!read.has(record.path)) break;
    prefix = record.position;
  }
  const inPrefix = new Set(repo.index.readingPath.slice(0, prefix).map((r) => r.path));
  const others = memory.readDocs.filter((doc) => !inPrefix.has(doc));
  const lastInPrefix = repo.index.readingPath[prefix - 1]?.path;
  if (prefix > 0 && lastInPrefix) lines.push(`Has read: path #1–#${prefix} (up to ${lastInPrefix})`);
  if (others.length > 0) lines.push(`${prefix > 0 ? "Also read" : "Has read"}: ${others.join(", ")}`);
  if (read.size === 0) lines.push("Has read: nothing yet");

  const known = memory.concepts.filter((c) => c.status === "got-it").map((c) => c.term);
  const unclear = memory.concepts.filter((c) => c.status === "unclear").map((c) => c.term);
  if (known.length > 0) lines.push(`Marked known: ${known.join(", ")}`);
  if (unclear.length > 0) lines.push(`Marked unclear: ${unclear.join(", ")}`);

  for (const thread of memory.threads.slice(-3)) lines.push(`Asked earlier on this doc: ${thread.question}`);
  return lines.join("\n");
}

function selectionPart(question: Question): string {
  const lines: string[] = [];
  if (question.selection) lines.push("## Selected text", question.selection);
  if (question.text) lines.push(lines.length > 0 ? "" : "", "## Question", question.text);
  return lines.join("\n").trim();
}
