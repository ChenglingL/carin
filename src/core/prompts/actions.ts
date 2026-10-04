// What each action asks for. Versioned like code: bump ACTIONS_VERSION on any change and run the evals.
import type { Effort } from "../model.ts";
import type { Action } from "../types.ts";

export const ACTIONS_VERSION = 2; // 2: Where it's used includes unread docs, named not explained

export interface ActionSpec {
  kind: "one-call" | "agent"; // one-call: a single request, no tools. agent: the tool loop.
  effort: Effort; // low suits chat-like answers; medium suits multistep tool use
  wordLimit: number;
  maxSteps: number; // model calls the tool loop may make
  instruction: string; // goes in the user message, after the cached prefix
}

export const ACTIONS: Record<Action, ActionSpec> = {
  explain: {
    kind: "one-call",
    effort: "low",
    wordLimit: 150,
    maxSteps: 1,
    instruction:
      "Explain here: explain the selected text as this repo uses it, in the place the reader is reading. " +
      "Stay within 150 words.",
  },
  example: {
    kind: "one-call",
    effort: "low",
    wordLimit: 150,
    maxSteps: 1,
    instruction:
      "Example: give one small, concrete example of the selected idea. Prefer an example the current doc already uses " +
      "and cite it; make one up only if the doc has none, and keep it to a few lines. Stay within 150 words.",
  },
  "where-used": {
    kind: "agent",
    effort: "medium",
    wordLimit: 200,
    maxSteps: 5,
    instruction:
      "Where it's used: find where else this repo covers the selected concept. Search before answering, with the " +
      "repo's own spellings (Chinese and English), and page through results if needed. Give one point per doc, " +
      "saying in one line what that doc adds, and cite the section. Include docs the reader hasn't read yet: for those, " +
      "name what they cover and their place in the path, without explaining it. Leave out the doc the reader is on. " +
      "Stay within 200 words.",
  },
  ask: {
    kind: "agent",
    effort: "medium",
    wordLimit: 200,
    maxSteps: 5,
    instruction:
      "Ask: answer the reader's question from this repo. Search unless the current doc already answers it, and read a " +
      "section when a snippet isn't enough. Stay within 200 words.",
  },
};
