import type { Message } from '@prisma/client';
import type { LLMPort, LlmMessage } from '@waos/ports';
import { aiReplyOutputSchema, type AiReplyOutput } from '@waos/shared';
import type { RetrievedChunk } from '../repositories/knowledge-repository.js';

/**
 * Prompt and decision logic for the RAG auto-reply, kept pure so the
 * threshold branching and JSON repair paths are unit-testable without a
 * database or provider.
 */

export function buildSystemPrompt(params: {
  businessName: string;
  vertical: string;
  defaultLanguage: string;
  toneNotes?: string;
  chunks: RetrievedChunk[];
}): string {
  const context =
    params.chunks.length > 0
      ? params.chunks.map((chunk, i) => `[${i + 1}] ${chunk.content}`).join('\n\n')
      : '(no business information matched this question)';
  return [
    `You are the WhatsApp assistant for "${params.businessName}", a ${params.vertical} business in Tanzania.`,
    '',
    'Rules, in order of priority:',
    '1. Answer ONLY from the business context below. Never invent prices, services, opening hours, or availability.',
    "2. Reply in the customer's language: detect Swahili or English from their last message and answer in the same language. Default to " +
      (params.defaultLanguage === 'sw' ? 'Swahili' : 'English') +
      ' when unsure.',
    '3. Be concise, warm, and polite, like a helpful receptionist. Two to four short sentences at most.',
    '4. If the context does not answer the question, or you are unsure, say that a person from the team will follow up shortly, and set confidence below 0.3.',
    '5. If the customer wants to book, propose what you know from the context (services, hours) and say the team will confirm the exact slot. Set intent to "booking".',
    params.toneNotes ? `6. Business tone notes: ${params.toneNotes}` : '',
    '',
    'BUSINESS CONTEXT:',
    context,
    '',
    'Respond with STRICT JSON only, no markdown fences, exactly this shape:',
    '{"reply": "<the message to send>", "confidence": <0..1>, "intent": "question" | "booking" | "complaint" | "greeting" | "other"}',
  ]
    .filter((line) => line !== '')
    .join('\n');
}

export function buildConversationMessages(history: Message[]): LlmMessage[] {
  const messages: LlmMessage[] = history
    .filter((message) => (message.body ?? '').trim().length > 0)
    .map((message) => ({
      role: message.direction === 'IN' ? ('user' as const) : ('assistant' as const),
      content: message.body ?? '',
    }));
  // The transcript must end with a user turn for the model to answer it.
  while (messages.length > 0 && messages[messages.length - 1]?.role === 'assistant') {
    messages.pop();
  }
  return messages.slice(-10);
}

export function parseAiOutput(text: string): AiReplyOutput | null {
  const trimmed = text
    .trim()
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/```\s*$/, '');
  try {
    return aiReplyOutputSchema.parse(JSON.parse(trimmed));
  } catch {
    return null;
  }
}

/**
 * Ask the model, with one repair retry when the output is not the strict
 * JSON contract. Returns null when both attempts fail.
 */
export async function completeWithRepair(
  llm: LLMPort,
  system: string,
  messages: LlmMessage[],
): Promise<AiReplyOutput | null> {
  const first = await llm.complete({ system, messages });
  const parsed = parseAiOutput(first.text);
  if (parsed) {
    return parsed;
  }
  const repair = await llm.complete({
    system,
    messages: [
      ...messages,
      { role: 'assistant', content: first.text },
      {
        role: 'user',
        content:
          'Your previous output was not valid JSON. Respond again with ONLY the JSON object, exactly: {"reply": string, "confidence": number, "intent": "question"|"booking"|"complaint"|"greeting"|"other"}',
      },
    ],
  });
  return parseAiOutput(repair.text);
}

export type AiDecision = 'REPLY' | 'HANDOFF';

/**
 * The confidence threshold branch (CLAUDE.md section 8). Booking intent
 * always hands off to a human to confirm the slot (Phase 1 thin slice),
 * even when the reply itself goes out.
 */
export function decideAiAction(output: AiReplyOutput | null, threshold: number): AiDecision {
  if (!output) {
    return 'HANDOFF';
  }
  return output.confidence >= threshold ? 'REPLY' : 'HANDOFF';
}

export interface OrgAiSettings {
  aiEnabled: boolean;
  aiConfidenceThreshold?: number;
  toneNotes?: string;
}

/**
 * Parse the org's untyped settings Json into the AI knobs. aiEnabled is the
 * global kill switch: only an explicit false turns the AI off, so existing
 * orgs (no key stored) keep answering.
 */
export function parseOrgAiSettings(settings: unknown): OrgAiSettings {
  if (typeof settings !== 'object' || settings === null) {
    return { aiEnabled: true };
  }
  const record = settings as Record<string, unknown>;
  return {
    aiEnabled: record.aiEnabled !== false,
    ...(typeof record.aiConfidenceThreshold === 'number'
      ? { aiConfidenceThreshold: record.aiConfidenceThreshold }
      : {}),
    ...(typeof record.toneNotes === 'string' && record.toneNotes.trim().length > 0
      ? { toneNotes: record.toneNotes }
      : {}),
  };
}
