import type { NextFunction, Request, Response } from 'express';
import { MulterError } from 'multer';
import { describe, expect, it, vi } from 'vitest';
import { errorHandler } from './error-handler.js';

function buildReq(): Request {
  return {} as unknown as Request;
}

// `status` and `json` are typed as plain mock properties (not the
// interface's bound methods) so asserting on them below never trips
// @typescript-eslint/unbound-method, mirroring the buildRes pattern in
// organization-controller.test.ts and settings-controller.test.ts.
function buildRes(): Response & { status: ReturnType<typeof vi.fn>; json: ReturnType<typeof vi.fn> } {
  const res = { json: vi.fn() } as unknown as Response & {
    status: ReturnType<typeof vi.fn>;
    json: ReturnType<typeof vi.fn>;
  };
  res.status = vi.fn().mockReturnValue(res);
  return res;
}

function buildNext(): NextFunction {
  return vi.fn();
}

describe('errorHandler', () => {
  it('maps a MulterError to 400 UPLOAD_INVALID carrying the multer message', () => {
    const res = buildRes();
    const error = new MulterError('LIMIT_FILE_SIZE');

    errorHandler(error, buildReq(), res, buildNext());

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith({
      error: { code: 'UPLOAD_INVALID', message: error.message },
    });
  });

  it('still maps a plain Error to 500 INTERNAL_ERROR', () => {
    const res = buildRes();

    errorHandler(new Error('boom'), buildReq(), res, buildNext());

    expect(res.status).toHaveBeenCalledWith(500);
    expect(res.json).toHaveBeenCalledWith({
      error: {
        code: 'INTERNAL_ERROR',
        message: 'Something failed on our side. Try again in a moment.',
      },
    });
  });
});
