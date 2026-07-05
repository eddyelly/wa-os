import type { Channel, ChannelStatus } from '@prisma/client';
import type { ConnectChannelResponse } from '@waos/shared';
import { evolutionAdapter } from '../adapters/evolution/evolution-adapter.js';
import { config } from '../lib/config.js';
import { NotFoundError } from '../lib/errors.js';
import { logger } from '../lib/logger.js';
import { channelRepository } from '../repositories/channel-repository.js';
import { emitToOrg } from '../sockets/gateway.js';

function webhookUrl(): string {
  return `${config.API_PUBLIC_URL}/api/v1/webhooks/evolution/${config.EVOLUTION_WEBHOOK_SECRET}`;
}

function toDto(channel: Channel): ConnectChannelResponse['channel'] {
  return {
    id: channel.id,
    provider: channel.provider,
    status: channel.status,
    warmupStartedAt: channel.warmupStartedAt,
    createdAt: channel.createdAt,
  };
}

export const channelService = {
  toDto,

  list(): Promise<Channel[]> {
    return channelRepository.list();
  },

  /**
   * Channel lifecycle start: create the row, provision the Evolution
   * instance (instance name = channel id), and fetch the first QR.
   */
  async createAndConnect(): Promise<ConnectChannelResponse> {
    const channel = await channelRepository.create('evolution');
    await evolutionAdapter.createInstance(channel.id, webhookUrl());
    await channelRepository.setExternalId(channel.id, channel.id);
    return this.connect(channel.id);
  },

  async connect(channelId: string): Promise<ConnectChannelResponse> {
    const channel = await channelRepository.findById(channelId);
    if (!channel) {
      throw new NotFoundError('This WhatsApp connection no longer exists.');
    }
    const result = await evolutionAdapter.connect(channel.id);
    const status: ChannelStatus = result.qr ? 'QR_READY' : result.status;
    const updated = await channelRepository.updateStatus(channel.id, status);
    return {
      channel: toDto(updated),
      ...(result.qr ? { qr: result.qr } : {}),
    };
  },

  async disconnect(channelId: string): Promise<Channel> {
    const channel = await channelRepository.findById(channelId);
    if (!channel) {
      throw new NotFoundError('This WhatsApp connection no longer exists.');
    }
    await evolutionAdapter.disconnect(channel.id);
    const updated = await channelRepository.updateStatus(channel.id, 'DISCONNECTED');
    emitToOrg(updated.organizationId, 'channel.status_changed', {
      channelId: updated.id,
      status: updated.status,
    });
    return updated;
  },

  /**
   * Webhook-driven status transition (runs inside the channel's tenant
   * context resolved by the inbound service). First CONNECTED starts the
   * warm-up clock.
   */
  async applyStatusEvent(channel: Channel, status: ChannelStatus): Promise<void> {
    const startWarmup = status === 'CONNECTED' && channel.warmupStartedAt === null;
    const updated = await channelRepository.updateStatusSystem(channel.id, status, {
      startWarmup,
    });
    emitToOrg(channel.organizationId, 'channel.status_changed', {
      channelId: updated.id,
      status: updated.status,
    });
  },

  /**
   * Sessions must survive API restarts (CLAUDE.md 3.4): on boot, ask the
   * provider for every channel's real state and reconcile our rows.
   */
  async reconcileAllOnBoot(): Promise<void> {
    const channels = await channelRepository.listAllSystem();
    for (const channel of channels) {
      if (channel.provider !== 'evolution') {
        continue;
      }
      try {
        const status = await evolutionAdapter.getSessionStatus(channel.id);
        if (status !== channel.status) {
          await channelRepository.updateStatusSystem(channel.id, status);
          emitToOrg(channel.organizationId, 'channel.status_changed', {
            channelId: channel.id,
            status,
          });
        }
      } catch (error) {
        logger.warn({ err: error, channelId: channel.id }, 'boot reconcile failed for channel');
      }
    }
  },
};
