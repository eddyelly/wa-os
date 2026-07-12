import { z } from 'zod';

export const contactSchema = z.object({
  id: z.string(),
  phone: z.string(),
  name: z.string().nullable(),
  language: z.string().nullable(),
  tags: z.array(z.string()),
  optedInAt: z.string().nullable(),
  customFields: z.record(z.unknown()).nullable(),
});
export type ContactDto = z.infer<typeof contactSchema>;
