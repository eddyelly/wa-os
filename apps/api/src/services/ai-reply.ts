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
  shop?: { enabled: boolean };
}): string {
  const context =
    params.chunks.length > 0
      ? params.chunks.map((chunk, i) => `[${i + 1}] ${chunk.content}`).join('\n\n')
      : '(no business information matched this question)';
  const shopEnabled = params.shop?.enabled === true;
  // The tone-notes rule sits right after the shop rules when they are
  // present, so it must renumber from 6 to 9 rather than collide with them.
  const toneNotesRuleNumber = shopEnabled ? 9 : 6;
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
    ...(shopEnabled
      ? [
          '6. You can sell from the catalog: use search_products before answering availability or price questions, and use the tools rather than guessing.',
          '7. Bargaining: if the customer asks for a discount, you may propose their price with negotiate_price. If the shop declines, offer the counterPrice as the best you can do and call it final. Never invent discounts and never state that a lower limit exists.',
          '8. When the customer clearly agrees to buy at an agreed price, call record_order once, then relay the payment instructions it returns and thank them.',
        ]
      : []),
    params.toneNotes ? `${toneNotesRuleNumber}. Business tone notes: ${params.toneNotes}` : '',
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

const NO_CAPTION_QUESTION = 'What is this? Do you have it?';

/**
 * Builds the LLM transcript from stored messages. When `finalImage` is
 * supplied, it is attached to the history entry whose id matches
 * `finalImage.messageId`, wherever that entry sits in the transcript (never
 * by position): the worker fetches those bytes for one specific trigger
 * message, and with worker concurrency and rapid follow-up messages the
 * positionally-last turn is not reliably that same message. That turn
 * carries the image as a content part alongside its caption (or a generic
 * fallback question when there was none), so the vision-capable model sees
 * the photo directly rather than a blank turn, and it is exempt from the
 * empty-body filter below. When no history entry matches (the message has
 * scrolled past the 200-message window), this behaves as if `finalImage`
 * were absent.
 */
export function buildConversationMessages(
  history: Message[],
  finalImage?: { messageId: string; mimeType: string; data: string },
): LlmMessage[] {
  const targetMessage =
    finalImage !== undefined ? history.find((message) => message.id === finalImage.messageId) : undefined;

  const messages: LlmMessage[] = history
    .filter((message) => message === targetMessage || (message.body ?? '').trim().length > 0)
    .map((message) => {
      if (message === targetMessage && finalImage !== undefined) {
        const caption = (message.body ?? '').trim();
        return {
          role: 'user' as const,
          content: [
            { type: 'image' as const, mimeType: finalImage.mimeType, data: finalImage.data },
            { type: 'text' as const, text: caption.length > 0 ? caption : NO_CAPTION_QUESTION },
          ],
        };
      }
      return {
        role: message.direction === 'IN' ? ('user' as const) : ('assistant' as const),
        content: message.body ?? '',
      };
    });
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
 * The exact nudge sent back to the model when its output was not the
 * strict JSON contract. Shared verbatim with the tool-loop agent
 * (ai-agent.ts) so both repair paths reuse the same wording.
 */
export const JSON_REPAIR_MESSAGE =
  'Your previous output was not valid JSON. Respond again with ONLY the JSON object, exactly: {"reply": string, "confidence": number, "intent": "question"|"booking"|"complaint"|"greeting"|"other"}';

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
      { role: 'user', content: JSON_REPAIR_MESSAGE },
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

/**
 * Quote-when-it-helps: the AI attaches a quote only when the customer left 2+
 * messages unanswered since our last outbound (so the reply points at the one
 * it addressed). Returns the message id to quote, or undefined for no quote.
 */
export function replyTargetForAi(
  messages: { direction: 'IN' | 'OUT' }[],
  inboundMessageId: string,
): string | undefined {
  let trailingInbound = 0;
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    if (messages[i]?.direction === 'IN') {
      trailingInbound += 1;
    } else {
      break;
    }
  }
  return trailingInbound >= 2 ? inboundMessageId : undefined;
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

export interface OrgShopSettings {
  paymentInstructions?: string;
  ownerAlertPhone?: string;
  ownerAlertsEnabled: boolean;
}

/**
 * Parse the org's untyped settings Json into the shop owner-alert knobs.
 * ownerAlertsEnabled is true only when explicitly enabled AND a phone
 * number is on file: there is nowhere to send the alert otherwise, so a
 * bare `ownerAlertsEnabled: true` with no phone is treated as disabled.
 */
export function parseOrgShopSettings(settings: unknown): OrgShopSettings {
  if (typeof settings !== 'object' || settings === null) {
    return { ownerAlertsEnabled: false };
  }
  const record = settings as Record<string, unknown>;
  const hasPhone =
    typeof record.ownerAlertPhone === 'string' && record.ownerAlertPhone.length > 0;
  return {
    ...(typeof record.paymentInstructions === 'string' &&
    record.paymentInstructions.trim().length > 0
      ? { paymentInstructions: record.paymentInstructions }
      : {}),
    ...(hasPhone ? { ownerAlertPhone: record.ownerAlertPhone as string } : {}),
    ownerAlertsEnabled: record.ownerAlertsEnabled === true && hasPhone,
  };
}
