import { z } from 'zod';

export const conversationStatusSchema = z.enum(['OPEN', 'PENDING', 'CLOSED']);
export type ConversationStatus = z.infer<typeof conversationStatusSchema>;

export const messageDirectionSchema = z.enum(['IN', 'OUT']);
export const messageTypeSchema = z.enum([
  'TEXT',
  'IMAGE',
  'AUDIO',
  'DOCUMENT',
  'LOCATION',
  'OTHER',
]);
export const authorTypeSchema = z.enum(['CONTACT', 'HUMAN_AGENT', 'AI', 'SYSTEM']);
export const messageStatusSchema = z.enum([
  'QUEUED',
  'SENT',
  'DELIVERED',
  'READ',
  'FAILED',
  'BLOCKED',
]);

export const messageSchema = z.object({
  id: z.string(),
  conversationId: z.string(),
  direction: messageDirectionSchema,
  type: messageTypeSchema,
  body: z.string().nullable(),
  mediaUrl: z.string().nullable().optional(),
  authorType: authorTypeSchema,
  status: messageStatusSchema,
  blockedReason: z.string().nullable().optional(),
  createdAt: z.coerce.date(),
});
export type MessageDto = z.infer<typeof messageSchema>;

export const conversationContactSchema = z.object({
  id: z.string(),
  phone: z.string(),
  name: z.string().nullable(),
  language: z.string().nullable(),
  optedInAt: z.coerce.date().nullable(),
});

export const conversationListItemSchema = z.object({
  id: z.string(),
  status: conversationStatusSchema,
  aiEnabled: z.boolean(),
  assigneeId: z.string().nullable(),
  assigneeName: z.string().nullable().optional(),
  lastMessageAt: z.coerce.date().nullable(),
  lastMessagePreview: z.string().nullable().optional(),
  contact: conversationContactSchema,
});
export type ConversationListItem = z.infer<typeof conversationListItemSchema>;

export const sendMessageRequestSchema = z.object({
  body: z.string().trim().min(1).max(4096),
});
export type SendMessageRequest = z.infer<typeof sendMessageRequestSchema>;

export const assignConversationRequestSchema = z.object({
  assigneeId: z.string().nullable(),
});

export const updateConversationStatusRequestSchema = z.object({
  status: conversationStatusSchema,
});

export const toggleAiRequestSchema = z.object({
  aiEnabled: z.boolean(),
});
