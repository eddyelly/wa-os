import { z } from 'zod';
import { supportedLanguageSchema } from './auth.js';
import { businessModuleSchema } from './modules.js';

export const updateOrganizationRequestSchema = z.object({
  name: z.string().trim().min(2).max(120).optional(),
  vertical: z.string().trim().min(2).max(60).optional(),
  language: supportedLanguageSchema.optional(),
  timezone: z.string().trim().min(1).max(60).optional(),
  modules: z
    .array(businessModuleSchema)
    .min(1)
    .transform((modules) => [...new Set(modules)])
    .optional(),
});
export type UpdateOrganizationRequest = z.infer<typeof updateOrganizationRequestSchema>;
