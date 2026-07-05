import { z } from 'zod';

/**
 * Every API error response has this shape; the dashboard renders
 * `error.message` and can branch on `error.code`.
 */
export const apiErrorSchema = z.object({
  error: z.object({
    code: z.string(),
    message: z.string(),
    details: z.unknown().optional(),
  }),
});
export type ApiError = z.infer<typeof apiErrorSchema>;
