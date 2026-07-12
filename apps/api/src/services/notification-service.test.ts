import { beforeEach, describe, expect, it, vi } from 'vitest';
import { runWithRequestContext } from '../lib/context.js';

// vi.hoisted is required (see product-service.test.ts / order-service.test.ts)
// because the vi.mock factories below are hoisted above these consts; a
// plain top-level const referenced from inside a factory would throw a
// temporal-dead-zone ReferenceError otherwise.
const { repo, emitToOrg, organizationRepo, channelRepo, contactRepo, conversationRepo, outboundService, logger } =
  vi.hoisted(() => ({
    repo: {
      create: vi.fn(),
      list: vi.fn(),
      markRead: vi.fn(),
      markAllRead: vi.fn(),
    },
    emitToOrg: vi.fn(),
    organizationRepo: { findCurrent: vi.fn() },
    channelRepo: { list: vi.fn() },
    contactRepo: { upsertByPhone: vi.fn(), setOptedIn: vi.fn() },
    conversationRepo: { upsertForContact: vi.fn() },
    outboundService: { sendText: vi.fn() },
    logger: { warn: vi.fn(), debug: vi.fn() },
  }));

vi.mock('../repositories/notification-repository.js', () => ({ notificationRepository: repo }));
vi.mock('../sockets/gateway.js', () => ({ emitToOrg }));
vi.mock('../repositories/organization-repository.js', () => ({ organizationRepository: organizationRepo }));
vi.mock('../repositories/channel-repository.js', () => ({ channelRepository: channelRepo }));
vi.mock('../repositories/contact-repository.js', () => ({ contactRepository: contactRepo }));
vi.mock('../repositories/conversation-repository.js', () => ({ conversationRepository: conversationRepo }));
vi.mock('./outbound-service.js', () => ({ outboundService }));
vi.mock('../lib/logger.js', () => ({ logger }));
// parseOrgShopSettings is NOT mocked: the owner-alert tests below exercise
// the real function from ai-reply.ts against plain settings objects.

import { notificationService } from './notification-service.js';

const ctx = { organizationId: 'org1', userId: 'u1', role: 'OWNER' as const };

function organization(settings: Record<string, unknown>): {
  id: string;
  settings: Record<string, unknown>;
} {
  return { id: 'org1', settings };
}

const connectedChannel = { id: 'chan1', status: 'CONNECTED' as const };
const disconnectedChannel = { id: 'chan2', status: 'DISCONNECTED' as const };
const ownerContact = { id: 'contact-owner', optedInAt: null as Date | null };

describe('notificationService.notify', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('persists the notification and emits notification.new with ids only, never the payload body', async () => {
    repo.create.mockResolvedValue({
      id: 'n1',
      organizationId: 'org1',
      type: 'NEW_ORDER',
      payload: { orderId: 'o1', total: 5000, contactName: 'Fatuma' },
      readAt: null,
      createdAt: new Date('2026-01-01T00:00:00Z'),
      updatedAt: new Date('2026-01-01T00:00:00Z'),
    });

    await runWithRequestContext(ctx, () =>
      notificationService.notify('NEW_ORDER', { orderId: 'o1', total: 5000, contactName: 'Fatuma' }),
    );

    expect(repo.create).toHaveBeenCalledWith({
      type: 'NEW_ORDER',
      payload: { orderId: 'o1', total: 5000, contactName: 'Fatuma' },
    });

    expect(emitToOrg).toHaveBeenCalledTimes(1);
    expect(emitToOrg).toHaveBeenCalledWith('org1', 'notification.new', {
      notificationId: 'n1',
      type: 'NEW_ORDER',
    });
    // The socket payload must carry ids only: no key from the stored
    // payload body (order total, contact name, ...) leaks onto the wire.
    const [, , socketPayload] = emitToOrg.mock.calls[0] as [string, string, Record<string, unknown>];
    expect(Object.keys(socketPayload).sort()).toEqual(['notificationId', 'type']);
  });
});

