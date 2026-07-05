import { z } from 'zod';
import { sessionStatusSchema } from './transport.js';

export const channelProviderSchema = z.enum(['evolution', 'cloud_api']);

export const channelSchema = z.object({
  id: z.string(),
  provider: channelProviderSchema,
  status: sessionStatusSchema,
  phoneNumber: z.string().nullable().optional(),
  warmupStartedAt: z.coerce.date().nullable(),
  createdAt: z.coerce.date(),
});
export type ChannelDto = z.infer<typeof channelSchema>;

export const connectChannelResponseSchema = z.object({
  channel: channelSchema,
  qr: z
    .object({
      code: z.string(),
      base64: z.string().optional(),
    })
    .optional(),
});
export type ConnectChannelResponse = z.infer<typeof connectChannelResponseSchema>;
