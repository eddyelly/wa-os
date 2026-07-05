import { z } from 'zod';

export const policyActionSchema = z.enum([
  'REPLY_ACTIVE_CONVERSATION',
  'MEDIA_ACTIVE_CONVERSATION',
  'REMINDER_OPTED_IN',
  'BROADCAST',
  'MESSAGE_NON_CONTACT',
]);
export type PolicyAction = z.infer<typeof policyActionSchema>;

export const policyBlockReasonSchema = z.enum([
  'COMING_SOON',
  'OPT_IN_REQUIRED',
  'UNSUPPORTED_PROVIDER',
]);
export type PolicyBlockReason = z.infer<typeof policyBlockReasonSchema>;

/**
 * A blocked action returns a typed decision, never a thrown string. The UI
 * renders the reason in plain language.
 */
export const policyDecisionSchema = z.discriminatedUnion('outcome', [
  z.object({ outcome: z.literal('allow'), rateLimited: z.boolean().default(false) }),
  z.object({ outcome: z.literal('block'), reason: policyBlockReasonSchema }),
]);
export type PolicyDecision = z.infer<typeof policyDecisionSchema>;
