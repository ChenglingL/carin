// Runs the eval cases against the real model and prints a report (docs/PLAN.md § Evals).
//
//   npm run evals                      every case, on Gemini 3.7 Flash (free tier)
//   npm run evals -- --case wu-rerank  one case (repeat --case for more)
//   npm run evals -- --model sonnet    on Claude Sonnet 5.5 (needs ANTHROPIC_API_KEY)
//   npm run evals -- --save-baseline   also save the scores as evals/baseline.json
//
// On Gemini's free tier a run costs nothing but counts against its rate limits; on Sonnet 5.5
// it's roughly $1–2. Full answers and traces are saved under data/evals/.

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { parseArgs } from "node:util";
import { runAction } from "../src/core/actions.ts";
import { checkAnswer, countWords, renderAnswer } from "../src/core/answer.ts";
import { ACTIONS } from "../src/core/prompts/actions.ts";
import type { AnswerResult } from "../src/core/types.ts";
import { client as makeClient, model as resolveModel, repo as openIndexedRepo } from "../scripts/runtime.ts";
import { loadCases, memoryOf, questionOf, type EvalCase } from "./cases.ts";

const BASELINE_PATH = "evals/baseline.json";
const RECALL_GATE = 0.8;

interface CaseScore {
  id: string;
  action: string;
  error: string | null;
  citationsValid: boolean; // every citation in the shown answer is a real section
  firstTryClean: boolean; // no problems before the retry
  recall: number | null; // share of expected docs cited; null without an expected list
  missed: string[];
  words: number;
  wordLimit: number;
  tangents: string[];
  calls: number;
  toolCalls: number;
  cacheRead: number;
  inputTokens: number;
  outputTokens: number;
  costUsd: number;
  ms: number;
}

const { values: args } = parseArgs({
  options: {
    case: { type: "string", multiple: true },
    model: { type: "string" },
    "save-baseline": { type: "boolean", default: false },
  },
});

const repo = openIndexedRepo();
const model = resolveModel(args.model);
const client = makeClient(model);
const allCases = loadCases();
const cases = args.case ? allCases.filter((c) => args.case?.includes(c.id)) : allCases;
if (cases.length === 0) {
  console.error(`No cases match ${args.case?.join(", ")}. Ids: ${allCases.map((c) => c.id).join(", ")}`);
  process.exit(1);
}

console.log(`Running ${cases.length} case(s) on ${model} …\n`);
const scores: CaseScore[] = [];
const outputs: Record<string, { answer: string; result: AnswerResult } | { error: string }> = {};
for (const c of cases) {
  try {
    const result = await runAction(c.action, questionOf(c), memoryOf(c.memory, repo), { client, repo, model });
    scores.push(score(c, result));
    outputs[c.id] = { answer: renderAnswer(result.answer, repo), result };
  } catch (error) {
    const message = (error as Error).message;
    scores.push({ ...emptyScore(c), error: message });
    outputs[c.id] = { error: message };
  }
  printRow(scores.at(-1));
}

printSummary(scores);
const stamp = new Date().toISOString().replace(/[:.]/g, "-");
mkdirSync("data/evals", { recursive: true });
writeFileSync(`data/evals/${stamp}.json`, JSON.stringify({ model, scores, outputs }, null, 2));
console.log(`\nFull answers and traces: data/evals/${stamp}.json`);
compareWithBaseline(scores);
if (args["save-baseline"]) {
  writeFileSync(BASELINE_PATH, `${JSON.stringify({ model, savedAt: new Date().toISOString(), scores }, null, 2)}\n`);
  console.log(`Saved ${BASELINE_PATH}`);
}

function score(c: EvalCase, result: AnswerResult): CaseScore {
  const { answer, trace } = result;
  const wordLimit = ACTIONS[c.action].wordLimit;
  const cited = new Set(answer.points.flatMap((p) => p.citations.map((citation) => citation.doc)));
  const rendered = renderAnswer(answer, repo).toLowerCase();
  return {
    id: c.id,
    action: c.action,
    error: null,
    citationsValid: !checkAnswer(answer, repo, wordLimit).some((p) => p.kind === "citation"),
    firstTryClean: trace.firstTryProblems.length === 0,
    recall: c.expected.length > 0 ? c.expected.filter((doc) => cited.has(doc)).length / c.expected.length : null,
    missed: c.expected.filter((doc) => !cited.has(doc)),
    words: countWords(answer.points.map((p) => p.text).join("\n")),
    wordLimit,
    tangents: c.mustNotMention.filter((phrase) => rendered.includes(phrase.toLowerCase())),
    calls: trace.calls,
    toolCalls: trace.toolCalls.length,
    cacheRead: trace.usage.cacheRead,
    inputTokens: trace.usage.input + trace.usage.cacheRead + trace.usage.cacheWrite,
    outputTokens: trace.usage.output,
    costUsd: trace.costUsd,
    ms: trace.ms,
  };
}

