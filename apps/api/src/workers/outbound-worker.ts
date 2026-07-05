import { DelayedError, Worker, type Job } from 'bullmq';
import { outboundSendJobSchema, type OutboundSendJob } from '@waos/shared';
import { messagingPortFor } from '../adapters/messaging.js';
import { config } from '../lib/config.js';
import { runWithRequestContext } from '../lib/context.js';
import { logger } from '../lib/logger.js';
import { getMediaUrl } from '../lib/minio.js';
import { QUEUE_NAMES } from '../lib/queues.js';
import { redisConnectionOptions, redis } from '../lib/redis.js';
import { policyEngine } from '../policy/policy-engine.js';
import { warmupCap } from '../policy/warmup.js';
import { messageRepository } from '../repositories/message-repository.js';
import { emitToOrg } from '../sockets/gateway.js';
import { computeSendDelayMs, nextUtcMidnightMs, utcDayStamp } from './pacing.js';

const MAX_INLINE_WAIT_MS = 25_000;

const lastSendKey = (channelId: string): string => `wa:lastsend:${channelId}`;
const dayCountKey = (channelId: string, nowMs: number): string =>
  `wa:sendcount:${channelId}:${utcDayStamp(nowMs)}`;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function process(job: Job<OutboundSendJob>, token: string | undefined): Promise<void> {
  const payload = outboundSendJobSchema.parse(job.data);

  await runWithRequestContext(
    { organizationId: payload.organizationId, userId: 'worker:outbound', role: 'OWNER' },
    async () => {
      const message = await messageRepository.findByIdWithThread(payload.messageId);
      if (!message || message.status !== 'QUEUED') {
        return; // already sent, blocked, or gone: idempotent re-run
      }
      const { conversation } = message;
      const channel = conversation.channel;
      const port = messagingPortFor(channel.provider);

      // Re-check policy at send time; opt-in or channel state may have changed.
      const decision = policyEngine.check(payload.action, channel.provider, {
        contactOptedIn: conversation.contact.optedInAt !== null,
      });
      if (decision.outcome === 'block') {
        await messageRepository.updateStatus(message.id, 'BLOCKED', {
          blockedReason: decision.reason,
        });
        emitToOrg(payload.organizationId, 'message.updated', {
          messageId: message.id,
          conversationId: conversation.id,
          status: 'BLOCKED',
          blockedReason: decision.reason,
        });
        return;
      }

      if (decision.rateLimited) {
        const nowMs = Date.now();

        // Day-indexed warm-up cap: postpone to tomorrow when exhausted.
        const countRaw = await redis.get(dayCountKey(channel.id, nowMs));
        const sentToday = countRaw ? Number(countRaw) : 0;
        const cap = warmupCap(channel.warmupStartedAt, new Date(nowMs), config.WARMUP_DAILY_CAPS);
        if (sentToday >= cap) {
          logger.warn(
            { channelId: channel.id, messageId: message.id, cap },
            'warm-up cap reached, postponing send to tomorrow',
          );
          await job.moveToDelayed(nextUtcMidnightMs(nowMs), token);
          throw new DelayedError();
        }

        // Per-channel rate gap + human jitter.
        const lastRaw = await redis.get(lastSendKey(channel.id));
        const delayMs = computeSendDelayMs({
          lastSentAtMs: lastRaw ? Number(lastRaw) : null,
          nowMs,
          ratePerMinute: config.SEND_RATE_PER_MINUTE,
          random: Math.random(),
        });
        if (delayMs > MAX_INLINE_WAIT_MS) {
          await job.moveToDelayed(nowMs + delayMs, token);
          throw new DelayedError();
        }
        await sleep(delayMs);
      }

      const to = conversation.contact.phone;
      let providerMessageId: string;
      if (message.mediaKey) {
        const url = await getMediaUrl(message.mediaKey);
        const result = await port.sendMedia(
          channel.id,
          to,
          { kind: 'url', url, mimeType: 'application/octet-stream' },
          message.body ?? undefined,
        );
        providerMessageId = result.providerMessageId;
      } else {
        const result = await port.sendText(channel.id, to, message.body ?? '');
        providerMessageId = result.providerMessageId;
      }

      const sentAtMs = Date.now();
      await redis.set(lastSendKey(channel.id), String(sentAtMs), 'PX', 60 * 60 * 1000);
      await redis.incr(dayCountKey(channel.id, sentAtMs));
      await redis.expire(dayCountKey(channel.id, sentAtMs), 48 * 60 * 60);

      await messageRepository.updateStatus(message.id, 'SENT', { providerMessageId });
      emitToOrg(payload.organizationId, 'message.updated', {
        messageId: message.id,
        conversationId: conversation.id,
        status: 'SENT',
      });
    },
  );
}

export function startOutboundWorker(): Worker<OutboundSendJob> {
  const worker = new Worker<OutboundSendJob>(
    QUEUE_NAMES.outbound,
    async (job, token) => {
      try {
        await process(job, token);
      } catch (error) {
        if (error instanceof DelayedError) {
          throw error;
        }
        const attempts = typeof job.opts.attempts === 'number' ? job.opts.attempts : 3;
        const isFinalAttempt = job.attemptsMade + 1 >= attempts;
        logger.error(
          { err: error, jobId: job.id, messageId: job.data.messageId, channelId: job.data.channelId },
          'outbound send failed',
        );
        if (isFinalAttempt) {
          await runWithRequestContext(
            { organizationId: job.data.organizationId, userId: 'worker:outbound', role: 'OWNER' },
            async () => {
              await messageRepository.updateStatus(job.data.messageId, 'FAILED');
            },
          ).catch(() => undefined);
          emitToOrg(job.data.organizationId, 'message.updated', {
            messageId: job.data.messageId,
            status: 'FAILED',
          });
        }
        throw error;
      }
    },
    {
      connection: redisConnectionOptions(),
      // Sends are serialized so the per-channel pacing holds globally.
      concurrency: 1,
    },
  );
  worker.on('error', (error) => {
    logger.error({ err: error }, 'outbound worker error');
  });
  return worker;
}
