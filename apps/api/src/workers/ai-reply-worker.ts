import { Worker } from 'bullmq';
import type { EmbeddingPort, LLMPort } from '@waos/ports';
import { aiReplyJobSchema, type AiReplyJob } from '@waos/shared';
import { embeddingPort } from '../adapters/embeddings/embedding-adapter.js';
import { llmPort } from '../adapters/llm/anthropic-adapter.js';
import { config } from '../lib/config.js';
import { requireRequestContext, runWithRequestContext } from '../lib/context.js';
import { logger } from '../lib/logger.js';
import { QUEUE_NAMES } from '../lib/queues.js';
import { redisConnectionOptions } from '../lib/redis.js';
import { aiReplyLogRepository } from '../repositories/ai-reply-log-repository.js';
import { conversationRepository } from '../repositories/conversation-repository.js';
import { knowledgeRepository } from '../repositories/knowledge-repository.js';
import { messageRepository } from '../repositories/message-repository.js';
import { organizationRepository } from '../repositories/organization-repository.js';
import {
  buildConversationMessages,
  buildSystemPrompt,
  completeWithRepair,
  decideAiAction,
} from '../services/ai-reply.js';
import { outboundService } from '../services/outbound-service.js';
import { emitToOrg } from '../sockets/gateway.js';

interface AiPorts {
  llm: LLMPort;
  embeddings: EmbeddingPort;
}

function orgSettings(settings: unknown): { aiConfidenceThreshold?: number; toneNotes?: string } {
  if (typeof settings !== 'object' || settings === null) {
    return {};
  }
  const record = settings as Record<string, unknown>;
  return {
    ...(typeof record.aiConfidenceThreshold === 'number'
      ? { aiConfidenceThreshold: record.aiConfidenceThreshold }
      : {}),
    ...(typeof record.toneNotes === 'string' && record.toneNotes.trim().length > 0
      ? { toneNotes: record.toneNotes }
      : {}),
  };
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
      if (question.trim().length === 0) {
        return;
      }
      const organization = await organizationRepository.findCurrent(
        requireRequestContext().organizationId,
      );
      if (!organization) {
        return;
      }
      const settings = orgSettings(organization.settings);
      const threshold = settings.aiConfidenceThreshold ?? config.AI_CONFIDENCE_THRESHOLD;

      const [queryEmbedding] = await ports.embeddings.embed([question]);
      const chunks = queryEmbedding ? await knowledgeRepository.searchChunks(queryEmbedding) : [];

      const system = buildSystemPrompt({
        businessName: organization.name,
        vertical: organization.vertical,
        defaultLanguage: organization.language,
        toneNotes: settings.toneNotes,
        chunks,
      });
      const messages = buildConversationMessages(inbound);
      if (messages.length === 0) {
        return;
      }

      const output = await completeWithRepair(ports.llm, system, messages);
      const decision = decideAiAction(output, threshold);
      const isBooking = output?.intent === 'booking';

      if (decision === 'REPLY' && output) {
        await outboundService.sendText({
          conversationId: conversation.id,
          body: output.reply,
          authorType: 'AI',
        });
        if (isBooking && conversation.status !== 'PENDING') {
          // Booking thin slice: the AI proposes, a human confirms the slot.
          await conversationRepository.updateStatus(conversation.id, 'PENDING');
        }
      } else {
        await conversationRepository.updateStatus(conversation.id, 'PENDING');
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