describe('notificationService.notify owner WhatsApp alerts', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    repo.create.mockResolvedValue({
      id: 'n1',
      organizationId: 'org1',
      type: 'NEW_ORDER',
      payload: {},
      readAt: null,
      createdAt: new Date('2026-01-01T00:00:00Z'),
      updatedAt: new Date('2026-01-01T00:00:00Z'),
    });
  });

  it('relays a NEW_ORDER to the owner over WhatsApp when alerts are enabled and a channel is connected', async () => {
    organizationRepo.findCurrent.mockResolvedValue(
      organization({ ownerAlertsEnabled: true, ownerAlertPhone: '+255700000000' }),
    );
    channelRepo.list.mockResolvedValue([disconnectedChannel, connectedChannel]);
    contactRepo.upsertByPhone.mockResolvedValue({ ...ownerContact });
    conversationRepo.upsertForContact.mockResolvedValue({ id: 'conv1' });
    outboundService.sendText.mockResolvedValue({ id: 'msg1' });

    await runWithRequestContext(ctx, () =>
      notificationService.notify('NEW_ORDER', { orderId: 'order-000123', total: 5000, contactName: 'Fatuma' }),
    );

    expect(contactRepo.upsertByPhone).toHaveBeenCalledWith('+255700000000', 'Owner alerts');
    expect(contactRepo.setOptedIn).toHaveBeenCalledWith('contact-owner');
    expect(conversationRepo.upsertForContact).toHaveBeenCalledWith('chan1', 'contact-owner');
    expect(outboundService.sendText).toHaveBeenCalledWith({
      conversationId: 'conv1',
      body: 'New order 000123: 5000 TZS',
      authorType: 'SYSTEM',
      action: 'OWNER_ALERT',
    });
  });

  it('relays a LOW_STOCK alert with the expected one-liner body', async () => {
    organizationRepo.findCurrent.mockResolvedValue(
      organization({ ownerAlertsEnabled: true, ownerAlertPhone: '+255700000000' }),
    );
    channelRepo.list.mockResolvedValue([connectedChannel]);
    contactRepo.upsertByPhone.mockResolvedValue({ id: 'contact-owner', optedInAt: new Date('2026-01-01') });
    conversationRepo.upsertForContact.mockResolvedValue({ id: 'conv1' });
    outboundService.sendText.mockResolvedValue({ id: 'msg1' });

    await runWithRequestContext(ctx, () =>
      notificationService.notify('LOW_STOCK', { productId: 'p1', name: 'Bar Soap', stockQty: 2 }),
    );

    expect(outboundService.sendText).toHaveBeenCalledWith({
      conversationId: 'conv1',
      body: 'Low stock: Bar Soap (2 left)',
      authorType: 'SYSTEM',
      action: 'OWNER_ALERT',
    });
    // Already opted in: setOptedIn must not be called again.
    expect(contactRepo.setOptedIn).not.toHaveBeenCalled();
  });

  it('never relays a HANDOFF notification, even when alerts are enabled and a channel is connected', async () => {
    organizationRepo.findCurrent.mockResolvedValue(
      organization({ ownerAlertsEnabled: true, ownerAlertPhone: '+255700000000' }),
    );
    channelRepo.list.mockResolvedValue([connectedChannel]);

    await runWithRequestContext(ctx, () =>
      notificationService.notify('HANDOFF', { conversationId: 'conv9' }),
    );

    expect(organizationRepo.findCurrent).not.toHaveBeenCalled();
    expect(outboundService.sendText).not.toHaveBeenCalled();
  });

  it('does not relay when owner alerts are disabled', async () => {
    organizationRepo.findCurrent.mockResolvedValue(organization({ ownerAlertsEnabled: false }));

    await runWithRequestContext(ctx, () =>
      notificationService.notify('NEW_ORDER', { orderId: 'o1', total: 5000, contactName: 'Fatuma' }),
    );

    expect(channelRepo.list).not.toHaveBeenCalled();
    expect(outboundService.sendText).not.toHaveBeenCalled();
  });

  it('does not relay when no ownerAlertPhone is on file', async () => {
    organizationRepo.findCurrent.mockResolvedValue(organization({ ownerAlertsEnabled: true }));

    await runWithRequestContext(ctx, () =>
      notificationService.notify('NEW_ORDER', { orderId: 'o1', total: 5000, contactName: 'Fatuma' }),
    );

    expect(channelRepo.list).not.toHaveBeenCalled();
    expect(outboundService.sendText).not.toHaveBeenCalled();
  });

  it('does not relay and does not throw when no channel is CONNECTED', async () => {
    organizationRepo.findCurrent.mockResolvedValue(
      organization({ ownerAlertsEnabled: true, ownerAlertPhone: '+255700000000' }),
    );
    channelRepo.list.mockResolvedValue([disconnectedChannel]);

    await expect(
      runWithRequestContext(ctx, () =>
        notificationService.notify('NEW_ORDER', { orderId: 'o1', total: 5000, contactName: 'Fatuma' }),
      ),
    ).resolves.toBeUndefined();

    expect(contactRepo.upsertByPhone).not.toHaveBeenCalled();
    expect(outboundService.sendText).not.toHaveBeenCalled();
  });

  it('still resolves and logs a warning (ids only) when the relay throws', async () => {
    organizationRepo.findCurrent.mockResolvedValue(
      organization({ ownerAlertsEnabled: true, ownerAlertPhone: '+255700000000' }),
    );
    channelRepo.list.mockResolvedValue([connectedChannel]);
    contactRepo.upsertByPhone.mockRejectedValue(new Error('db unavailable'));

    await expect(
      runWithRequestContext(ctx, () =>
        notificationService.notify('NEW_ORDER', { orderId: 'o1', total: 5000, contactName: 'Fatuma' }),
      ),
    ).resolves.toBeUndefined();

    // The in-app notification still persisted and emitted despite the relay failure.
    expect(repo.create).toHaveBeenCalledTimes(1);
    expect(emitToOrg).toHaveBeenCalledTimes(1);
    expect(logger.warn).toHaveBeenCalledTimes(1);
    const [meta] = logger.warn.mock.calls[0] as [Record<string, unknown>, string];
    expect(Object.keys(meta).sort()).toEqual(['err', 'notificationId', 'type']);
  });

  it('skips the relay and warns with ids only when the payload is missing required fields', async () => {
    organizationRepo.findCurrent.mockResolvedValue(
      organization({ ownerAlertsEnabled: true, ownerAlertPhone: '+255700000000' }),
    );
    channelRepo.list.mockResolvedValue([connectedChannel]);

    await runWithRequestContext(ctx, () => notificationService.notify('NEW_ORDER', { contactName: 'Fatuma' }));

    expect(outboundService.sendText).not.toHaveBeenCalled();
    expect(contactRepo.upsertByPhone).not.toHaveBeenCalled();
    expect(logger.warn).toHaveBeenCalledTimes(1);
    const [meta] = logger.warn.mock.calls[0] as [Record<string, unknown>, string];
    expect(Object.keys(meta).sort()).toEqual(['notificationId', 'type']);
  });
});

