import { describe, expect, it } from 'vitest';
import type { Message } from '@prisma/client';
import type { LLMPort } from '@waos/ports';
import {
  buildConversationMessages,
  buildSystemPrompt,
  completeWithRepair,
  decideAiAction,
  parseAiOutput,
  parseOrgAiSettings,
  parseOrgShopSettings,
  replyTargetForAi,
} from './ai-reply.js';

const goodJson = '{"reply": "Tunafungua saa tatu asubuhi.", "confidence": 0.9, "intent": "question"}';

function fakeLlm(responses: string[]): LLMPort {
  const queue = [...responses];
  return {
    complete: () => Promise.resolve({ text: queue.shift() ?? '' }),
  };
}

function message(direction: 'IN' | 'OUT', body: string, id?: string): Message {
  return { direction, body, id } as Message;
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

  it('omits the shop rules when shop is not enabled', () => {
    const prompt = buildSystemPrompt({
      businessName: 'Nuru Salon',
      vertical: 'salon',
      defaultLanguage: 'sw',
      chunks: [],
    });
    expect(prompt).not.toContain('search_products');
    expect(prompt).not.toContain('negotiate_price');
    expect(prompt).not.toContain('record_order');
  });

  it('inserts the shop rules as 6-8 and renumbers the tone-notes rule to 9 when shop is enabled', () => {
    const prompt = buildSystemPrompt({
      businessName: 'Nuru Salon',
      vertical: 'salon',
      defaultLanguage: 'sw',
      toneNotes: 'Always greet with Karibu sana.',
      chunks: [],
      shop: { enabled: true },
    });
    expect(prompt).toContain(
      '6. You can sell from the catalog: use search_products before answering availability or price questions, and use the tools rather than guessing.',
    );
    expect(prompt).toContain(
      "7. Bargaining: if the customer asks for a discount, you may propose their price with negotiate_price. If the shop declines, offer the counterPrice as the best you can do and call it final. Never invent discounts and never state that a lower limit exists.",
    );
    expect(prompt).toContain(
      '8. When the customer clearly agrees to buy at an agreed price, call record_order once, then relay the payment instructions it returns and thank them.',
    );
    expect(prompt).toContain('9. Business tone notes: Always greet with Karibu sana.');
    expect(prompt).not.toContain('6. Business tone notes');
  });

  it('does not insert the shop rules when shop.enabled is false', () => {
    const prompt = buildSystemPrompt({
      businessName: 'Nuru Salon',
      vertical: 'salon',
      defaultLanguage: 'sw',
      toneNotes: 'Always greet with Karibu sana.',
      chunks: [],
      shop: { enabled: false },
    });
    expect(prompt).not.toContain('search_products');
    expect(prompt).toContain('6. Business tone notes: Always greet with Karibu sana.');
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
    expect(
      transcript.every(
        (m) => typeof m.content === 'string' && m.content.trim().length > 0
      )
    ).toBe(true);
  });

  it('attaches an image part with a fallback question when the final IN turn (an image message) has no caption', () => {
    const history = [
      message('IN', 'Habari'),
      message('OUT', 'Karibu!'),
      { id: 'img1', direction: 'IN', body: null, type: 'IMAGE', mediaKey: 'org1/conv1/msg1' } as Message,
    ];
    const transcript = buildConversationMessages(history, {
      messageId: 'img1',
      mimeType: 'image/jpeg',
      data: 'YmFzZTY0',
    });
    const last = transcript[transcript.length - 1];
    expect(last).toEqual({
      role: 'user',
      content: [
        { type: 'image', mimeType: 'image/jpeg', data: 'YmFzZTY0' },
        { type: 'text', text: 'What is this? Do you have it?' },
      ],
    });
  });

  it('uses the caption as the text part when the final image turn has a body', () => {
    const history = [
      {
        id: 'img1',
        direction: 'IN',
        body: 'Hii ni bei gani?',
        type: 'IMAGE',
        mediaKey: 'org1/conv1/msg1',
      } as Message,
    ];
    const transcript = buildConversationMessages(history, {
      messageId: 'img1',
      mimeType: 'image/jpeg',
      data: 'YmFzZTY0',
    });
    expect(transcript[transcript.length - 1]).toEqual({
      role: 'user',
      content: [
        { type: 'image', mimeType: 'image/jpeg', data: 'YmFzZTY0' },
        { type: 'text', text: 'Hii ni bei gani?' },
      ],
    });
  });

  it('attaches the image to its target message by id even when a newer text turn follows', () => {
    // Regression for a worker-concurrency bug: the image bytes were fetched
    // for one specific inbound trigger message, but a positional "attach to
    // the last turn" rule could splice them onto an unrelated newer turn
    // that arrived while the fetch was in flight. Identity must win.
    const history = [
      {
        id: 'img1',
        direction: 'IN',
        body: null,
        type: 'IMAGE',
        mediaKey: 'org1/conv1/img1',
      } as Message,
      message('IN', 'Bei gani?', 'txt1'),
    ];
    const transcript = buildConversationMessages(history, {
      messageId: 'img1',
      mimeType: 'image/jpeg',
      data: 'YmFzZTY0',
    });
    expect(transcript).toEqual([
      {
        role: 'user',
        content: [
          { type: 'image', mimeType: 'image/jpeg', data: 'YmFzZTY0' },
          { type: 'text', text: 'What is this? Do you have it?' },
        ],
      },
      { role: 'user', content: 'Bei gani?' },
    ]);
  });

  it('behaves as if finalImage were absent when no history entry matches its messageId', () => {
    const history = [message('IN', 'Habari'), message('OUT', 'Karibu!')];
    const transcript = buildConversationMessages(history, {
      messageId: 'scrolled-out-of-the-200-window',
      mimeType: 'image/jpeg',
      data: 'YmFzZTY0',
    });
    expect(transcript[transcript.length - 1]).toEqual({ role: 'user', content: 'Habari' });
  });
});

