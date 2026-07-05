import type { Contact, Message } from '@prisma/client';
import type { ConversationListItem, MessageDto } from '@waos/shared';
import { requireRequestContext } from '../lib/context.js';
import { NotFoundError } from '../lib/errors.js';
import { getMediaUrl } from '../lib/minio.js';
import {
  conversationRepository,
  type ConversationListRow,
  type ConversationWithContact,
} from '../repositories/conversation-repository.js';
import { messageRepository } from '../repositories/message-repository.js';
import { outboundService } from './outbound-service.js';
import { emitToOrg } from '../sockets/gateway.js';

function contactDto(contact: Contact): ConversationListItem['contact'] {
  return {
    id: contact.id,
    phone: contact.phone,
    name: contact.name,
    language: contact.language,
    optedInAt: contact.optedInAt,
  };
}

function toListItem(row: ConversationListRow): ConversationListItem {
  const last = row.messages[0];
  return {
    id: row.id,
    status: row.status,
    aiEnabled: row.aiEnabled,
    assigneeId: row.assigneeId,
    assigneeName: row.assignee?.name ?? null,
    lastMessageAt: row.lastMessageAt,
    lastMessagePreview: last ? (last.body ?? `[${last.type.toLowerCase()}]`) : null,
    contact: contactDto(row.contact),
  };
}

async function toMessageDto(message: Message): Promise<MessageDto> {
  return {
    id: message.id,
    conversationId: message.conversationId,
    direction: message.direction,
    type: message.type,
    body: message.body,
    mediaUrl: message.mediaKey ? await getMediaUrl(message.mediaKey) : null,
    authorType: message.authorType,
    status: message.status,
    blockedReason: message.blockedReason,
    createdAt: message.createdAt,
  };
}

export const conversationService = {
  async list(status?: ConversationListItem['status']): Promise<ConversationListItem[]> {
    const rows = await conversationRepository.list({ status });
    return rows.map(toListItem);
  },

  async getWithContact(id: string): Promise<ConversationWithContact> {
    const conversation = await conversationRepository.findById(id);
    if (!conversation) {
      throw new NotFoundError('This conversation no longer exists.');
    }
    return conversation;
  },

  async messages(conversationId: string): Promise<MessageDto[]> {
    await this.getWithContact(conversationId);
    const rows = await messageRepository.listByConversation(conversationId);
    return Promise.all(rows.map(toMessageDto));
  },

  async sendFromAgent(conversationId: string, body: string): Promise<MessageDto> {
    const message = await outboundService.sendText({
      conversationId,
      body,
      authorType: 'HUMAN_AGENT',
    });
    return toMessageDto(message);
  },

  async assign(conversationId: string, assigneeId: string | null): Promise<void> {
    await this.getWithContact(conversationId);
    await conversationRepository.updateAssignee(conversationId, assigneeId);
    emitToOrg(requireRequestContext().organizationId, 'conversation.updated', {
      conversationId,
    });
  },

  async setStatus(
    conversationId: string,
    status: ConversationListItem['status'],
  ): Promise<void> {
    await this.getWithContact(conversationId);
    await conversationRepository.updateStatus(conversationId, status);
    emitToOrg(requireRequestContext().organizationId, 'conversation.updated', {
      conversationId,
    });
  },

  async setAiEnabled(conversationId: string, aiEnabled: boolean): Promise<void> {
    await this.getWithContact(conversationId);
    await conversationRepository.updateAiEnabled(conversationId, aiEnabled);
    emitToOrg(requireRequestContext().organizationId, 'conversation.updated', {
      conversationId,
    });
  },
};
