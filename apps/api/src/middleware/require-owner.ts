import type { NextFunction, Request, Response } from 'express';
import { requireRequestContext } from '../lib/context.js';
import { ForbiddenError } from '../lib/errors.js';

export function requireOwner(_req: Request, _res: Response, next: NextFunction): void {
  const context = requireRequestContext();
  if (context.role !== 'OWNER') {
    next(new ForbiddenError('Only the business owner can do that.'));
    return;
  }
  next();
}
