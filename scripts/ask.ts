// Asks one question from the command line and prints the answer and its trace.
//
//   npm run ask -- --case explain-kv-quant
//   npm run ask -- --doc docs/llm/app/model_quantization.md --select "KV Cache量化" --action explain --read-up-to 52 --unclear FP8
//   npm run ask -- --doc docs/llm/app/mcp_protocol.md --action ask --question "MCP 和 Function Calling 有什么区别？"
//
// Options: --anchor <section> (default: the first section containing the selection),
//          --model gemini (default) | sonnet | haiku | <id>, --json

import { parseArgs } from "node:util";
import { runAction } from "../src/core/actions.ts";
import { renderAnswer } from "../src/core/answer.ts";
import type { Action, MemorySlice, Question } from "../src/core/types.ts";
import { loadCases, memoryOf, questionOf } from "../evals/cases.ts";
import { client as makeClient, model as resolveModel, repo as openIndexedRepo } from "./runtime.ts";

const { values: args } = parseArgs({
  options: {
    case: { type: "string" },
    doc: { type: "string" },
    select: { type: "string", default: "" },
    action: { type: "string", default: "explain" },
    anchor: { type: "string" },
    question: { type: "string" },
    "read-up-to": { type: "string" },
    known: { type: "string" },
    unclear: { type: "string" },
    model: { type: "string" },
    json: { type: "boolean", default: false },
  },
});

const repo = openIndexedRepo();
const list = (value: string | undefined) => (value ? value.split(",").map((s) => s.trim()).filter(Boolean) : []);

let action: Action;
let question: Question;
let memory: MemorySlice;
if (args.case) {
  const found = loadCases().find((c) => c.id === args.case);
  if (!found) throw new Error(`No eval case "${args.case}"`);
  action = found.action;
  question = questionOf(found);
  memory = memoryOf(found.memory, repo);
} else {
  if (!args.doc || !repo.doc(args.doc)) throw new Error(`--doc must be a doc in the index (got ${args.doc ?? "nothing"})`);
  if (!["explain", "example", "where-used", "ask"].includes(args.action)) throw new Error(`Unknown --action ${args.action}`);
  action = args.action as Action;
  const sections = repo.sectionsOf(args.doc);
  const anchor =
    args.anchor ?? sections.find((s) => `${s.heading}\n${s.text}`.includes(args.select))?.anchor ?? sections[0]?.anchor ?? null;
  question = { doc: args.doc, anchor, selection: args.select, text: args.question ?? null };
  memory = memoryOf(
    { readUpTo: Number(args["read-up-to"] ?? 0), known: list(args.known), unclear: list(args.unclear) },
    repo,
  );
}

const model = resolveModel(args.model);
const result = await runAction(action, question, memory, { client: makeClient(model), repo, model });
if (args.json) {
  console.log(JSON.stringify(result, null, 2));
} else {
  const { trace } = result;
  console.log(`\n${renderAnswer(result.answer, repo)}\n`);
  console.log(
    `— ${trace.action} on ${trace.model}: ${trace.calls} call(s), ${trace.toolCalls.length} tool call(s), ` +
      `${trace.usage.cacheRead} cached + ${trace.usage.input} uncached input tokens, ${trace.usage.output} output, ` +
      `$${trace.costUsd.toFixed(4)}, ${(trace.ms / 1000).toFixed(1)}s`,
  );
  for (const call of trace.toolCalls) console.log(`  ${call.isError ? "✗" : "·"} ${call.name} ${JSON.stringify(call.input)}`);
  if (trace.retried) console.log(`  retried after: ${trace.firstTryProblems.join(" | ")}`);
  if (trace.dropped.length > 0) console.log(`  dropped ${trace.dropped.length} unsupported point(s)`);
  if (trace.remainingProblems.length > 0) console.log(`  still: ${trace.remainingProblems.join(" | ")}`);
}
