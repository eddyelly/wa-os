import type { NextFunction, Request, RequestHandler, Response } from 'express';
import { getRequestContext, runWithRequestContext } from '../lib/context.js';

/**
 * Keeps the tenant request context alive across a body-parsing handler.
 *
 * requireAuth opens an AsyncLocalStorage scope around next(), but multer
 * resumes the middleware chain from a busboy stream event whose async
 * resource was created when the request arrived, before that scope existed.
 * The store does not propagate there, so without this wrapper every upload
 * route reaches its controller with no tenant context and the Prisma tenant
 * extension rejects the query.
 *
 * The context is captured while it is still active (before the handler runs)
 * and restored when the handler calls back, on the success and error paths
 * alike.
 */
export function preserveRequestContext(handler: RequestHandler): RequestHandler {
  return (req: Request, res: Response, next: NextFunction): void => {
    const context = getRequestContext();
    if (!context) {
      handler(req, res, next);
      return;
    }
    const restore: NextFunction = (error?: unknown) => {
      runWithRequestContext(context, () => {
        next(error);
      });
    };
    handler(req, res, restore);
  };
}