function emptyScore(c: EvalCase): CaseScore {
  return {
    id: c.id, action: c.action, error: null, citationsValid: false, firstTryClean: false, recall: null, missed: [],
    words: 0, wordLimit: ACTIONS[c.action].wordLimit, tangents: [], calls: 0, toolCalls: 0, cacheRead: 0,
    inputTokens: 0, outputTokens: 0, costUsd: 0, ms: 0,
  };
}

function printRow(s: CaseScore | undefined): void {
  if (!s) return;
  if (s.error) {
    console.log(`✗ ${s.id.padEnd(28)} error: ${s.error}`);
    return;
  }
  const recall = s.recall === null ? "  —  " : `${Math.round(s.recall * 100)}%`.padStart(5);
  const cache = s.inputTokens > 0 ? `${Math.round((s.cacheRead / s.inputTokens) * 100)}%` : "—";
  console.log(
    `${s.citationsValid ? "✓" : "✗"} ${s.id.padEnd(28)} recall ${recall}  words ${String(s.words).padStart(3)}/${s.wordLimit}` +
      `  calls ${s.calls} tools ${s.toolCalls}  cached ${cache.padStart(4)}  $${s.costUsd.toFixed(3)}  ${(s.ms / 1000).toFixed(1)}s` +
      `${s.firstTryClean ? "" : "  (retried)"}${s.tangents.length ? `  tangents: ${s.tangents.join(", ")}` : ""}` +
      `${s.missed.length ? `\n    missed: ${s.missed.join(", ")}` : ""}`,
  );
}

function printSummary(all: CaseScore[]): void {
  const ok = all.filter((s) => !s.error);
  const whereUsed = all.filter((s) => s.action === "where-used");
  const unscored = whereUsed.filter((s) => s.recall === null && !s.error);
  const citationsPass = all.length > 0 && ok.length === all.length && ok.every((s) => s.citationsValid);
  const recallPass = whereUsed.length > 0 && whereUsed.every((s) => s.recall !== null && s.recall >= RECALL_GATE);
  const cost = all.reduce((sum, s) => sum + s.costUsd, 0);

  console.log(`
Citations real in every shown answer: ${citationsPass ? "yes" : "no"} (${ok.filter((s) => s.citationsValid).length}/${all.length})
First try clean (no retry needed):    ${ok.filter((s) => s.firstTryClean).length}/${ok.length}
Where it's used recall ≥ ${RECALL_GATE * 100}%:         ${recallPass ? "yes" : "no"}${unscored.length ? ` (${unscored.length} case(s) have no expected docs yet)` : ""}
Over the word limit:                  ${ok.filter((s) => s.words > s.wordLimit).length}
Total cost:                           $${cost.toFixed(2)}

M1 gate: ${citationsPass && recallPass ? "PASS" : "not yet"}`);
}

function compareWithBaseline(all: CaseScore[]): void {
  if (!existsSync(BASELINE_PATH)) return;
  const baseline = JSON.parse(readFileSync(BASELINE_PATH, "utf8")) as { scores: CaseScore[] };
  const before = new Map(baseline.scores.map((s) => [s.id, s]));
  const regressions: string[] = [];
  for (const s of all) {
    const b = before.get(s.id);
    if (!b) continue;
    if (b.citationsValid && !s.citationsValid) regressions.push(`${s.id}: citations were real, now aren't`);
    if (b.recall !== null && s.recall !== null && s.recall < b.recall) {
      regressions.push(`${s.id}: recall ${Math.round(b.recall * 100)}% → ${Math.round(s.recall * 100)}%`);
    }
    if (!b.error && s.error) regressions.push(`${s.id}: now fails (${s.error})`);
  }
  console.log(regressions.length ? `\nRegressions against the baseline:\n  ${regressions.join("\n  ")}` : "\nNo regressions against the baseline.");
}
