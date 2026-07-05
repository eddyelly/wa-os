import { randomUUID } from 'node:crypto';
import { pinoHttp } from 'pino-http';
import { logger } from '../lib/logger.js';

// Logs method, path, status, and timing. Bodies are never logged
// (CLAUDE.md standard 8).
export const requestLogger = pinoHttp({
  logger,
  genReqId: (req) => (typeof req.id === 'string' ? req.id : randomUUID()),
  autoLogging: {
    ignore: (req) => req.url === '/health',
  },
  serializers: {
    req: (req: { id: unknown; method: string; url: string }) => ({
      id: req.id,
      method: req.method,
      url: req.url,
    }),
    res: (res: { statusCode: number }) => ({ statusCode: res.statusCode }),
  },
});
