import { z } from 'zod';

export const createKnowledgeDocRequestSchema = z.object({
  title: z.string().trim().min(2).max(200),
  content: z.string().trim().min(10).max(500_000),
});
export type CreateKnowledgeDocRequest = z.infer<typeof createKnowledgeDocRequestSchema>;

export const knowledgeDocSchema = z.object({
  id: z.string(),
  title: z.string(),
  mimeType: z.string(),
  chunkCount: z.number(),
  embeddedCount: z.number(),
  createdAt: z.coerce.date(),
});
export type KnowledgeDocDto = z.infer<typeof knowledgeDocSchema>;

/**
 * The strict JSON contract the LLM must return for every AI reply. Parsed
 * with one repair retry; anything else is a handoff.
 */
export const aiReplyOutputSchema = z.object({
  reply: z.string().min(1).max(4000),
  confidence: z.number().min(0).max(1),
  intent: z.enum(['question', 'booking', 'complaint', 'greeting', 'other']),
});
export type AiReplyOutput = z.infer<typeof aiReplyOutputSchema>;

export const aiTestResultSchema = z.object({
  reply: z.string(),
  confidence: z.number().min(0).max(1),
  intent: z.string(),
  action: z.enum(['REPLY', 'HANDOFF']),
  chunksUsed: z.number().int(),
});
export type AiTestResultDto = z.infer<typeof aiTestResultSchema>;
