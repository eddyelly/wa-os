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

export const updateShopSettingsRequestSchema = z.object({
  paymentInstructions: z.string().trim().max(500).optional(),
  ownerAlertPhone: z
    .string()
    .regex(/^\+[1-9]\d{6,14}$/, 'must be E.164, e.g. +2557...')
    .nullable()
    .optional(),
  ownerAlertsEnabled: z.boolean().optional(),
});
export type UpdateShopSettingsRequest = z.infer<typeof updateShopSettingsRequestSchema>;