describe('notificationService.list', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('filters to unread (readAt null) when unreadOnly is true, and maps rows to DTOs', async () => {
    repo.list.mockResolvedValue([
      {
        id: 'n1',
        type: 'LOW_STOCK',
        payload: { productId: 'p1', stockQty: 2 },
        readAt: null,
        createdAt: new Date('2026-01-02T00:00:00Z'),
      },
    ]);

    const result = await runWithRequestContext(ctx, () => notificationService.list(true));

    expect(repo.list).toHaveBeenCalledWith({ unreadOnly: true });
    expect(result).toEqual([
      {
        id: 'n1',
        type: 'LOW_STOCK',
        payload: { productId: 'p1', stockQty: 2 },
        readAt: null,
        createdAt: '2026-01-02T00:00:00.000Z',
      },
    ]);
  });

  it('defaults to all notifications when unreadOnly is omitted', async () => {
    repo.list.mockResolvedValue([]);

    await runWithRequestContext(ctx, () => notificationService.list());

    expect(repo.list).toHaveBeenCalledWith({ unreadOnly: undefined });
  });
});

describe('notificationService.markRead', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('sets readAt once and is idempotent: a second call never changes an already-set readAt', async () => {
    // Simulates the repository's guarded update (WHERE readAt IS NULL): the
    // first call sets it, the second is a no-op against an already-read row.
    let readAt: Date | null = null;
    repo.markRead.mockImplementation(() => {
      if (readAt === null) {
        readAt = new Date('2026-01-03T00:00:00Z');
      }
      return Promise.resolve();
    });

    await runWithRequestContext(ctx, () => notificationService.markRead('n1'));
    const afterFirst = readAt;
    expect(afterFirst).not.toBeNull();

    await runWithRequestContext(ctx, () => notificationService.markRead('n1'));

    expect(repo.markRead).toHaveBeenCalledTimes(2);
    expect(repo.markRead).toHaveBeenNthCalledWith(1, 'n1');
    expect(repo.markRead).toHaveBeenNthCalledWith(2, 'n1');
    expect(readAt).toBe(afterFirst);
  });
});

describe('notificationService.markAllRead', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('delegates to the repository', async () => {
    repo.markAllRead.mockResolvedValue(undefined);

    await runWithRequestContext(ctx, () => notificationService.markAllRead());

    expect(repo.markAllRead).toHaveBeenCalledTimes(1);
  });
});
