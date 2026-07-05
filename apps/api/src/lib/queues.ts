import { Queue } from 'bullmq';
import {
  aiReplyJobSchema,
  embeddingsJobSchema,
  outboundSendJobSchema,
  reminderJobSchema,
  type AiReplyJob,
  type EmbeddingsJob,
  type OutboundSendJob,
  type ReminderJob,
} from '@waos/shared';
import { redisConnectionOptions } from './redis.js';

export const QUEUE_NAMES = {
  outbound: 'outbound',
  aiReply: 'ai-reply',
  embeddings: 'embeddings',
  reminders: 'reminders',
} as const;

const connection = redisConnectionOptions();

const defaultJobOptions = {
  attempts: 3,
  backoff: { type: 'exponential' as const, delay: 5_000 },
  removeOnComplete: { age: 24 * 60 * 60, count: 1_000 },
  removeOnFail: { age: 7 * 24 * 60 * 60 },
};

export const outboundQueue = new Queue<OutboundSendJob>(QUEUE_NAMES.outbound, {
  connection,
  defaultJobOptions,
});
export const aiReplyQueue = new Queue<AiReplyJob>(QUEUE_NAMES.aiReply, {
  connection,
  defaultJobOptions,
});
export const embeddingsQueue = new Queue<EmbeddingsJob>(QUEUE_NAMES.embeddings, {
  connection,
  defaultJobOptions,
});
export const remindersQueue = new Queue<ReminderJob>(QUEUE_NAMES.reminders, {
  connection,
  defaultJobOptions,
});

// Enqueue helpers parse payloads so a malformed job can never enter a queue.
// Job ids make enqueues idempotent (BullMQ ignores duplicates by id).

export async function enqueueOutboundSend(payload: OutboundSendJob): Promise<void> {
  const data = outboundSendJobSchema.parse(payload);
  await outboundQueue.add('send', data, { jobId: `send-${data.messageId}` });
}

export async function enqueueAiReply(payload: AiReplyJob): Promise<void> {
  const data = aiReplyJobSchema.parse(payload);
  await aiReplyQueue.add('reply', data, { jobId: `ai-${data.inboundMessageId}` });
}

export async function enqueueEmbeddings(payload: EmbeddingsJob): Promise<void> {
  const data = embeddingsJobSchema.parse(payload);
  await embeddingsQueue.add('embed', data, { jobId: `embed-${data.docId}-${Date.now()}` });
}

export async function enqueueReminder(payload: ReminderJob, delayMs: number): Promise<string> {
  const data = reminderJobSchema.parse(payload);
  const jobId = `reminder-${data.appointmentId}-${data.offset}`;
  await remindersQueue.add('remind', data, { jobId, delay: Math.max(delayMs, 0) });
  return jobId;
}

export async function cancelReminder(jobId: string): Promise<void> {
  const job = await remindersQueue.getJob(jobId);
  if (job) {
    await job.remove();
  }
}

export async function closeQueues(): Promise<void> {
  await Promise.all([
    outboundQueue.close(),
    aiReplyQueue.close(),
    embeddingsQueue.close(),
    remindersQueue.close(),
  ]);
}
