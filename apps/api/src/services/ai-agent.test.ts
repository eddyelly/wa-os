import { describe, expect, it } from 'vitest';
import type { LLMPort, LlmCompletionParams, LlmCompletion } from '@waos/ports';
import { JSON_REPAIR_MESSAGE } from './ai-reply.js';
import { MAX_TOOL_ROUNDS, runAgentLoop, type AgentTools } from './ai-agent.js';

const goodJson = '{"reply": "Tunafungua saa tatu asubuhi.", "confidence": 0.9, "intent": "question"}';

/**
 * A scripted fake LLM: `complete` pops the next queued response and records
 * every call it was given, so tests can assert both on the returned output
 * and on the exact message sequence sent on the next round.
 */
function scriptedLlm(responses: LlmCompletion[]): LLMPort & { calls: LlmCompletionParams[] } {
  const queue = [...responses];
  const calls: LlmCompletionParams[] = [];
  return {
    calls,
    complete(params: LlmCompletionParams) {
      calls.push(params);
      const next = queue.shift();
      if (!next) {
        throw new Error('scriptedLlm: ran out of queued responses');
      }
      return Promise.resolve(next);
    },
  };
}

function fakeTools(
  execute: (name: string, args: Record<string, unknown>) => Promise<unknown>,
  productIdsSeen?: string[],
): AgentTools {
  return {
    definitions: [{ name: 'search_products', description: 'search', parameters: {} }],
    execute,
    productIdsSeen,
  };
}

