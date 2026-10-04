import type { ContentBlock, MessageParam, MessageRequest, MessageResponse, ModelClient, ToolResultBlock } from "./model.ts";
import type { ToolRunner } from "./tools.ts";
import type { ToolCall } from "./types.ts";

export interface LoopOptions {
  maxSteps: number; // model calls allowed, the final answer included
}

export interface LoopResult {
  response: MessageResponse; // the final reply, which carries the answer
  messages: MessageParam[]; // the whole conversation, ending with the final assistant turn
  responses: MessageResponse[]; // every reply, for usage and cost
  toolCalls: ToolCall[];
}

/**
 * The agent: call the model, run the tools it asks for, repeat until it answers.
 *
 * Three rules keep it safe with thinking models (Claude's thinking blocks, Gemini's thought signatures):
 * - Append only. Assistant content goes back exactly as received and earlier turns are never edited;
 *   the API checks this when it receives thinking blocks back.
 * - Every tool_use gets a tool_result, all in one user message, errors included (is_error), so the
 *   model can correct itself instead of the loop crashing.
 * - The last step turns tools off (tool_choice "none"), so the loop always ends with an answer.
 *   Forced tool use isn't available on current models, so this is the lever that remains.
 */
export async function runToolLoop(
  client: ModelClient,
  request: MessageRequest,
  runTool: ToolRunner,
  options: LoopOptions,
): Promise<LoopResult> {
  const messages: MessageParam[] = [...request.messages];
  const responses: MessageResponse[] = [];
  const toolCalls: ToolCall[] = [];

  for (let step = 1; ; step++) {
    const lastStep = step >= options.maxSteps;
    const response = await client.createMessage({
      ...request,
      messages: [...messages],
      cache_control: request.cache_control ?? { type: "ephemeral" }, // reuse the growing history between steps
      ...(lastStep && request.tools ? { tool_choice: { type: "none" as const } } : {}),
    });
    responses.push(response);
    messages.push({ role: "assistant", content: response.content });

    const uses = response.content.filter((block) => block.type === "tool_use");
    const finished =
      uses.length === 0 ||
      lastStep ||
      response.stop_reason === "refusal" || // a refusal can cut a tool call off mid-input
      response.stop_reason === "max_tokens"; // so can the token limit: never run a truncated call
    if (finished) return { response, messages, responses, toolCalls };

    const results: ToolResultBlock[] = [];
    for (const use of uses) {
      if (use.type !== "tool_use") continue;
      let content: string;
      let isError: boolean;
      try {
        ({ content, isError } = await runTool(use.name, use.input));
      } catch (error) {
        content = `The tool failed: ${(error as Error).message}`;
        isError = true;
      }
      toolCalls.push({ name: use.name, input: use.input, isError });
      results.push({ type: "tool_result", tool_use_id: use.id, content, ...(isError ? { is_error: true } : {}) });
    }
    messages.push({ role: "user", content: results satisfies ContentBlock[] });
  }
}
