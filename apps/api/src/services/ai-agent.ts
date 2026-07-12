import type { AiReplyOutput } from '@waos/shared';
import type { LLMPort, LlmContentPart, LlmMessage, LlmToolDefinition } from '@waos/ports';
import { JSON_REPAIR_MESSAGE, parseAiOutput } from './ai-reply.js';

/**
 * The tool-loop selling agent (CLAUDE.md-adjacent, Task 8 brief). Pure with
 * respect to IO other than the injected `llm` and `tools.execute`: it never
 * imports a repository or provider adapter directly, so the round-trip and
 * round-cap semantics stay unit-testable with a scripted fake LLM. The
 * concrete shop tools (with real repository/order-service access) are built
 * behind this interface in shop-tools.ts.
 */
export interface AgentTools {
  definitions: LlmToolDefinition[];
  execute(name: string, args: Record<string, unknown>): Promise<unknown>;
}

export interface AgentRunResult {
  /** Parsed final strict-JSON answer; null if unparseable after one repair. */
  output: AiReplyOutput | null;
  /** Executed tool names, in execution order (including ones that threw). */
  toolsUsed: string[];
  /** Final raw text, kept for debugging only. Never logged (CLAUDE.md section 6). */
  raw: string;
}

export const MAX_TOOL_ROUNDS = 4;

const ROUND_CAP_NUDGE = 'Answer now with the strict JSON only.';

/**
 * Runs one tool-calling conversation to a strict-JSON answer.
 *
 * Loop semantics (exact, per the Task 8 brief): call the model with the
 * tool definitions; while it keeps returning tool calls and the round cap
 * has not been hit, execute every call for that round (an executor that
 * throws yields a `{ error }` tool_result instead of crashing the loop),
 * append ONE assistant message carrying that round's `tool_call` parts and
 * ONE user message carrying the matching `tool_result` parts in the same
 * order, then call again. Once there are no more tool calls, or the round
 * cap is hit, make one final call without tools (nudging for strict JSON
 * when the cap was hit). Parse the result; on a parse failure, make exactly
 * one repair call (reusing ai-reply's exact repair wording) without tools.
 */
export async function runAgentLoop(params: {
  llm: LLMPort;
  system: string;
  messages: LlmMessage[];
  tools: AgentTools | null;
  maxTokens?: number;
}): Promise<AgentRunResult> {
  const { llm, system, tools, maxTokens } = params;
  let messages = params.messages;
  const toolsUsed: string[] = [];
  let rounds = 0;

  let completion = await llm.complete({ system, messages, tools: tools?.definitions, maxTokens });

  while (completion.toolCalls && completion.toolCalls.length > 0 && rounds < MAX_TOOL_ROUNDS) {
    rounds += 1;
    const toolCallParts: LlmContentPart[] = [];
    const toolResultParts: LlmContentPart[] = [];

    for (const call of completion.toolCalls) {
      toolCallParts.push({ type: 'tool_call', name: call.name, args: call.args });

      let response: unknown;
      if (tools) {
        try {
          response = await tools.execute(call.name, call.args);
        } catch (error) {
          response = { error: error instanceof Error ? error.message : String(error) };
        }
        toolsUsed.push(call.name);
      } else {
        // Defensive only: the model was never given tool definitions when
        // `tools` is null, so a well-behaved provider never reaches here.
        response = { error: 'No tools are available.' };
      }

      toolResultParts.push({ type: 'tool_result', name: call.name, response });
    }

    messages = [
      ...messages,
      { role: 'assistant', content: toolCallParts },
      { role: 'user', content: toolResultParts },
    ];
    completion = await llm.complete({ system, messages, tools: tools?.definitions, maxTokens });
  }

  if (completion.toolCalls && completion.toolCalls.length > 0) {
    // Round cap hit with the model still calling tools: force a strict-JSON
    // answer with no further tool access.
    messages = [...messages, { role: 'user', content: ROUND_CAP_NUDGE }];
    completion = await llm.complete({ system, messages, maxTokens });
  }

  const parsed = parseAiOutput(completion.text);
  if (parsed) {
    return { output: parsed, toolsUsed, raw: completion.text };
  }

  const repair = await llm.complete({
    system,
    messages: [
      ...messages,
      { role: 'assistant', content: completion.text },
      { role: 'user', content: JSON_REPAIR_MESSAGE },
    ],
    maxTokens,
  });
  return { output: parseAiOutput(repair.text), toolsUsed, raw: repair.text };
}
