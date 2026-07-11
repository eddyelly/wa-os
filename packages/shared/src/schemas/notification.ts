import { z } from 'zod';

export const notificationTypeSchema = z.enum(['NEW_ORDER', 'LOW_STOCK', 'HANDOFF']);

export const notificationSchema = z.object({
  id: z.string(),
  type: notificationTypeSchema,
  payload: z.record(z.unknown()),
  readAt: z.string().nullable(),
  createdAt: z.string(),
});
export type NotificationDto = z.infer<typeof notificationSchema>;
