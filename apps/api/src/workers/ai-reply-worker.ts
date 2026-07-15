import { Worker } from 'bullmq';
import type { EmbeddingPort, LLMPort } from '@waos/ports';
import { aiReplyJobSchema, type AiReplyJob } from '@waos/shared';
import { embeddingPort } from '../adapters/embeddings/embedding-adapter.js';
import { llmPort } from '../adapters/llm/gemini-adapter.js';
import { config } from '../lib/config.js';
import { requireRequestContext, runWithRequestContext } from '../lib/context.js';
import { logger } from '../lib/logger.js';
import { getMediaObject } from '../lib/minio.js';
import { QUEUE_NAMES } from '../lib/queues.js';
import { redis, redisConnectionOptions } from '../lib/redis.js';
import { aiReplyLogRepository } from '../repositories/ai-reply-log-repository.js';
import { conversationRepository } from '../repositories/conversation-repository.js';
import { knowledgeRepository } from '../repositories/knowledge-repository.js';
import { messageRepository } from '../repositories/message-repository.js';
import { organizationRepository } from '../repositories/organization-repository.js';
import { productRepository } from '../repositories/product-repository.js';
import { runAgentLoop, type AgentTools } from '../services/ai-agent.js';
import { notificationService } from '../services/notification-service.js';
import {
  buildConversationMessages,
  buildSystemPrompt,
  decideAiAction,
  parseOrgAiSettings,
  parseOrgShopSettings,
  replyTargetForAi,
} from '../services/ai-reply.js';
import { outboundService } from '../services/outbound-service.js';
import { buildShopTools } from '../services/shop-tools.js';
import { emitToOrg } from '../sockets/gateway.js';
import { pickReplyMedia } from './outbound-media.js';

interface AiPorts {
  llm: LLMPort;
  embeddings: EmbeddingPort;
}

/** Guard key for the double-send lock: one send per inbound message, ever. */
export function aiReplyGuardKey(inboundMessageId: string): string {
  return `ai-replied:${inboundMessageId}`;
}

/** `redis.set(..., 'NX')` returns 'OK' only when it acquired the key. */
export function shouldSendAiReply(guardResult: string | null): boolean {
  return guardResult === 'OK';
}

/**
 * Builds the HANDOFF notification payload from the already-loaded
 * conversation, kept pure so the decision of what to send is unit-testable
 * without standing up the rest of the worker's dependencies.
 */
export function buildHandoffNotifyPayload(conversation: {
  id: string;
  contact: { name: string | null };
}): { conversationId: string; contactName: string | null } {
  return { conversationId: conversation.id, contactName: conversation.contact.name };
}

/**
 * Runs `send`, and on ANY failure releases the guard key that was acquired
 * before the send was attempted, then rethrows so BullMQ retries. Without
 * this, a send that throws after the NX guard is set would leave the key
 * held for its full 24h TTL and the customer would never get a reply on
 * retry (the retry would see the key held and skip silently). The guard
 * release itself is best effort: a failure to delete the key is logged and
 * swallowed so the original send error is what propagates to BullMQ.
 */
export async function sendWithGuardRelease(params: {
  send: () => Promise<void>;
  releaseKey: string;
  redisClient: { del(key: string): Promise<unknown> };
}): Promise<void> {
  try {
    await params.send();
  } catch (error) {
    try {
      await params.redisClient.del(params.releaseKey);
    } catch (releaseError) {
      logger.warn(
        { err: releaseError, guardKey: params.releaseKey },
        'ai reply guard: failed to release guard key after a failed send',
      );
    }
    throw error;
  }
}

