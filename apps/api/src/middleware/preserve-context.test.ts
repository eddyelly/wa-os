import express, { type Express, type RequestHandler } from 'express';
import multer from 'multer';
import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { getRequestContext } from '../lib/context.js';
import { signAccessToken } from '../lib/jwt.js';
import { requireAuth } from './auth.js';
import { preserveRequestContext } from './preserve-context.js';

const upload = multer({ storage: multer.memoryStorage() });

const probeSchema = z.object({
  organizationId: z.string().nullable(),
  fileReceived: z.boolean().optional(),
  failed: z.boolean().optional(),
});

function probe(body: unknown): z.infer<typeof probeSchema> {
  return probeSchema.parse(body);
}

const token = signAccessToken({
  userId: 'user_1',
  organizationId: 'org_1',
  role: 'OWNER',
});

/**
 * Mirrors a real upload route: requireAuth establishes the tenant context,
 * then a multer handler parses the body before the controller runs.
 */
function buildApp(uploadHandler: RequestHandler): Express {
  const app = express();
  app.post('/upload', requireAuth, uploadHandler, (req, res) => {
    res.json({
      organizationId: getRequestContext()?.organizationId ?? null,
      fileReceived: Boolean(req.file),
    });
  });
  return app;
}

describe('preserveRequestContext', () => {
  it('keeps the tenant context across multer so tenant-scoped queries still work', async () => {
    const response = await request(buildApp(preserveRequestContext(upload.single('file'))))
      .post('/upload')
      .set('Authorization', `Bearer ${token}`)
      .attach('file', Buffer.from('hello'), { filename: 'a.png', contentType: 'image/png' });

    expect(response.status).toBe(200);
    const body = probe(response.body as unknown);
    expect(body.fileReceived).toBe(true);
    expect(body.organizationId).toBe('org_1');
  });

  it('documents the bug it exists to fix: bare multer drops the tenant context', async () => {
    const response = await request(buildApp(upload.single('file')))
      .post('/upload')
      .set('Authorization', `Bearer ${token}`)
      .attach('file', Buffer.from('hello'), { filename: 'a.png', contentType: 'image/png' });

    expect(response.status).toBe(200);
    const body = probe(response.body as unknown);
    expect(body.fileReceived).toBe(true);
    // Multer resumes the chain from a busboy stream event, outside the
    // AsyncLocalStorage scope requireAuth opened, so the context is gone.
    expect(body.organizationId).toBeNull();
  });

  it('still restores the context when the wrapped handler fails', async () => {
    const rejecting = multer({
      storage: multer.memoryStorage(),
      limits: { fileSize: 2 },
    });
    const app = express();
    app.post(
      '/upload',
      requireAuth,
      preserveRequestContext(rejecting.single('file')),
      (_req, res) => {
        res.json({ reached: true });
      },
    );
    // The error handler must also see the context, since it reports per tenant.
    app.use(((error: unknown, _req, res, _next) => {
      res.status(400).json({
        organizationId: getRequestContext()?.organizationId ?? null,
        failed: error instanceof Error,
      });
    }) as express.ErrorRequestHandler);

    const response = await request(app)
      .post('/upload')
      .set('Authorization', `Bearer ${token}`)
      .attach('file', Buffer.from('too large'), { filename: 'a.png', contentType: 'image/png' });

    expect(response.status).toBe(400);
    const body = probe(response.body as unknown);
    expect(body.failed).toBe(true);
    expect(body.organizationId).toBe('org_1');
  });

  it('passes through untouched when there is no context to preserve', async () => {
    const app = express();
    app.post('/upload', preserveRequestContext(upload.single('file')), (req, res) => {
      res.json({
        organizationId: getRequestContext()?.organizationId ?? null,
        fileReceived: Boolean(req.file),
      });
    });

    const response = await request(app)
      .post('/upload')
      .attach('file', Buffer.from('hello'), { filename: 'a.png', contentType: 'image/png' });

    expect(response.status).toBe(200);
    const body = probe(response.body as unknown);
    expect(body.fileReceived).toBe(true);
    expect(body.organizationId).toBeNull();
  });
});
