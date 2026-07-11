import { z } from 'zod';
import { businessModuleSchema } from './modules.js';

export const supportedLanguageSchema = z.enum(['sw', 'en']);
export type SupportedLanguage = z.infer<typeof supportedLanguageSchema>;

const emailSchema = z.string().trim().toLowerCase().email().max(254);
const passwordSchema = z.string().min(8).max(128);

/**
 * Signup IS the "save your business" moment: one request creates the
 * Organization and its OWNER User in a single transaction.
 */
export const signupRequestSchema = z.object({
  businessName: z.string().trim().min(2).max(120),
  vertical: z.string().trim().min(2).max(60).default('local-services'),
  language: supportedLanguageSchema.default('sw'),
  timezone: z.string().trim().min(1).max(60).default('Africa/Dar_es_Salaam'),
  name: z.string().trim().min(2).max(120),
  email: emailSchema,
  password: passwordSchema,
});
export type SignupRequest = z.infer<typeof signupRequestSchema>;

export const loginRequestSchema = z.object({
  email: emailSchema,
  password: passwordSchema,
});
export type LoginRequest = z.infer<typeof loginRequestSchema>;

export const refreshRequestSchema = z.object({
  refreshToken: z.string().min(1),
});
export type RefreshRequest = z.infer<typeof refreshRequestSchema>;

export const userRoleSchema = z.enum(['OWNER', 'STAFF']);
export type UserRole = z.infer<typeof userRoleSchema>;

export const authUserSchema = z.object({
  id: z.string(),
  organizationId: z.string(),
  email: z.string(),
  name: z.string(),
  role: userRoleSchema,
});
export type AuthUser = z.infer<typeof authUserSchema>;

export const authOrganizationSchema = z.object({
  id: z.string(),
  name: z.string(),
  vertical: z.string(),
  language: z.string(),
  timezone: z.string(),
  modules: z.array(businessModuleSchema),
});
export type AuthOrganization = z.infer<typeof authOrganizationSchema>;

export const tokenPairSchema = z.object({
  accessToken: z.string(),
  refreshToken: z.string(),
});
export type TokenPair = z.infer<typeof tokenPairSchema>;

export const authResponseSchema = z.object({
  user: authUserSchema,
  organization: authOrganizationSchema,
  tokens: tokenPairSchema,
});
export type AuthResponse = z.infer<typeof authResponseSchema>;
