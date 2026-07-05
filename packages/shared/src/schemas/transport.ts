import { z } from 'zod';

// Zod mirrors of the packages/ports transport types. Adapters normalize
// provider payloads into these shapes before anything touches the core.

export const sessionStatusSchema = z.enum([
  'PENDING',
  'QR_READY',
  'CONNECTED',
  'DISCONNECTED',
  'BANNED',
]);
export type SessionStatusValue = z.infer<typeof sessionStatusSchema>;

export const sendResultSchema = z.object({
  providerMessageId: z.string().min(1),
});

export const connectResultSchema = z.object({
  status: sessionStatusSchema,
  qr: z
    .object({
      code: z.string(),
      base64: z.string().optional(),
    })
    .optional(),
});

export const incomingMessageTypeSchema = z.enum([
  'TEXT',
  'IMAGE',
  'AUDIO',
  'DOCUMENT',
  'LOCATION',
  'OTHER',
]);

export const incomingMessageSchema = z.object({
  channelId: z.string().min(1),
  providerMessageId: z.string().min(1),
  from: z.string().min(1),
  contactName: z.string().optional(),
  type: incomingMessageTypeSchema,
  text: z.string().optional(),
  media: z
    .object({
      providerRef: z.string().min(1),
      mimeType: z.string().min(1),
      fileName: z.string().optional(),
    })
    .optional(),
  sentAt: z.coerce.date(),
});
export type IncomingMessageValue = z.infer<typeof incomingMessageSchema>;
