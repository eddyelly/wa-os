import jwt from 'jsonwebtoken';
import { z } from 'zod';
import { userRoleSchema, type UserRole } from '@waos/shared';
import { config } from './config.js';
import { UnauthorizedError } from './errors.js';

const ACCESS_TOKEN_TTL_SECONDS = 15 * 60;
const REFRESH_TOKEN_TTL_SECONDS = 30 * 24 * 60 * 60;

export type TokenType = 'access' | 'refresh';

const tokenPayloadSchema = z.object({
  sub: z.string().min(1),
  org: z.string().min(1),
  role: userRoleSchema,
  tokenType: z.enum(['access', 'refresh']),
});

export interface TokenSubject {
  userId: string;
  organizationId: string;
  role: UserRole;
}

function secretFor(tokenType: TokenType): string {
  return tokenType === 'access' ? config.JWT_ACCESS_SECRET : config.JWT_REFRESH_SECRET;
}

function sign(subject: TokenSubject, tokenType: TokenType, expiresInSeconds: number): string {
  return jwt.sign(
    { sub: subject.userId, org: subject.organizationId, role: subject.role, tokenType },
    secretFor(tokenType),
    { expiresIn: expiresInSeconds },
  );
}

export function signAccessToken(subject: TokenSubject): string {
  return sign(subject, 'access', ACCESS_TOKEN_TTL_SECONDS);
}

export function signRefreshToken(subject: TokenSubject): string {
  return sign(subject, 'refresh', REFRESH_TOKEN_TTL_SECONDS);
}

export function verifyToken(token: string, expectedType: TokenType): TokenSubject {
  let decoded: unknown;
  try {
    decoded = jwt.verify(token, secretFor(expectedType));
  } catch {
    throw new UnauthorizedError('Your session is invalid or has expired. Log in again.');
  }
  const parsed = tokenPayloadSchema.safeParse(decoded);
  if (!parsed.success || parsed.data.tokenType !== expectedType) {
    throw new UnauthorizedError('Your session is invalid or has expired. Log in again.');
  }
  return {
    userId: parsed.data.sub,
    organizationId: parsed.data.org,
    role: parsed.data.role,
  };
}
