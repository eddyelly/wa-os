import type { AuthorType, Message } from '@prisma/client';
import type { PolicyAction } from '@waos/shared';
import { requireRequestContext } from '../lib/context.js';
import { NotFoundError } from '../lib/errors.js';
import { enqueueOutboundSend } from '../lib/queues.js';
import { channelRepository } from '../repositories/channel-repository.js';
import { conversationRepository } from '../repositories/conversation-repository.js';
import { messageRepository } from '../repositories/message-repository.js';
import { policyEngine } from '../policy/policy-engine.js';
import { emitToOrg } from '../sockets/gateway.js';

/**
 * The single path for sending anything: store the Message, run the policy
 * engine BEFORE enqueueing (CLAUDE.md 3.2), and either queue the send or
 * store the block decision on the row.
 */
export const outboundService = {
  async sendText(params: {
    conversationId: string;
    body: string;
    authorType: AuthorType;
    action?: PolicyAction;
    replyToMessageId?: string;
  }): Promise<Message> {
    const { organizationId } = requireRequestContext();
    const conversation = await conversationRepository.findById(params.conversationId);
    if (!conversation) {
      throw new NotFoundError('This conversation no longer exists.');
    }
    const channel = await channelRepository.findById(conversation.channelId);
    if (!channel) {
      throw new NotFoundError('This WhatsApp connection no longer exists.');
    }

    const action = params.action ?? 'REPLY_ACTIVE_CONVERSATION';
    const decision = policyEngine.check(action, channel.provider, {
      contactOptedIn: conversation.contact.optedInAt !== null,
    });

    if (decision.outcome === 'block') {
      const blocked = await messageRepository.createOutbound({
        conversationId: conversation.id,
        body: params.body,
        type: 'TEXT',
        authorType: params.authorType,
        status: 'BLOCKED',
        blockedReason: decision.reason,
        replyToMessageId: params.replyToMessageId,
      });
      emitToOrg(organizationId, 'message.new', {
        messageId: blocked.id,
        conversationId: conversation.id,
      });
      return blocked;
    }

    const message = await messageRepository.createOutbound({
      conversationId: conversation.id,
      body: params.body,
      type: 'TEXT',
      authorType: params.authorType,
      replyToMessageId: params.replyToMessageId,
    });
    await conversationRepository.touchLastMessage(conversation.id);
    await enqueueOutboundSend({
      organizationId,
      channelId: channel.id,
      messageId: message.id,
      action,
    });
    emitToOrg(organizationId, 'message.new', {
      messageId: message.id,
      conversationId: conversation.id,
    });
    return message;
  },

  /**
   * Mirrors `sendText` exactly (policy check, BLOCKED persistence path,
   * outbound enqueue) with one difference: the row carries `mediaKey` and
   * type IMAGE, and the caption (if any) is stored as `body`.
   */
  async sendMedia(params: {
    conversationId: string;
    mediaKey: string;
    caption?: string;
    authorType: AuthorType;
    action?: PolicyAction;
    replyToMessageId?: string;
  }): Promise<Message> {
    const { organizationId } = requireRequestContext();
    const conversation = await conversationRepository.findById(params.conversationId);
    if (!conversation) {
      throw new NotFoundError('This conversation no longer exists.');
    }
    const channel = await channelRepository.findById(conversation.channelId);
    if (!channel) {
      throw new NotFoundError('This WhatsApp connection no longer exists.');
    }

    const action = params.action ?? 'MEDIA_ACTIVE_CONVERSATION';
    const decision = policyEngine.check(action, channel.provider, {
      contactOptedIn: conversation.contact.optedInAt !== null,
    });

    if (decision.outcome === 'block') {
      const blocked = await messageRepository.createOutbound({
        conversationId: conversation.id,
        body: params.caption ?? null,
        type: 'IMAGE',
        mediaKey: params.mediaKey,
        authorType: params.authorType,
        status: 'BLOCKED',
        blockedReason: decision.reason,
        replyToMessageId: params.replyToMessageId,
      });
      emitToOrg(organizationId, 'message.new', {
        messageId: blocked.id,
        conversationId: conversation.id,
      });
      return blocked;
    }

    const message = await messageRepository.createOutbound({
      conversationId: conversation.id,
      body: params.caption ?? null,
      type: 'IMAGE',
      mediaKey: params.mediaKey,
      authorType: params.authorType,
      replyToMessageId: params.replyToMessageId,
    });
    await conversationRepository.touchLastMessage(conversation.id);
    await enqueueOutboundSend({
      organizationId,
      channelId: channel.id,
      messageId: message.id,
      action,
    });
    emitToOrg(organizationId, 'message.new', {
      messageId: message.id,
      conversationId: conversation.id,
    });
    return message;
  },
};
