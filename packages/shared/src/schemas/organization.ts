import { z } from 'zod';
import { supportedLanguageSchema } from './auth.js';

export const updateOrganizationRequestSchema = z.object({
  name: z.string().trim().min(2).max(120).optional(),
  vertical: z.string().trim().min(2).max(60).optional(),
  language: supportedLanguageSchema.optional(),
  timezone: z.string().trim().min(1).max(60).optional(),
});
export type UpdateOrganizationRequest = z.infer<typeof updateOrganizationRequestSchema>;
