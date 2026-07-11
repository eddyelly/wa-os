import { z } from 'zod';

// Feature modules a business can enable. Shared by organization.ts (update
// requests) and auth.ts (session payloads) to avoid a circular import
// between the two (organization.ts already imports supportedLanguageSchema
// from auth.ts).
export const businessModuleSchema = z.enum(['appointments', 'shop']);
export type BusinessModule = z.infer<typeof businessModuleSchema>;
