import type { NextFunction, Request, Response } from 'express';
import { MulterError } from 'multer';
import { ZodError } from 'zod';
import { AppError, NotFoundError } from '../lib/errors.js';
import { logger } from '../lib/logger.js';

export function notFoundHandler(req: Request, _res: Response, next: NextFunction): void {
  next(new NotFoundError(`No route matches ${req.method} ${req.path}.`));
}

export function errorHandler(
  error: unknown,
  req: Request,
  res: Response,
  // Express identifies error middleware by arity, so the 4th param stays.
  _next: NextFunction,
): void {
  if (error instanceof ZodError) {
    res.status(400).json({
      error: {
        code: 'VALIDATION_ERROR',
        message: 'Some fields are missing or invalid. Fix them and try again.',
        details: error.flatten().fieldErrors,
      },
    });
    return;
  }

  if (error instanceof MulterError) {
    res.status(400).json({
      error: {
        code: 'UPLOAD_INVALID',
        message: error.message,
      },
    });
    return;
  }

  if (error instanceof AppError) {
    if (error.statusCode >= 500) {
      logger.error({ err: error, requestId: req.id }, 'request failed');
    }
    res.status(error.statusCode).json({
      error: {
        code: error.code,
        message: error.message,
        ...(error.details !== undefined ? { details: error.details } : {}),
      },
    });
    return;
  }

  logger.error({ err: error, requestId: req.id }, 'unhandled error');
  res.status(500).json({
    error: {
      code: 'INTERNAL_ERROR',
      message: 'Something failed on our side. Try again in a moment.',
    },
  });
}