describe('runAgentLoop', () => {
  it('no tools: makes a single call and returns the parsed strict JSON (backward compatible)', async () => {
    const llm = scriptedLlm([{ text: goodJson }]);

    const result = await runAgentLoop({
      llm,
      system: 'sys',
      messages: [{ role: 'user', content: 'bei?' }],
      tools: null,
    });

    expect(result.output?.confidence).toBe(0.9);
    expect(result.toolsUsed).toEqual([]);
    expect(result.raw).toBe(goodJson);
    expect(result.productIdsSeen).toEqual([]);
    expect(llm.calls).toHaveLength(1);
    expect(llm.calls[0]?.tools).toBeUndefined();
  });

  it('tool round trip: executes the tool, appends matching tool_call/tool_result parts, then returns the second answer', async () => {
    const llm = scriptedLlm([
      { text: '', toolCalls: [{ name: 'search_products', args: { query: 'wig' } }] },
      { text: goodJson },
    ]);
    const executed: Array<{ name: string; args: Record<string, unknown> }> = [];
    const tools = fakeTools((name, args) => {
      executed.push({ name, args });
      return Promise.resolve({ products: [] });
    });

    const result = await runAgentLoop({
      llm,
      system: 'sys',
      messages: [{ role: 'user', content: 'una wig?' }],
      tools,
    });

    expect(result.output?.confidence).toBe(0.9);
    expect(result.toolsUsed).toEqual(['search_products']);
    expect(executed).toEqual([{ name: 'search_products', args: { query: 'wig' } }]);

    expect(llm.calls).toHaveLength(2);
    const secondCallMessages = llm.calls[1]?.messages ?? [];
    const assistantMsg = secondCallMessages[secondCallMessages.length - 2];
    const userMsg = secondCallMessages[secondCallMessages.length - 1];
    expect(assistantMsg).toEqual({
      role: 'assistant',
      content: [{ type: 'tool_call', name: 'search_products', args: { query: 'wig' } }],
    });
    expect(userMsg).toEqual({
      role: 'user',
      content: [{ type: 'tool_result', name: 'search_products', response: { products: [] } }],
    });
  });

  it('copies tools.productIdsSeen into the result after a successful run', async () => {
    const llm = scriptedLlm([
      { text: '', toolCalls: [{ name: 'search_products', args: { query: 'wig' } }] },
      { text: goodJson },
    ]);
    const tools = fakeTools(() => Promise.resolve({ products: [] }), ['p1', 'p2']);

    const result = await runAgentLoop({
      llm,
      system: 'sys',
      messages: [{ role: 'user', content: 'una wig?' }],
      tools,
    });

    expect(result.productIdsSeen).toEqual(['p1', 'p2']);
  });

  it('copies tools.productIdsSeen into the result even when the answer needed a repair call', async () => {
    const llm = scriptedLlm([
      { text: '', toolCalls: [{ name: 'search_products', args: { query: 'wig' } }] },
      { text: 'not json' },
      { text: 'still not json' },
    ]);
    const tools = fakeTools(() => Promise.resolve({ products: [] }), ['p1']);

    const result = await runAgentLoop({
      llm,
      system: 'sys',
      messages: [{ role: 'user', content: 'una wig?' }],
      tools,
    });

    expect(result.output).toBeNull();
    expect(result.productIdsSeen).toEqual(['p1']);
  });

  it('defaults productIdsSeen to an empty array when the tools object never sets it', async () => {
    const llm = scriptedLlm([
      { text: '', toolCalls: [{ name: 'search_products', args: { query: 'wig' } }] },
      { text: goodJson },
    ]);
    const tools = fakeTools(() => Promise.resolve({ products: [] }));

    const result = await runAgentLoop({
      llm,
      system: 'sys',
      messages: [{ role: 'user', content: 'una wig?' }],
      tools,
    });

    expect(result.productIdsSeen).toEqual([]);
  });

  it('round cap: an LLM that always returns tool calls stops after MAX_TOOL_ROUNDS and gets one final no-tools call with the nudge', async () => {
    const toolCallResponse: LlmCompletion = {
      text: 'ignored',
      toolCalls: [{ name: 'search_products', args: { query: 'x' } }],
    };
    const llm = scriptedLlm([
      toolCallResponse,
      toolCallResponse,
      toolCallResponse,
      toolCallResponse,
      toolCallResponse,
      { text: goodJson },
    ]);
    const tools = fakeTools(() => Promise.resolve({ products: [] }));

    const result = await runAgentLoop({
      llm,
      system: 'sys',
      messages: [{ role: 'user', content: 'una wig?' }],
      tools,
    });

    expect(result.toolsUsed).toHaveLength(MAX_TOOL_ROUNDS);
    expect(result.output?.confidence).toBe(0.9);
    // 1 initial + 4 rounds (one call each after executing) + 1 final no-tools call.
    expect(llm.calls).toHaveLength(6);
    const finalCall = llm.calls[5];
    expect(finalCall?.tools).toBeUndefined();
    const finalMessages = finalCall?.messages ?? [];
    expect(finalMessages[finalMessages.length - 1]).toEqual({
      role: 'user',
      content: 'Answer now with the strict JSON only.',
    });
  });

  it('executor throw becomes a { error } tool_result and the loop continues to a successful answer', async () => {
    const llm = scriptedLlm([
      { text: '', toolCalls: [{ name: 'search_products', args: { query: 'boom' } }] },
      { text: goodJson },
    ]);
    const tools = fakeTools(() => {
      throw new Error('kaboom');
    });

    const result = await runAgentLoop({
      llm,
      system: 'sys',
      messages: [{ role: 'user', content: 'una wig?' }],
      tools,
    });

    expect(result.output?.confidence).toBe(0.9);
    expect(result.toolsUsed).toEqual(['search_products']);
    const secondCallMessages = llm.calls[1]?.messages ?? [];
    const userMsg = secondCallMessages[secondCallMessages.length - 1];
    expect(userMsg).toEqual({
      role: 'user',
      content: [{ type: 'tool_result', name: 'search_products', response: { error: 'kaboom' } }],
    });
  });

  it('unparseable final answer triggers exactly one repair call using the exact ai-reply repair message; still bad -> null output', async () => {
    const llm = scriptedLlm([{ text: 'not json' }, { text: 'still not json' }]);

    const result = await runAgentLoop({
      llm,
      system: 'sys',
      messages: [{ role: 'user', content: 'bei?' }],
      tools: null,
    });

    expect(result.output).toBeNull();
    expect(result.raw).toBe('still not json');
    expect(llm.calls).toHaveLength(2);
    const repairMessages = llm.calls[1]?.messages ?? [];
    expect(repairMessages[repairMessages.length - 1]).toEqual({
      role: 'user',
      content: JSON_REPAIR_MESSAGE,
    });
  });

  it('a good final answer needs no repair call at all', async () => {
    const llm = scriptedLlm([{ text: goodJson }]);

    const result = await runAgentLoop({
      llm,
      system: 'sys',
      messages: [{ role: 'user', content: 'bei?' }],
      tools: null,
    });

    expect(result.output).not.toBeNull();
    expect(llm.calls).toHaveLength(1);
  });
});