export async function processAiReplyJob(
  payload: AiReplyJob,
  ports: AiPorts = { llm: llmPort, embeddings: embeddingPort },
): Promise<void> {
  await runWithRequestContext(
    { organizationId: payload.organizationId, userId: 'worker:ai', role: 'OWNER' },
    async () => {
      const startedAt = Date.now();
      const conversation = await conversationRepository.findById(payload.conversationId);
      if (!conversation || !conversation.aiEnabled || conversation.status === 'CLOSED') {
        return; // a human took over or the thread is gone
      }
      const inbound = await messageRepository.listByConversation(conversation.id, 200);
      const lastInbound = [...inbound].reverse().find((m) => m.id === payload.inboundMessageId);
      const question = lastInbound?.body ?? '';
      // A photo with no caption still triggers the agent (vision trigger):
      // only bail for an empty turn that carries no image either.
      const isImageTrigger = lastInbound?.type === 'IMAGE' && Boolean(lastInbound.mediaKey);
      if (question.trim().length === 0 && !isImageTrigger) {
        return;
      }
      const organizationId = requireRequestContext().organizationId;
      const organization = await organizationRepository.findCurrent(organizationId);
      if (!organization) {
        return;
      }
      const settings = parseOrgAiSettings(organization.settings);
      if (!settings.aiEnabled) {
        // The owner turned the AI off globally: leave the message for a
        // human, no reply and no PENDING flip.
        return;
      }
      const threshold = settings.aiConfidenceThreshold ?? config.AI_CONFIDENCE_THRESHOLD;

      // Nothing to embed for an image-only turn with no caption text.
      const [queryEmbedding] =
        question.trim().length > 0 ? await ports.embeddings.embed([question], 'query') : [];
      const chunks = queryEmbedding ? await knowledgeRepository.searchChunks(queryEmbedding) : [];

      const shopEnabled = organization.modules.includes('shop');
      const tools: AgentTools | null = shopEnabled
        ? buildShopTools({
            organizationId,
            conversationId: conversation.id,
            contactId: conversation.contactId,
            paymentInstructions: parseOrgShopSettings(organization.settings).paymentInstructions,
            embeddings: ports.embeddings,
          })
        : null;

      const system = buildSystemPrompt({
        businessName: organization.name,
        vertical: organization.vertical,
        defaultLanguage: organization.language,
        toneNotes: settings.toneNotes,
        chunks,
        shop: { enabled: shopEnabled },
      });

      let finalImage: { messageId: string; mimeType: string; data: string } | undefined;
      if (isImageTrigger && lastInbound.mediaKey) {
        const media = await getMediaObject(lastInbound.mediaKey);
        finalImage = {
          messageId: lastInbound.id,
          mimeType: media.mimeType,
          data: media.data.toString('base64'),
        };
      }
      const messages = buildConversationMessages(inbound, finalImage);
      if (messages.length === 0) {
        return;
      }

      const result = await runAgentLoop({ llm: ports.llm, system, messages, tools });
      const output = result.output;
      const decision = decideAiAction(output, threshold);
      const isBooking = output?.intent === 'booking';
      const replyToMessageId = replyTargetForAi(inbound, payload.inboundMessageId);

      if (decision === 'REPLY' && output) {
        // Double-send guard: a BullMQ retry after a successful send must
        // never re-send the same reply (CLAUDE.md ban-risk guardrails).
        const guard = await redis.set(
          aiReplyGuardKey(payload.inboundMessageId),
          '1',
          'EX',
          86400,
          'NX',
        );
        if (shouldSendAiReply(guard)) {
          // If the send throws after the guard key was acquired, release it
          // so a BullMQ retry can actually reach the customer instead of
          // silently skipping for the rest of the 24h TTL. The product photo
          // lookup lives inside this closure too, so a lookup failure gets
          // the same guard-release treatment as a send failure.
          await sendWithGuardRelease({
            send: async () => {
              let mediaKey: string | null = null;
              const [onlyProductId] = result.productIdsSeen;
              if (result.productIdsSeen.length === 1 && onlyProductId !== undefined) {
                const product = await productRepository.findById(onlyProductId);
                mediaKey = pickReplyMedia(result.productIdsSeen, {
                  [onlyProductId]: product?.images[0]?.mediaKey,
                });
              }
              if (mediaKey) {
                await outboundService.sendMedia({
                  conversationId: conversation.id,
                  mediaKey,
                  caption: output.reply,
                  authorType: 'AI',
                  replyToMessageId,
                });
              } else {
                await outboundService.sendText({
                  conversationId: conversation.id,
                  body: output.reply,
                  authorType: 'AI',
                  replyToMessageId,
                });
              }
            },
            releaseKey: aiReplyGuardKey(payload.inboundMessageId),
            redisClient: redis,
          });
        } else {
          logger.warn(
            { inboundMessageId: payload.inboundMessageId },
            'ai reply guard: skipping duplicate send',
          );
        }
        if (isBooking && conversation.status !== 'PENDING') {
          // Booking thin slice: the AI proposes, a human confirms the slot.
          await conversationRepository.updateStatus(conversation.id, 'PENDING');
        }
      } else {
        await conversationRepository.updateStatus(conversation.id, 'PENDING');
        try {
          await notificationService.notify('HANDOFF', buildHandoffNotifyPayload(conversation));
        } catch (error) {
          // Best-effort: the PENDING flip already committed. Log ids only
          // and continue so a down notification path never blocks the
          // handoff itself.
          logger.warn(
            { err: error, conversationId: conversation.id },
            'handoff notification failed',
          );
        }
      }

      emitToOrg(payload.organizationId, 'conversation.updated', {
        conversationId: conversation.id,
      });

      await aiReplyLogRepository.create({
        conversationId: conversation.id,
        retrievedChunkIds: chunks.map((chunk) => chunk.id),
        confidence: output?.confidence ?? 0,
        action: decision === 'REPLY' ? 'REPLIED' : 'HANDED_OFF',
        latencyMs: Date.now() - startedAt,
        toolsUsed: result.toolsUsed,
      });
      logger.info(
        {
          conversationId: conversation.id,
          action: decision,
          latencyMs: Date.now() - startedAt,
          chunks: chunks.length,
        },
        'ai reply decision',
      );
    },
  );
}

export function startAiReplyWorker(): Worker<AiReplyJob> {
  const worker = new Worker<AiReplyJob>(
    QUEUE_NAMES.aiReply,
    async (job) => {
      await processAiReplyJob(aiReplyJobSchema.parse(job.data));
    },
    // LLM-bound: keep concurrency small (CLAUDE.md section 9).
    { connection: redisConnectionOptions(), concurrency: 2 },
  );
  worker.on('error', (error) => {
    logger.error({ err: error }, 'ai reply worker error');
  });
  worker.on('failed', (job, error) => {
    logger.error(
      { err: error, jobId: job?.id, conversationId: job?.data.conversationId },
      'ai reply job failed',
    );
  });
  return worker;
}
