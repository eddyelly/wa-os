import type { Notification, NotificationType, Prisma } from '@prisma/client';
import { requireRequestContext } from '../lib/context.js';
import { prisma } from '../lib/prisma.js';

const LIST_LIMIT = 50;

export const notificationRepository = {
  create(data: { type: NotificationType; payload: Prisma.InputJsonValue }): Promise<Notification> {
    return prisma.notification.create({
      data: { ...data, organizationId: requireRequestContext().organizationId },
    });
  },

  list(params: { unreadOnly?: boolean } = {}): Promise<Notification[]> {
    return prisma.notification.findMany({
      where: params.unreadOnly ? { readAt: null } : {},
      orderBy: { createdAt: 'desc' },
      take: LIST_LIMIT,
    });
  },

  /**
   * Guarded by `readAt: null` so a repeat call against an already-read
   * notification is a no-op: it never overwrites the original readAt with a
   * later timestamp. Also a no-op for an unknown id (updateMany matches zero
   * rows rather than throwing), which keeps this idempotent either way.
   */
  async markRead(id: string): Promise<void> {
    await prisma.notification.updateMany({
      where: { id, readAt: null },
      data: { readAt: new Date() },
    });
  },

  async markAllRead(): Promise<void> {
    await prisma.notification.updateMany({
      where: { readAt: null },
      data: { readAt: new Date() },
    });
  },
};
