import type { Channel } from '@prisma/client';
import type { IncomingMessage } from '@waos/ports';
import { evolutionAdapter, type NormalizedEvent } from '../adapters/evolution/evolution-adapter.js';
import { runWithRequestContext } from '../lib/context.js';
import { logger } from '../lib/logger.js';
import { putMediaObject } from '../lib/minio.js';
import { enqueueAiReply } from '../lib/queues.js';
import { channelRepository } from '../repositories/channel-repository.js';
import { contactRepository } from '../repositories/contact-repository.js';
import { conversationRepository } from '../repositories/conversation-repository.js';
import { messageRepository } from '../repositories/message-repository.js';
import { channelService } from './channel-service.js';
import { emitToOrg } from '../sockets/gateway.js';

/**
 * Inbound pipeline (CLAUDE.md section 8): webhook -> validate -> normalize
 * (in the adapter) -> upsert Contact + Conversation -> store Message ->
 * media to MinIO -> emit message.new -> enqueue ai-reply when AI is on.
 */
export const inboundService = {
  async processEvolutionWebhook(body: unknown): Promise<void> {
    const normalized = evolutionAdapter.normalizeWebhookEvent(body);
    if (!normalized) {
      logger.warn('discarding unparseable webhook delivery');
      return;
    }
    const channel = await channelRepository.findByIdSystem(normalized.channelId);
    if (!channel) {
      logger.warn({ channelId: normalized.channelId }, 'webhook for unknown channel');
      return;
    }
    await runWithRequestContext(
      { organizationId: channel.organizationId, userId: 'webhook:evolution', role: 'OWNER' },
      () => handleEvent(channel, normalized.event),
    );
  },
};

async function handleEvent(channel: Channel, event: NormalizedEvent): Promise<void> {
  switch (event.kind) {
    case 'status':
      await channelService.applyStatusEvent(channel, event.status);
      return;
    case 'qr':
      if (channel.status !== 'CONNECTED') {
        await channelRepository.updateStatusSystem(channel.id, 'QR_READY');
      }
      // The QR payload itself is never logged (CLAUDE.md standard 8).
      emitToOrg(channel.organizationId, 'channel.status_changed', {
        channelId: channel.id,
        status: 'QR_READY',
        qr: { code: event.code, base64: event.base64 },
      });
      return;
    case 'message_status': {
      const message = await messageRepository.updateStatusByProviderId(
        event.providerMessageId,
        event.status,
      );
      if (message) {
        emitToOrg(channel.organizationId, 'message.updated', {
          messageId: message.id,
          conversationId: message.conversationId,
          status: message.status,
        });
      }
      return;
    }
    case 'message':
      await handleIncomingMessage(channel, event.message);
      return;
    case 'ignored':
      logger.debug({ reason: event.reason, channelId: channel.id }, 'webhook event ignored');
      return;
  }
}

async function handleIncomingMessage(channel: Channel, incoming: IncomingMessage): Promise<void> {
  // Idempotency: re-delivered webhooks must not duplicate rows.
  const existing = await messageRepository.findByProviderId(incoming.providerMessageId);
  if (existing) {
    return;
  }

  const contact = await contactRepository.upsertByPhone(incoming.from, incoming.contactName);
  const conversation = await conversationRepository.upsertForContact(channel.id, contact.id);

  let mediaKey: string | undefined;
  if (incoming.media) {
    try {
      const media = await evolutionAdapter.downloadMedia(channel.id, incoming.providerMessageId);
      const key = `${channel.organizationId}/${conversation.id}/${incoming.providerMessageId}`;
      mediaKey = await putMediaObject(key, media.data, media.mimeType);
    } catch (error) {
      logger.error(
        { err: error, providerMessageId: incoming.providerMessageId },
        'media download failed, storing message without media',
      );
    }
  }

  // Resolve a replied-to message to a local row, scoped to this conversation
  // (and therefore this tenant): a quote that predates the connection or
  // belongs to another conversation is left unresolved.
  let replyToMessageId: string | undefined;
  if (incoming.quotedProviderMessageId) {
    const quoted = await messageRepository.findByProviderId(incoming.quotedProviderMessageId);
    if (quoted && quoted.conversationId === conversation.id) {
      replyToMessageId = quoted.id;
    }
  }

  const message = await messageRepository.createInbound({
    conversationId: conversation.id,
    providerMessageId: incoming.providerMessageId,
    type: incoming.type,
    body: incoming.text ?? null,
    mediaKey,
    replyToMessageId,
  });

  emitToOrg(channel.organizationId, 'message.new', {
    messageId: message.id,
    conversationId: conversation.id,
  });
  emitToOrg(channel.organizationId, 'conversation.updated', {
    conversationId: conversation.id,
  });

  if (conversation.aiEnabled && (incoming.type === 'TEXT' || incoming.type === 'IMAGE')) {
    await enqueueAiReply({
      organizationId: channel.organizationId,
      conversationId: conversation.id,
      inboundMessageId: message.id,
    });
  }
}
