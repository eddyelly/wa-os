import type { NextFunction, Request, Response } from 'express';
import { runWithRequestContext } from '../lib/context.js';
import { UnauthorizedError } from '../lib/errors.js';
import { verifyToken } from '../lib/jwt.js';

/**
 * Verifies the Bearer access token and runs the rest of the request inside
 * the tenant request context, which the Prisma tenant extension reads.
 */
export function requireAuth(req: Request, _res: Response, next: NextFunction): void {
  const header = req.headers.authorization;
  if (!header?.startsWith('Bearer ')) {
    next(new UnauthorizedError());
    return;
  }
  try {
    const subject = verifyToken(header.slice('Bearer '.length), 'access');
    runWithRequestContext(
      { organizationId: subject.organizationId, userId: subject.userId, role: subject.role },
      () => {
        next();
      },
    );
  } catch (error) {
    next(error);
  }
}
