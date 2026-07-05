import { z } from 'zod';

// Evolution API payload shapes, verified against the v2.3.7 source
// (src/api/routes and src/api/dto). These schemas exist ONLY inside the
// adapter boundary; nothing provider-shaped leaks past it. All parsing is
// tolerant (.passthrough / optional) because the provider adds fields freely.

export const qrPayloadSchema = z
  .object({
    pairingCode: z.string().nullable().optional(),
    code: z.string().optional(),
    base64: z.string().optional(),
    count: z.number().optional(),
  })
  .passthrough();

export const connectionStateResponseSchema = z
  .object({
    instance: z
      .object({
        instanceName: z.string().optional(),
        state: z.string(),
      })
      .passthrough(),
  })
  .passthrough();

export const sendMessageResponseSchema = z
  .object({
    key: z
      .object({
        id: z.string(),
        remoteJid: z.string().optional(),
        fromMe: z.boolean().optional(),
      })
      .passthrough(),
  })
  .passthrough();

export const mediaBase64ResponseSchema = z
  .object({
    base64: z.string(),
    mimetype: z.string().optional(),
    fileName: z.string().optional(),
  })
  .passthrough();

// Webhook envelope: { event, instance, data, destination, date_time, sender,
// server_url, apikey } per webhook.controller.ts.
export const webhookEnvelopeSchema = z
  .object({
    event: z.string(),
    instance: z.string(),
    data: z.unknown(),
  })
  .passthrough();
export type WebhookEnvelope = z.infer<typeof webhookEnvelopeSchema>;

const messageContentSchema = z
  .object({
    conversation: z.string().optional(),
    extendedTextMessage: z.object({ text: z.string().optional() }).passthrough().optional(),
    imageMessage: z
      .object({ caption: z.string().optional(), mimetype: z.string().optional() })
      .passthrough()
      .optional(),
    audioMessage: z.object({ mimetype: z.string().optional() }).passthrough().optional(),
    documentMessage: z
      .object({
        fileName: z.string().optional(),
        mimetype: z.string().optional(),
        caption: z.string().optional(),
      })
      .passthrough()
      .optional(),
    videoMessage: z
      .object({ caption: z.string().optional(), mimetype: z.string().optional() })
      .passthrough()
      .optional(),
    locationMessage: z
      .object({
        degreesLatitude: z.number().optional(),
        degreesLongitude: z.number().optional(),
      })
      .passthrough()
      .optional(),
  })
  .passthrough();

export const messagesUpsertDataSchema = z
  .object({
    key: z
      .object({
        remoteJid: z.string(),
        fromMe: z.boolean().optional(),
        id: z.string(),
      })
      .passthrough(),
    pushName: z.string().optional(),
    message: messageContentSchema.nullable().optional(),
    messageType: z.string().optional(),
    messageTimestamp: z.union([z.number(), z.string()]).optional(),
  })
  .passthrough();

export const messagesUpdateDataSchema = z
  .object({
    keyId: z.string().optional(),
    key: z.object({ id: z.string().optional() }).passthrough().optional(),
    status: z.string().optional(),
    fromMe: z.boolean().optional(),
  })
  .passthrough();

export const connectionUpdateDataSchema = z
  .object({
    state: z.string().optional(),
    statusReason: z.number().optional(),
  })
  .passthrough();

export const qrcodeUpdatedDataSchema = z
  .object({
    qrcode: qrPayloadSchema.optional(),
  })
  .passthrough();
