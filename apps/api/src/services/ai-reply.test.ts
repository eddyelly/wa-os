import { describe, expect, it } from 'vitest';
import type { Message } from '@prisma/client';
import type { LLMPort } from '@waos/ports';
import {
  buildConversationMessages,
  buildSystemPrompt,
  completeWithRepair,
  decideAiAction,
  parseAiOutput,
} from './ai-reply.js';

const goodJson = '{"reply": "Tunafungua saa tatu asubuhi.", "confidence": 0.9, "intent": "question"}';

function fakeLlm(responses: string[]): LLMPort {
  const queue = [...responses];
  return {
    complete: () => Promise.resolve({ text: queue.shift() ?? '' }),
  };
}

function message(direction: 'IN' | 'OUT', body: string): Message {
  return { direction, body } as Message;
}

describe('parseAiOutput', () => {
  it('parses strict json', () => {
    expect(parseAiOutput(goodJson)?.confidence).toBe(0.9);
  });

  it('tolerates markdown fences', () => {
    expect(parseAiOutput('```json\n' + goodJson + '\n```')?.intent).toBe('question');
  });

  it('rejects prose, malformed json, and out-of-range confidence', () => {
    expect(parseAiOutput('Habari! Tunafungua saa tatu.')).toBeNull();
    expect(parseAiOutput('{"reply": "x", "confidence": 1.4, "intent": "question"}')).toBeNull();
    expect(parseAiOutput('{"reply": "x", "confidence": 0.5, "intent": "nonsense"}')).toBeNull();
  });
});

describe('completeWithRepair', () => {
  it('returns the first output when valid', async () => {
    const output = await completeWithRepair(fakeLlm([goodJson]), 'sys', [
      { role: 'user', content: 'bei?' },
    ]);
    expect(output?.reply).toContain('saa tatu');
  });

  it('repairs once when the first output is not json', async () => {
    const output = await completeWithRepair(fakeLlm(['Sorry, here is your answer.', goodJson]), 'sys', [
      { role: 'user', content: 'bei?' },
    ]);
    expect(output?.confidence).toBe(0.9);
  });

  it('gives up (handoff) after a failed repair', async () => {
    const output = await completeWithRepair(fakeLlm(['not json', 'still not json']), 'sys', [
      { role: 'user', content: 'bei?' },
    ]);
    expect(output).toBeNull();
    expect(decideAiAction(output, 0.7)).toBe('HANDOFF');
  });
});

describe('confidence threshold branching', () => {
  const output = (confidence: number) =>
    ({ reply: 'jibu', confidence, intent: 'question' }) as const;

  it('replies at or above the threshold', () => {
    expect(decideAiAction(output(0.7), 0.7)).toBe('REPLY');
    expect(decideAiAction(output(0.95), 0.7)).toBe('REPLY');
  });

  it('hands off below the threshold', () => {
    expect(decideAiAction(output(0.69), 0.7)).toBe('HANDOFF');
    expect(decideAiAction(output(0.1), 0.7)).toBe('HANDOFF');
  });

  it('hands off when the model never produced valid output', () => {
    expect(decideAiAction(null, 0.7)).toBe('HANDOFF');
  });

  it('respects a per-organization threshold override', () => {
    expect(decideAiAction(output(0.6), 0.5)).toBe('REPLY');
    expect(decideAiAction(output(0.6), 0.9)).toBe('HANDOFF');
  });
});

describe('prompt construction', () => {
  it('embeds retrieved chunks and the language rule', () => {
    const prompt = buildSystemPrompt({
      businessName: 'Nuru Salon',
      vertical: 'salon',
      defaultLanguage: 'sw',
      chunks: [
        { id: 'c1', docId: 'd1', content: 'Rasta TZS 25,000.', score: 0.9 },
        { id: 'c2', docId: 'd1', content: 'Tunafungua 9:00.', score: 0.8 },
      ],
    });
    expect(prompt).toContain('Rasta TZS 25,000.');
    expect(prompt).toContain('Answer ONLY from the business context');
    expect(prompt).toContain('Swahili');
    expect(prompt).toContain('STRICT JSON');
  });

  it('says so when no context matched', () => {
    const prompt = buildSystemPrompt({
      businessName: 'Nuru Salon',
      vertical: 'salon',
      defaultLanguage: 'sw',
      chunks: [],
    });
    expect(prompt).toContain('no business information matched');
  });

  it('appends tone notes when provided', () => {
    const prompt = buildSystemPrompt({
      businessName: 'Nuru Salon',
      vertical: 'salon',
      defaultLanguage: 'sw',
      toneNotes: 'Always greet with Karibu sana.',
      chunks: [],
    });
    expect(prompt).toContain('Karibu sana');
  });
});

describe('conversation transcript', () => {
  it('maps directions to roles and ends on a user turn', () => {
    const history = [
      message('IN', 'Habari'),
      message('OUT', 'Karibu!'),
      message('IN', 'Bei ya rasta?'),
      message('OUT', 'TZS 25,000'),
    ];
    const transcript = buildConversationMessages(history);
    expect(transcript[transcript.length - 1]).toEqual({ role: 'user', content: 'Bei ya rasta?' });
  });

  it('drops empty bodies and caps history length', () => {
    const history = [
      ...Array.from({ length: 30 }, (_, i) => message('IN', `swali ${i}`)),
      message('IN', '   '),
    ];
    const transcript = buildConversationMessages(history);
    expect(transcript.length).toBeLessThanOrEqual(10);
    expect(transcript.every((m) => m.content.trim().length > 0)).toBe(true);
  });
});
