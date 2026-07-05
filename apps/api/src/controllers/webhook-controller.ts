import { timingSafeEqual } from 'node:crypto';
import type { Request, Response } from 'express';
import { routeParam } from '../lib/http.js';
import { config } from '../lib/config.js';
import { UnauthorizedError } from '../lib/errors.js';
import { inboundService } from '../services/inbound-service.js';

function secretMatches(candidate: string): boolean {
  const expected = Buffer.from(config.EVOLUTION_WEBHOOK_SECRET);
  const received = Buffer.from(candidate);
  return expected.length === received.length && timingSafeEqual(expected, received);
}

export const evolutionWebhook = async (req: Request, res: Response): Promise<void> => {
  if (!secretMatches(routeParam(req.params.secret))) {
    throw new UnauthorizedError('Invalid webhook credentials.');
  }
  await inboundService.processEvolutionWebhook(req.body);
  res.json({ received: true });
};
