import type { Contact, Conversation, ConversationStatus, Message, User } from '@prisma/client';
import { requireRequestContext } from '../lib/context.js';
import { prisma } from '../lib/prisma.js';

export type ConversationWithContact = Conversation & {
  contact: Contact;
  assignee: Pick<User, 'id' | 'name'> | null;
};

export type ConversationListRow = ConversationWithContact & { messages: Message[] };

export const conversationRepository = {
  findById(id: string): Promise<ConversationWithContact | null> {
    return prisma.conversation.findUnique({
      where: { id },
      include: { contact: true, assignee: { select: { id: true, name: true } } },
    });
  },

  async upsertForContact(channelId: string, contactId: string): Promise<Conversation> {
    const existing = await prisma.conversation.findFirst({ where: { channelId, contactId } });
    if (existing) {
      return prisma.conversation.update({
        where: { id: existing.id },
        data: {
          lastMessageAt: new Date(),
          // A new customer message reopens a closed thread.
          ...(existing.status === 'CLOSED' ? { status: 'OPEN' } : {}),
        },
      });
    }
    return prisma.conversation.create({
      data: {
        channelId,
        contactId,
        lastMessageAt: new Date(),
        organizationId: requireRequestContext().organizationId,
      },
    });
  },

  list(params: { status?: ConversationStatus }): Promise<ConversationListRow[]> {
    return prisma.conversation.findMany({
      where: params.status ? { status: params.status } : {},
      include: {
        contact: true,
        assignee: { select: { id: true, name: true } },
        messages: { orderBy: { createdAt: 'desc' }, take: 1 },
      },
      orderBy: { lastMessageAt: 'desc' },
      take: 100,
    });
  },

  updateAssignee(id: string, assigneeId: string | null): Promise<Conversation> {
    return prisma.conversation.update({ where: { id }, data: { assigneeId } });
  },

  updateStatus(id: string, status: ConversationStatus): Promise<Conversation> {
    return prisma.conversation.update({ where: { id }, data: { status } });
  },

  updateAiEnabled(id: string, aiEnabled: boolean): Promise<Conversation> {
    return prisma.conversation.update({ where: { id }, data: { aiEnabled } });
  },

  touchLastMessage(id: string): Promise<Conversation> {
    return prisma.conversation.update({ where: { id }, data: { lastMessageAt: new Date() } });
  },

  countByStatusToday(status: ConversationStatus): Promise<number> {
    const startOfDay = new Date();
    startOfDay.setHours(0, 0, 0, 0);
    return prisma.conversation.count({
      where: { status, lastMessageAt: { gte: startOfDay } },
    });
  },
};
