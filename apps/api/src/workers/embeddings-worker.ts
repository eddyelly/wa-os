import { Worker } from 'bullmq';
import type { EmbeddingPort } from '@waos/ports';
import { embeddingsJobSchema, type EmbeddingsJob } from '@waos/shared';
import { embeddingPort } from '../adapters/embeddings/embedding-adapter.js';
import { runWithRequestContext } from '../lib/context.js';
import { logger } from '../lib/logger.js';
import { QUEUE_NAMES } from '../lib/queues.js';
import { redisConnectionOptions } from '../lib/redis.js';
import { knowledgeRepository } from '../repositories/knowledge-repository.js';
import { chunkContent } from '../services/chunking.js';

const EMBED_BATCH_SIZE = 32;

export async function processEmbeddingsJob(
  payload: EmbeddingsJob,
  embeddings: EmbeddingPort = embeddingPort,
): Promise<void> {
  await runWithRequestContext(
    { organizationId: payload.organizationId, userId: 'worker:embeddings', role: 'OWNER' },
    async () => {
      const doc = await knowledgeRepository.findDocById(payload.docId);
      if (!doc) {
        return; // deleted before we got here
      }
      const chunks = chunkContent(doc.content);
      // Re-embedding replaces previous chunks; the job is idempotent.
      await knowledgeRepository.deleteChunksForDoc(doc.id);
      for (let start = 0; start < chunks.length; start += EMBED_BATCH_SIZE) {
        const batch = chunks.slice(start, start + EMBED_BATCH_SIZE);
        const vectors = await embeddings.embed(batch);
        for (let i = 0; i < batch.length; i += 1) {
          await knowledgeRepository.insertChunk({
            organizationId: payload.organizationId,
            docId: doc.id,
            index: start + i,
            content: batch[i] ?? '',
            embedding: vectors[i] ?? null,
          });
        }
      }
      logger.info({ docId: doc.id, chunks: chunks.length }, 'knowledge doc embedded');
    },
  );
}

export function startEmbeddingsWorker(): Worker<EmbeddingsJob> {
  const worker = new Worker<EmbeddingsJob>(
    QUEUE_NAMES.embeddings,
    async (job) => {
      await processEmbeddingsJob(embeddingsJobSchema.parse(job.data));
    },
    { connection: redisConnectionOptions(), concurrency: 2 },
  );
  worker.on('error', (error) => {
    logger.error({ err: error }, 'embeddings worker error');
  });
  worker.on('failed', (job, error) => {
    logger.error({ err: error, jobId: job?.id, docId: job?.data.docId }, 'embeddings job failed');
  });
  return worker;
}
