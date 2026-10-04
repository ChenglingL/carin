import type { JsonSchema, MessageResponse } from "./model.ts";
import type { Repo } from "./repo.ts";
import type { Answer, AnswerPoint } from "./types.ts";

/** Sent as output_config.format, so the final reply is always this JSON. */
export const ANSWER_SCHEMA: JsonSchema = {
  type: "object",
  additionalProperties: false,
  required: ["points", "ahead", "followUps", "conceptsExplained"],
  properties: {
    points: {
      type: "array",
      description: "The answer, one claim or short paragraph per point, in reading order.",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["text", "source", "citations"],
        properties: {
          text: { type: "string" },
          source: {
            type: "string",
            enum: ["repo", "outside"],
            description: "repo: comes from the repo and cites it. outside: background the repo assumes; cites nothing.",
          },
          citations: {
            type: "array",
            items: {
              type: "object",
              additionalProperties: false,
              required: ["doc", "anchor"],
              properties: {
                doc: { type: "string", description: "Repo-relative path of the doc" },
                anchor: { type: "string", description: "Anchor of the section, without #" },
              },
            },
          },
        },
      },
    },
    ahead: {
      type: "array",
      description: "Docs later in the reader's path that cover this further. Point to them; don't explain them.",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["doc"],
        properties: { doc: { type: "string" } },
      },
    },
    followUps: { type: "array", description: "Up to 3 follow-up questions this repo can answer.", items: { type: "string" } },
    conceptsExplained: {
      type: "array",
      description: "Concepts this answer explained, spelled as the repo spells them.",
      items: { type: "string" },
    },
  },
};

export class AnswerFormatError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AnswerFormatError";
  }
}

/** The answer JSON from a response's last text block. */
export function parseAnswer(response: MessageResponse): Answer {
  const text = response.content.findLast((block) => block.type === "text");
  if (!text || text.type !== "text") throw new AnswerFormatError(`no text in the reply (stop_reason: ${response.stop_reason})`);
  let data: unknown;
  try {
    data = JSON.parse(text.text);
  } catch {
    throw new AnswerFormatError(`the reply isn't valid JSON (stop_reason: ${response.stop_reason})`);
  }
  const value = data as Partial<Answer>;
  if (!Array.isArray(value.points) || !Array.isArray(value.ahead) || !Array.isArray(value.followUps)) {
    throw new AnswerFormatError("the reply JSON is missing points, ahead or followUps");
  }
  return {
    points: value.points,
    ahead: value.ahead,
    followUps: value.followUps,
    conceptsExplained: Array.isArray(value.conceptsExplained) ? value.conceptsExplained : [],
  };
}

const segmenter = new Intl.Segmenter("zh", { granularity: "word" });

/** Words in mixed Chinese and English text (Chinese has no spaces, so split with Intl.Segmenter). */
export function countWords(text: string): number {
  let count = 0;
  for (const segment of segmenter.segment(text)) if (segment.isWordLike) count++;
  return count;
}

export interface Problem {
  kind: "format" | "citation" | "ahead" | "followups" | "length";
  point: number | null; // index into points (citation) or ahead (ahead)
  message: string;
}

/** Everything wrong with an answer, checked against the index (docs/PLAN.md § "Checks before showing an answer"). */
export function checkAnswer(answer: Answer, repo: Repo, wordLimit: number): Problem[] {
  const problems: Problem[] = [];
  answer.points.forEach((point, i) => {
    if (point.source === "repo" && point.citations.length === 0) {
      problems.push({ kind: "citation", point: i, message: `points[${i}] is marked "repo" but cites nothing.` });
    }
    if (point.source === "outside" && point.citations.length > 0) {
      problems.push({ kind: "citation", point: i, message: `points[${i}] is marked "outside" but cites the repo; mark it "repo".` });
    }
    for (const { doc, anchor } of point.citations) {
      if (!repo.doc(doc)) {
        problems.push({ kind: "citation", point: i, message: `points[${i}] cites ${doc}, which isn't a doc in this repo.` });
      } else if (!repo.section(doc, anchor)) {
        const anchors = repo.sectionsOf(doc).map((s) => s.anchor);
        problems.push({
          kind: "citation",
          point: i,
          message: `points[${i}] cites ${doc}#${anchor}, which isn't a section. Its sections: ${anchors.slice(0, 30).join(", ")}`,
        });
      }
    }
  });
  answer.ahead.forEach(({ doc }, i) => {
    if (!repo.doc(doc)) problems.push({ kind: "ahead", point: i, message: `ahead[${i}] names ${doc}, which isn't a doc in this repo.` });
  });
  if (answer.followUps.length > 3) {
    problems.push({ kind: "followups", point: null, message: `There are ${answer.followUps.length} follow-ups; give at most 3.` });
  }
  const words = countWords(answer.points.map((p) => p.text).join("\n"));
  if (words > wordLimit) {
    problems.push({ kind: "length", point: null, message: `The answer is ${words} words; the limit is ${wordLimit}. Cut it down.` });
  }
  return problems;
}

/** The message that asks for a corrected answer, once. */
export function retryMessage(problems: Problem[]): string {
  return [
    "Your answer has problems:",
    ...problems.map((p) => `- ${p.message}`),
    "Reply again with the whole answer in the same JSON format. Cite only sections that exist; drop any claim you can't support.",
  ].join("\n");
}

/** Removes what still fails after the retry: unsupported points, unknown ahead docs, extra follow-ups. */
export function dropFailures(answer: Answer, problems: Problem[]): { answer: Answer; dropped: AnswerPoint[] } {
  const badPoints = new Set(problems.filter((p) => p.kind === "citation").map((p) => p.point));
  const badAhead = new Set(problems.filter((p) => p.kind === "ahead").map((p) => p.point));
  return {
    answer: {
      points: answer.points.filter((_, i) => !badPoints.has(i)),
      ahead: answer.ahead.filter((_, i) => !badAhead.has(i)),
      followUps: answer.followUps.slice(0, 3),
      conceptsExplained: answer.conceptsExplained,
    },
    dropped: answer.points.filter((_, i) => badPoints.has(i)),
  };
}

/** Markdown for a terminal or the side panel, with citations linked to github.com. */
export function renderAnswer(answer: Answer, repo: Repo): string {
  const parts: string[] = [];
  for (const point of answer.points) {
    const links = point.citations.map(({ doc, anchor }) => {
      const heading = repo.section(doc, anchor)?.heading || anchor;
      return `[${doc.split("/").at(-1)} › ${heading}](${repo.url(doc, anchor)})`;
    });
    const prefix = point.source === "outside" ? "_Outside the repo:_ " : "";
    parts.push(`${prefix}${point.text}${links.length > 0 ? ` (${links.join("; ")})` : ""}`);
  }
  if (answer.points.length === 0) parts.push("_No answer the repo supports._");
  if (answer.ahead.length > 0) {
    const later = answer.ahead.map(({ doc }) => `${doc.split("/").at(-1)} (#${repo.position(doc) ?? "?"})`);
    parts.push(`**Later in your path:** ${later.join(", ")}`);
  }
  if (answer.followUps.length > 0) parts.push(answer.followUps.map((q) => `- ${q}`).join("\n"));
  return parts.join("\n\n");
}
