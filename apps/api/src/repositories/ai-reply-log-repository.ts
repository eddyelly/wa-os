import type { AiReplyAction, AiReplyLog } from '@prisma/client';
import { requireRequestContext } from '../lib/context.js';
import { prisma } from '../lib/prisma.js';

export const aiReplyLogRepository = {
  create(data: {
    conversationId: string;
    retrievedChunkIds: string[];
    confidence: number;
    action: AiReplyAction;
    latencyMs: number;
    toolsUsed?: string[];
  }): Promise<AiReplyLog> {
    return prisma.aiReplyLog.create({
      data: { ...data, organizationId: requireRequestContext().organizationId },
    });
  },

  /** Deflection metric inputs for a time window. */
  async countsSince(since: Date): Promise<{ replied: number; handedOff: number }> {
    const [replied, handedOff] = await Promise.all([
      prisma.aiReplyLog.count({ where: { action: 'REPLIED', createdAt: { gte: since } } }),
      prisma.aiReplyLog.count({ where: { action: 'HANDED_OFF', createdAt: { gte: since } } }),
    ]);
    return { replied, handedOff };
  },
};
