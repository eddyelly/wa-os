import type { Notification, Prisma } from '@prisma/client';
import type { NotificationDto } from '@waos/shared';
import { requireRequestContext } from '../lib/context.js';
import { logger } from '../lib/logger.js';
import { channelRepository } from '../repositories/channel-repository.js';
import { contactRepository } from '../repositories/contact-repository.js';
import { conversationRepository } from '../repositories/conversation-repository.js';
import { notificationRepository } from '../repositories/notification-repository.js';
import { organizationRepository } from '../repositories/organization-repository.js';
import { emitToOrg } from '../sockets/gateway.js';
import { parseOrgShopSettings } from './ai-reply.js';
import { outboundService } from './outbound-service.js';

const OWNER_CONTACT_NAME = 'Owner alerts';

type NotificationType = 'NEW_ORDER' | 'LOW_STOCK' | 'HANDOFF';
type RelayableType = Exclude<NotificationType, 'HANDOFF'>;

function toDto(notification: Notification): NotificationDto {
  return {
    id: notification.id,
    type: notification.type,
    payload: notification.payload as Record<string, unknown>,
    readAt: notification.readAt ? notification.readAt.toISOString() : null,
    createdAt: notification.createdAt.toISOString(),
  };
}

/**
 * Short English one-liner for the owner's WhatsApp. Built defensively from
 * the untyped payload record: a missing or mistyped field yields null and
 * the caller skips the relay (with an ids-only warn) instead of sending a
 * garbled alert.
 */
function buildOwnerAlertBody(type: RelayableType, payload: Record<string, unknown>): string | null {
  if (type === 'NEW_ORDER') {
    const { orderId, total } = payload;
    const hasOrderId =
      (typeof orderId === 'string' && orderId.length > 0) || typeof orderId === 'number';
    if (!hasOrderId || typeof total !== 'number') {
      return null;
    }
    return `New order ${String(orderId).slice(-6)}: ${total} TZS`;
  }
  const { name, stockQty } = payload;
  if (typeof name !== 'string' || name.length === 0 || typeof stockQty !== 'number') {
    return null;
  }
  return `Low stock: ${name} (${stockQty} left)`;
}

/**
 * Relays a NEW_ORDER or LOW_STOCK alert to the owner's own WhatsApp when
 * the org has enabled owner alerts. The owner is modeled as a regular
 * (opted-in) contact so the send flows through the exact same policy plus
 * outbound pipeline as every other message: outboundService runs the
 * PolicyEngine with action OWNER_ALERT before anything is enqueued.
 */
async function relayOwnerAlert(
  notificationId: string,
  type: RelayableType,
  payload: Record<string, unknown>,
): Promise<void> {
  const { organizationId } = requireRequestContext();
  const organization = await organizationRepository.findCurrent(organizationId);
  const shop = parseOrgShopSettings(organization?.settings);
  if (!shop.ownerAlertsEnabled || !shop.ownerAlertPhone) {
    return;
  }

  const body = buildOwnerAlertBody(type, payload);
  if (body === null) {
    logger.warn({ notificationId, type }, 'owner alert skipped: payload missing required fields');
    return;
  }

  const channels = await channelRepository.list();
  const channel = channels.find((candidate) => candidate.status === 'CONNECTED');
  if (!channel) {
    logger.debug({ notificationId, type }, 'owner alert skipped: no connected channel');
    return;
  }

  const contact = await contactRepository.upsertByPhone(shop.ownerAlertPhone, OWNER_CONTACT_NAME);
  if (contact.optedInAt === null) {
    // OWNER_ALERT is a proactive send: the policy engine requires opt-in,
    // and entering a phone number in settings is the owner's consent.
    await contactRepository.setOptedIn(contact.id);
  }
  const conversation = await conversationRepository.upsertForContact(channel.id, contact.id);
  await outboundService.sendText({
    conversationId: conversation.id,
    body,
    authorType: 'SYSTEM',
    action: 'OWNER_ALERT',
  });
}

export const notificationService = {
  /**
   * Persists the notification, then emits its ids over the socket only.
   * The full payload (order totals, contact names, product stock, ...)
   * stays in the DB row; the dashboard refetches details over REST via
   * `list` when it needs them.
   *
   * NEW_ORDER and LOW_STOCK (never HANDOFF) are additionally relayed to
   * the owner's WhatsApp after the in-app notification succeeds. The
   * relay is strictly best-effort: any failure is caught and logged (ids
   * only) and can never fail the notification itself.
   */
  async notify(type: NotificationType, payload: Record<string, unknown>): Promise<void> {
    const notification = await notificationRepository.create({
      type,
      payload: payload as Prisma.InputJsonValue,
    });
    emitToOrg(requireRequestContext().organizationId, 'notification.new', {
      notificationId: notification.id,
      type: notification.type,
    });

    if (type === 'HANDOFF') {
      return;
    }
    try {
      await relayOwnerAlert(notification.id, type, payload);
    } catch (error) {
      logger.warn(
        { err: error, notificationId: notification.id, type },
        'owner whatsapp relay failed',
      );
    }
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
