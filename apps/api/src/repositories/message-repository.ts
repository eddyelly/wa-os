import type {
  AuthorType,
  Channel,
  Contact,
  Conversation,
  Message,
  MessageStatus,
  MessageType,
} from '@prisma/client';
import { requireRequestContext } from '../lib/context.js';
import { prisma } from '../lib/prisma.js';

export type MessageWithThread = Message & {
  conversation: Conversation & { contact: Contact; channel: Channel };
};

export const messageRepository = {
  createOutbound(data: {
    conversationId: string;
    body: string | null;
    type: MessageType;
    authorType: AuthorType;
    mediaKey?: string;
    status?: MessageStatus;
    blockedReason?: string;
  }): Promise<Message> {
    return prisma.message.create({
      data: {
        organizationId: requireRequestContext().organizationId,
        conversationId: data.conversationId,
        direction: 'OUT',
        type: data.type,
        body: data.body,
        mediaKey: data.mediaKey ?? null,
        authorType: data.authorType,
        status: data.status ?? 'QUEUED',
        blockedReason: data.blockedReason ?? null,
      },
    });
  },

  createInbound(data: {
    conversationId: string;
    providerMessageId: string;
    type: MessageType;
    body: string | null;
    mediaKey?: string;
    createdAt?: Date;
  }): Promise<Message> {
    return prisma.message.create({
      data: {
        organizationId: requireRequestContext().organizationId,
        conversationId: data.conversationId,
        direction: 'IN',
        type: data.type,
        body: data.body,
        mediaKey: data.mediaKey ?? null,
        authorType: 'CONTACT',
        providerMessageId: data.providerMessageId,
        status: 'DELIVERED',
      },
    });
  },

  findByProviderId(providerMessageId: string): Promise<Message | null> {
    return prisma.message.findFirst({ where: { providerMessageId } });
  },

  findByIdWithThread(id: string): Promise<MessageWithThread | null> {
    return prisma.message.findUnique({
      where: { id },
      include: { conversation: { include: { contact: true, channel: true } } },
    });
  },

  updateStatus(
    id: string,
    status: MessageStatus,
    extra: { providerMessageId?: string; blockedReason?: string } = {},
  ): Promise<Message> {
    return prisma.message.update({
      where: { id },
      data: {
        status,
        ...(extra.providerMessageId ? { providerMessageId: extra.providerMessageId } : {}),
        ...(extra.blockedReason ? { blockedReason: extra.blockedReason } : {}),
      },
    });
  },

  async updateStatusByProviderId(
    providerMessageId: string,
    status: MessageStatus,
  ): Promise<Message | null> {
    const message = await prisma.message.findFirst({ where: { providerMessageId } });
    if (!message) {
      return null;
    }
    // Ticks only move forward: SENT -> DELIVERED -> READ.
    const order: MessageStatus[] = ['QUEUED', 'SENT', 'DELIVERED', 'READ'];
    if (order.indexOf(status) <= order.indexOf(message.status)) {
      return message;
    }
    return prisma.message.update({ where: { id: message.id }, data: { status } });
  },

  listByConversation(conversationId: string, limit = 100): Promise<Message[]> {
    return prisma.message.findMany({
      where: { conversationId },
      orderBy: { createdAt: 'asc' },
      take: limit,
    });
  },

  lastInConversation(conversationId: string): Promise<Message | null> {
    return prisma.message.findFirst({
      where: { conversationId },
      orderBy: { createdAt: 'desc' },
    });
  },
};