describe('parseOrgAiSettings', () => {
  it('defaults to enabled for missing or malformed settings', () => {
    expect(parseOrgAiSettings(null).aiEnabled).toBe(true);
    expect(parseOrgAiSettings(undefined).aiEnabled).toBe(true);
    expect(parseOrgAiSettings('junk').aiEnabled).toBe(true);
    expect(parseOrgAiSettings({}).aiEnabled).toBe(true);
  });

  it('only an explicit false disables the AI', () => {
    expect(parseOrgAiSettings({ aiEnabled: false }).aiEnabled).toBe(false);
    expect(parseOrgAiSettings({ aiEnabled: true }).aiEnabled).toBe(true);
    expect(parseOrgAiSettings({ aiEnabled: 'no' }).aiEnabled).toBe(true);
  });

  it('carries threshold and tone notes through', () => {
    const parsed = parseOrgAiSettings({
      aiEnabled: false,
      aiConfidenceThreshold: 0.5,
      toneNotes: 'warm and brief',
    });
    expect(parsed).toEqual({
      aiEnabled: false,
      aiConfidenceThreshold: 0.5,
      toneNotes: 'warm and brief',
    });
  });
});

describe('replyTargetForAi', () => {
  const inbound = (id: string) => ({ id, direction: 'IN' as const });
  const outbound = (id: string) => ({ id, direction: 'OUT' as const });

  it('returns the inbound id when 2+ messages are unanswered since the last outbound', () => {
    const messages = [outbound('o1'), inbound('i1'), inbound('i2')];
    expect(replyTargetForAi(messages, 'i2')).toBe('i2');
  });

  it('returns undefined for a single unanswered message', () => {
    const messages = [outbound('o1'), inbound('i1')];
    expect(replyTargetForAi(messages, 'i1')).toBeUndefined();
  });

  it('returns undefined when the last message is outbound', () => {
    const messages = [inbound('i1'), outbound('o1')];
    expect(replyTargetForAi(messages, 'i1')).toBeUndefined();
  });
});

describe('parseOrgShopSettings', () => {
  it('defaults owner alerts to disabled for missing or malformed settings', () => {
    expect(parseOrgShopSettings(null)).toEqual({ ownerAlertsEnabled: false });
    expect(parseOrgShopSettings(undefined)).toEqual({ ownerAlertsEnabled: false });
    expect(parseOrgShopSettings('junk')).toEqual({ ownerAlertsEnabled: false });
    expect(parseOrgShopSettings({})).toEqual({ ownerAlertsEnabled: false });
  });

  it('treats ownerAlertsEnabled as false when no phone is on file', () => {
    expect(parseOrgShopSettings({ ownerAlertsEnabled: true })).toEqual({
      ownerAlertsEnabled: false,
    });
  });

  it('enables owner alerts and carries the phone and payment instructions through', () => {
    const parsed = parseOrgShopSettings({
      ownerAlertsEnabled: true,
      ownerAlertPhone: '+255700000000',
      paymentInstructions: 'Pay via M-Pesa to 0700 000 000.',
    });
    expect(parsed).toEqual({
      ownerAlertsEnabled: true,
      ownerAlertPhone: '+255700000000',
      paymentInstructions: 'Pay via M-Pesa to 0700 000 000.',
    });
  });
});
