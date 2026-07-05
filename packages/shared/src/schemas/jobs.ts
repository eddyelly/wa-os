import { z } from 'zod';

// Every BullMQ job payload is Zod-parsed on enqueue and on process, so a
// malformed job fails fast instead of half-running.

import { policyActionSchema } from './policy.js';

export const outboundSendJobSchema = z.object({
  organizationId: z.string().min(1),
  channelId: z.string().min(1),
  messageId: z.string().min(1),
  action: policyActionSchema.default('REPLY_ACTIVE_CONVERSATION'),
});
export type OutboundSendJob = z.infer<typeof outboundSendJobSchema>;

export const aiReplyJobSchema = z.object({
  organizationId: z.string().min(1),
  conversationId: z.string().min(1),
  inboundMessageId: z.string().min(1),
});
export type AiReplyJob = z.infer<typeof aiReplyJobSchema>;

export const embeddingsJobSchema = z.object({
  organizationId: z.string().min(1),
  docId: z.string().min(1),
});
export type EmbeddingsJob = z.infer<typeof embeddingsJobSchema>;

export const reminderJobSchema = z.object({
  organizationId: z.string().min(1),
  appointmentId: z.string().min(1),
  offset: z.enum(['FIRST', 'SECOND']),
});
export type ReminderJob = z.infer<typeof reminderJobSchema>;
