import { describe, expect, it } from 'vitest';
import { UnauthorizedError } from './errors.js';
import { signAccessToken, signRefreshToken, verifyToken } from './jwt.js';

const subject = { userId: 'user-1', organizationId: 'org-1', role: 'OWNER' as const };

describe('jwt', () => {
  it('round-trips an access token', () => {
    const token = signAccessToken(subject);
    expect(verifyToken(token, 'access')).toEqual(subject);
  });

  it('round-trips a refresh token', () => {
    const token = signRefreshToken(subject);
    expect(verifyToken(token, 'refresh')).toEqual(subject);
  });

  it('rejects a refresh token presented as an access token', () => {
    const token = signRefreshToken(subject);
    expect(() => verifyToken(token, 'access')).toThrow(UnauthorizedError);
  });

  it('rejects an access token presented as a refresh token', () => {
    const token = signAccessToken(subject);
    expect(() => verifyToken(token, 'refresh')).toThrow(UnauthorizedError);
  });

  it('rejects garbage', () => {
    expect(() => verifyToken('not-a-token', 'access')).toThrow(UnauthorizedError);
  });
});
