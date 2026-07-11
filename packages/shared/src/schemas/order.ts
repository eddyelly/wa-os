import { z } from 'zod';

export const orderStatusSchema = z.enum([
  'PENDING_CONFIRMATION',
  'CONFIRMED',
  'PAID',
  'FULFILLED',
  'CANCELLED',
]);
export type OrderStatus = z.infer<typeof orderStatusSchema>;

export const orderItemSchema = z.object({
  id: z.string(),
  productId: z.string().nullable(),
  productName: z.string(),
  quantity: z.number().int().positive(),
  listPrice: z.number().int(),
  agreedPrice: z.number().int(),
});

export const orderSchema = z.object({
  id: z.string(),
  status: orderStatusSchema,
  totalAgreed: z.number().int(),
  note: z.string().nullable(),
  conversationId: z.string().nullable(),
  contact: z.object({
    id: z.string(),
    name: z.string().nullable(),
    phone: z.string(),
  }),
  items: z.array(orderItemSchema),
  createdAt: z.string(),
});
export type OrderDto = z.infer<typeof orderSchema>;

export const setOrderStatusRequestSchema = z.object({ status: orderStatusSchema });
