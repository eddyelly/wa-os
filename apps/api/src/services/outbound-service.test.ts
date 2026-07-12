import { beforeEach, describe, expect, it, vi } from 'vitest';
import { runWithRequestContext } from '../lib/context.js';
import { NotFoundError } from '../lib/errors.js';

// vi.hoisted is required (see notification-service.test.ts / order-service.test.ts)
// because the vi.mock factories below are hoisted above these consts; a plain
// top-level const referenced from inside a factory would throw a
// temporal-dead-zone ReferenceError otherwise.
const { conversationRepo, channelRepo, messageRepo, enqueueOutboundSend, emitToOrg } = vi.hoisted(() => ({
  conversationRepo: {
    findById: vi.fn(),
    touchLastMessage: vi.fn(),
  },
  channelRepo: {
    findById: vi.fn(),
  },
  messageRepo: {
    createOutbound: vi.fn(),
  },
  enqueueOutboundSend: vi.fn(),
  emitToOrg: vi.fn(),
}));

vi.mock('../repositories/conversation-repository.js', () => ({ conversationRepository: conversationRepo }));
vi.mock('../repositories/channel-repository.js', () => ({ channelRepository: channelRepo }));
vi.mock('../repositories/message-repository.js', () => ({ messageRepository: messageRepo }));
vi.mock('../lib/queues.js', () => ({ enqueueOutboundSend }));
vi.mock('../sockets/gateway.js', () => ({ emitToOrg }));

import { outboundService } from './outbound-service.js';

const ctx = { organizationId: 'org1', userId: 'u1', role: 'OWNER' as const };

const evolutionChannel = { id: 'chan1', provider: 'evolution' as const };
const optedInConversation = {
  id: 'conv1',
  channelId: 'chan1',
  contact: { optedInAt: new Date('2026-01-01T00:00:00Z') },
};

describe('outboundService.sendMedia', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('on allow: stores the message with mediaKey, caption as body, and type IMAGE, then queues the send', async () => {
    conversationRepo.findById.mockResolvedValue(optedInConversation);
    channelRepo.findById.mockResolvedValue(evolutionChannel);
    messageRepo.createOutbound.mockResolvedValue({ id: 'msg1', status: 'QUEUED' });

    const result = await runWithRequestContext(ctx, () =>
      outboundService.sendMedia({
        conversationId: 'conv1',
        mediaKey: 'products/p1-photo.jpg',
        caption: 'Here it is!',
        authorType: 'AI',
      }),
    );

    expect(messageRepo.createOutbound).toHaveBeenCalledWith({
      conversationId: 'conv1',
      body: 'Here it is!',
      type: 'IMAGE',
      mediaKey: 'products/p1-photo.jpg',
      authorType: 'AI',
    });
    expect(conversationRepo.touchLastMessage).toHaveBeenCalledWith('conv1');
    expect(enqueueOutboundSend).toHaveBeenCalledWith({
      organizationId: 'org1',
      channelId: 'chan1',
      messageId: 'msg1',
      action: 'MEDIA_ACTIVE_CONVERSATION',
    });
    expect(emitToOrg).toHaveBeenCalledWith('org1', 'message.new', {
      messageId: 'msg1',
      conversationId: 'conv1',
    });
    expect(result).toEqual({ id: 'msg1', status: 'QUEUED' });
  });

  it('stores a null body when no caption is given', async () => {
    conversationRepo.findById.mockResolvedValue(optedInConversation);
    channelRepo.findById.mockResolvedValue(evolutionChannel);
    messageRepo.createOutbound.mockResolvedValue({ id: 'msg1', status: 'QUEUED' });

    await runWithRequestContext(ctx, () =>
      outboundService.sendMedia({
        conversationId: 'conv1',
        mediaKey: 'products/p1-photo.jpg',
        authorType: 'AI',
      }),
    );

    expect(messageRepo.createOutbound).toHaveBeenCalledWith(
      expect.objectContaining({ body: null }),
    );
  });

  it('on block: persists the BLOCKED message with mediaKey and the reason, and never enqueues or touches lastMessage', async () => {
    conversationRepo.findById.mockResolvedValue(optedInConversation);
    channelRepo.findById.mockResolvedValue(evolutionChannel);
    messageRepo.createOutbound.mockResolvedValue({
      id: 'msg1',
      status: 'BLOCKED',
      blockedReason: 'COMING_SOON',
    });

    const result = await runWithRequestContext(ctx, () =>
      outboundService.sendMedia({
        conversationId: 'conv1',
        mediaKey: 'products/p1-photo.jpg',
        caption: 'Buy now!',
        authorType: 'AI',
        action: 'BROADCAST',
      }),
    );

    expect(messageRepo.createOutbound).toHaveBeenCalledWith({
      conversationId: 'conv1',
      body: 'Buy now!',
      type: 'IMAGE',
      mediaKey: 'products/p1-photo.jpg',
      authorType: 'AI',
      status: 'BLOCKED',
      blockedReason: 'COMING_SOON',
    });
    expect(conversationRepo.touchLastMessage).not.toHaveBeenCalled();
    expect(enqueueOutboundSend).not.toHaveBeenCalled();
    expect(emitToOrg).toHaveBeenCalledWith('org1', 'message.new', {
      messageId: 'msg1',
      conversationId: 'conv1',
    });
    expect(result).toEqual({ id: 'msg1', status: 'BLOCKED', blockedReason: 'COMING_SOON' });
  });

  it('throws NotFoundError when the conversation no longer exists', async () => {
    conversationRepo.findById.mockResolvedValue(null);

    await expect(
      runWithRequestContext(ctx, () =>
        outboundService.sendMedia({
          conversationId: 'gone',
          mediaKey: 'products/p1-photo.jpg',
          authorType: 'AI',
        }),
      ),
    ).rejects.toThrow(NotFoundError);
    expect(messageRepo.createOutbound).not.toHaveBeenCalled();
  });

  it('throws NotFoundError when the channel no longer exists', async () => {
    conversationRepo.findById.mockResolvedValue(optedInConversation);
    channelRepo.findById.mockResolvedValue(null);

    await expect(
      runWithRequestContext(ctx, () =>
        outboundService.sendMedia({
          conversationId: 'conv1',
          mediaKey: 'products/p1-photo.jpg',
          authorType: 'AI',
        }),
      ),
    ).rejects.toThrow(NotFoundError);
    expect(messageRepo.createOutbound).not.toHaveBeenCalled();
  });
});
