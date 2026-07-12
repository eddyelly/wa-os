import type { Notification, Prisma } from '@prisma/client';
import type { NotificationDto } from '@waos/shared';
import { requireRequestContext } from '../lib/context.js';
import { notificationRepository } from '../repositories/notification-repository.js';
import { emitToOrg } from '../sockets/gateway.js';

function toDto(notification: Notification): NotificationDto {
  return {
    id: notification.id,
    type: notification.type,
    payload: notification.payload as Record<string, unknown>,
    readAt: notification.readAt ? notification.readAt.toISOString() : null,
    createdAt: notification.createdAt.toISOString(),
  };
}

export const notificationService = {
  /**
   * Persists the notification, then emits its ids over the socket only.
   * The full payload (order totals, contact names, product stock, ...)
   * stays in the DB row; the dashboard refetches details over REST via
   * `list` when it needs them. Task 10 (owner WhatsApp relay) and Task 11
   * extend this service further; this stays the single write path.
   */
  async notify(
    type: 'NEW_ORDER' | 'LOW_STOCK' | 'HANDOFF',
    payload: Record<string, unknown>,
  ): Promise<void> {
    const notification = await notificationRepository.create({
      type,
      payload: payload as Prisma.InputJsonValue,
    });
    emitToOrg(requireRequestContext().organizationId, 'notification.new', {
      notificationId: notification.id,
      type: notification.type,
    });
  },

  async list(unreadOnly?: boolean): Promise<NotificationDto[]> {
    const rows = await notificationRepository.list({ unreadOnly });
    return rows.map(toDto);
  },

  async markRead(id: string): Promise<void> {
    await notificationRepository.markRead(id);
  },

  async markAllRead(): Promise<void> {
    await notificationRepository.markAllRead();
  },
};
