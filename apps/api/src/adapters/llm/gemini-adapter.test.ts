import { beforeEach, describe, expect, it, vi } from 'vitest';

// vi.hoisted is required (not just vi.mock's own hoisting) because
// gemini-adapter.ts eagerly constructs `llmPort` at module load time. That
// construction happens while this file's imports are still being resolved,
// before a plain top-level `const` would be initialized, which throws a
// temporal-dead-zone ReferenceError inside the mock factory below.
const { generateContent } = vi.hoisted(() => ({ generateContent: vi.fn() }));

vi.mock('@google/genai', () => ({
  GoogleGenAI: class {
    models = { generateContent };
  },
}));

import { GeminiLlmAdapter } from './gemini-adapter.js';

describe('GeminiLlmAdapter', () => {
  beforeEach(() => {
    generateContent.mockReset();
    generateContent.mockResolvedValue({ text: 'hello', functionCalls: undefined });
  });

  it('maps roles and string content to Gemini contents', async () => {
    const adapter = new GeminiLlmAdapter();
    await adapter.complete({
      system: 'sys',
      messages: [
        { role: 'user', content: 'habari' },
        { role: 'assistant', content: 'karibu' },
      ],
    });
    const call = generateContent.mock.calls[0]?.[0] as {
      contents: Array<{ role: string; parts: Array<{ text?: string }> }>;
      config: { systemInstruction: string };
    };
    expect(call.contents).toEqual([
      { role: 'user', parts: [{ text: 'habari' }] },
      { role: 'model', parts: [{ text: 'karibu' }] },
    ]);
    expect(call.config.systemInstruction).toBe('sys');
  });

  it('maps image and tool_result parts', async () => {
    const adapter = new GeminiLlmAdapter();
    await adapter.complete({
      system: 'sys',
      messages: [
        {
          role: 'user',
          content: [
            { type: 'text', text: 'what is this?' },
            { type: 'image', mimeType: 'image/jpeg', data: 'aGVsbG8=' },
            { type: 'tool_result', name: 'searchProducts', response: { hits: 1 } },
          ],
        },
      ],
    });
    const call = generateContent.mock.calls[0]?.[0] as {
      contents: Array<{ parts: unknown[] }>;
    };
    expect(call.contents[0]?.parts).toEqual([
      { text: 'what is this?' },
      { inlineData: { mimeType: 'image/jpeg', data: 'aGVsbG8=' } },
      { functionResponse: { name: 'searchProducts', response: { output: { hits: 1 } } } },
    ]);
  });

  it('passes tool definitions and returns tool calls', async () => {
    generateContent.mockResolvedValue({
      text: '',
      functionCalls: [{ name: 'negotiate', args: { productId: 'p1', proposedPrice: 900 } }],
    });
    const adapter = new GeminiLlmAdapter();
    const result = await adapter.complete({
      system: 'sys',
      messages: [{ role: 'user', content: 'bei gani?' }],
      tools: [{ name: 'negotiate', description: 'propose a price', parameters: { type: 'object' } }],
    });
    expect(result.toolCalls).toEqual([
      { name: 'negotiate', args: { productId: 'p1', proposedPrice: 900 } },
    ]);
    const call = generateContent.mock.calls[0]?.[0] as {
      config: { tools?: Array<{ functionDeclarations: Array<{ name: string }> }> };
    };
    expect(call.config.tools?.[0]?.functionDeclarations[0]?.name).toBe('negotiate');
  });

  it('maps a prior tool_call part followed by its tool_result into model/user turns', async () => {
    const adapter = new GeminiLlmAdapter();
    await adapter.complete({
      system: 'sys',
      messages: [
        {
          role: 'assistant',
          content: [
            { type: 'tool_call', name: 'searchProducts', args: { query: 'shoes' } },
          ],
        },
        {
          role: 'user',
          content: [
            { type: 'tool_result', name: 'searchProducts', response: { hits: 1 } },
          ],
        },
      ],
    });
    const call = generateContent.mock.calls[0]?.[0] as {
      contents: Array<{ role: string; parts: unknown[] }>;
    };
    expect(call.contents).toEqual([
      {
        role: 'model',
        parts: [{ functionCall: { name: 'searchProducts', args: { query: 'shoes' } } }],
      },
      {
        role: 'user',
        parts: [{ functionResponse: { name: 'searchProducts', response: { output: { hits: 1 } } } }],
      },
    ]);
  });

  it('returns plain text with no toolCalls when the model just answers', async () => {
    const adapter = new GeminiLlmAdapter();
    const result = await adapter.complete({
      system: 'sys',
      messages: [{ role: 'user', content: 'habari' }],
    });
    expect(result).toEqual({ text: 'hello', toolCalls: undefined });
  });
});
