import { AnswerFormatError, checkAnswer, dropFailures, parseAnswer, retryMessage, type Problem } from "./answer.ts";
import { buildRequest as defaultBuildRequest, type BuildInput } from "./context.ts";
import { runToolLoop as defaultRunToolLoop } from "./loop.ts";
import { costUsd, type MessageParam, type MessageRequest, type MessageResponse, type ModelClient } from "./model.ts";
import { ACTIONS } from "./prompts/actions.ts";
import type { Repo } from "./repo.ts";
import { toolRunner } from "./tools.ts";
import type { Action, Answer, AnswerResult, MemorySlice, Question, ToolCall } from "./types.ts";

export interface ActionDeps {
  client: ModelClient;
  repo: Repo;
  model: string;
  // Swappable for tests; the real ones are the context builder and the tool loop.
  buildRequest?: (input: BuildInput) => MessageRequest;
  runToolLoop?: typeof defaultRunToolLoop;
  now?: () => number;
}

export class RefusalError extends Error {
  constructor() {
    super("The model declined to answer (stop_reason: refusal).");
    this.name = "RefusalError";
  }
}

/**
 * Runs one action end to end: build the request, make one call or run the tool loop,
 * then check the answer against the index. On problems, ask once for a fix (appending
 * to the conversation, never editing it); whatever still fails after that is dropped.
 */
export async function runAction(
  action: Action,
  question: Question,
  memory: MemorySlice,
  deps: ActionDeps,
): Promise<AnswerResult> {
  const now = deps.now ?? (() => Date.now());
  const started = now();
  const spec = ACTIONS[action];
  const request = (deps.buildRequest ?? defaultBuildRequest)({ action, question, memory, repo: deps.repo, model: deps.model });

  const responses: MessageResponse[] = [];
  const toolCalls: ToolCall[] = [];
  let messages: MessageParam[];
  let response: MessageResponse;

  if (spec.kind === "agent") {
    const runLoop = deps.runToolLoop ?? defaultRunToolLoop;
    const loop = await runLoop(deps.client, request, toolRunner(deps.repo, memory), { maxSteps: spec.maxSteps });
    responses.push(...loop.responses);
    toolCalls.push(...loop.toolCalls);
    messages = loop.messages;
    response = loop.response;
  } else {
    response = await deps.client.createMessage(request);
    responses.push(response);
    messages = [...request.messages, { role: "assistant", content: response.content }];
  }

  const first = evaluate(response, deps.repo, spec.wordLimit);
  let final = first;
  let retried = false;
  if (first.problems.length > 0) {
    retried = true;
    const retry: MessageRequest = {
      ...request,
      ...(request.tools ? { tool_choice: { type: "none" as const } } : {}), // fix the answer; no more searching
      messages: [...messages, { role: "user", content: retryMessage(first.problems) }],
    };
    const second = await deps.client.createMessage(retry);
    responses.push(second);
    response = second;
    const evaluated = evaluate(second, deps.repo, spec.wordLimit);
    final = evaluated.answer ? evaluated : first; // a garbled retry doesn't replace a usable first answer
  }
  if (!final.answer) throw new AnswerFormatError(final.problems.map((p) => p.message).join(" "));

  const { answer, dropped } = dropFailures(final.answer, final.problems);
  const usage = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 };
  let cost = 0;
  for (const r of responses) {
    usage.input += r.usage.input_tokens;
    usage.output += r.usage.output_tokens;
    usage.cacheRead += r.usage.cache_read_input_tokens ?? 0;
    usage.cacheWrite += r.usage.cache_creation_input_tokens ?? 0;
    cost += costUsd(deps.model, r.usage);
  }

  return {
    answer,
    trace: {
      action,
      model: deps.model,
      calls: responses.length,
      toolCalls,
      usage,
      costUsd: cost,
      firstTryProblems: first.problems.map((p) => p.message),
      retried,
      dropped,
      remainingProblems: checkAnswer(answer, deps.repo, spec.wordLimit).map((p) => p.message),
      stopReason: response.stop_reason,
      ms: now() - started,
    },
  };
}

function evaluate(response: MessageResponse, repo: Repo, wordLimit: number): { answer: Answer | null; problems: Problem[] } {
  if (response.stop_reason === "refusal") throw new RefusalError();
  try {
    const answer = parseAnswer(response);
    return { answer, problems: checkAnswer(answer, repo, wordLimit) };
  } catch (error) {
    if (!(error instanceof AnswerFormatError)) throw error;
    return { answer: null, problems: [{ kind: "format", point: null, message: `${error.message}.` }] };
  }
}
