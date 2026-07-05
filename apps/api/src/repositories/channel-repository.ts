import type { Channel, ChannelStatus } from '@prisma/client';
import { requireRequestContext } from '../lib/context.js';
import { basePrisma, prisma } from '../lib/prisma.js';

// Creates pass organizationId explicitly to satisfy the checked input types;
// the tenant extension re-forces the same value at runtime.
export const channelRepository = {
  create(provider: 'evolution' | 'cloud_api'): Promise<Channel> {
    const { organizationId } = requireRequestContext();
    return prisma.channel.create({ data: { provider, organizationId } });
  },

  findById(id: string): Promise<Channel | null> {
    return prisma.channel.findUnique({ where: { id } });
  },

  list(): Promise<Channel[]> {
    return prisma.channel.findMany({ orderBy: { createdAt: 'asc' } });
  },

  setExternalId(id: string, externalId: string): Promise<Channel> {
    return prisma.channel.update({ where: { id }, data: { externalId } });
  },

  updateStatus(id: string, status: ChannelStatus): Promise<Channel> {
    return prisma.channel.update({ where: { id }, data: { status } });
  },

  /**
   * System lookups for webhook and boot paths, which run before any tenant
   * context exists. Lookup is by primary key; the caller derives the tenant
   * from the returned row and enters its context for everything after.
   */
  findByIdSystem(id: string): Promise<Channel | null> {
    return basePrisma.channel.findUnique({ where: { id } });
  },

  listAllSystem(): Promise<Channel[]> {
    return basePrisma.channel.findMany();
  },

  updateStatusSystem(
    id: string,
    status: ChannelStatus,
    options: { startWarmup?: boolean } = {},
  ): Promise<Channel> {
    return basePrisma.channel.update({
      where: { id },
      data: {
        status,
        ...(options.startWarmup ? { warmupStartedAt: new Date() } : {}),
      },
    });
  },
};
