import { beforeEach, describe, expect, it, vi } from 'vitest';
import { runWithRequestContext } from '../lib/context.js';

// vi.hoisted is required (see product-service.test.ts / order-service.test.ts)
// because the vi.mock factories below are hoisted above these consts; a
// plain top-level const referenced from inside a factory would throw a
// temporal-dead-zone ReferenceError otherwise.
const { repo, emitToOrg } = vi.hoisted(() => ({
  repo: {
    create: vi.fn(),
    list: vi.fn(),
    markRead: vi.fn(),
    markAllRead: vi.fn(),
  },
  emitToOrg: vi.fn(),
}));

vi.mock('../repositories/notification-repository.js', () => ({ notificationRepository: repo }));
vi.mock('../sockets/gateway.js', () => ({ emitToOrg }));

import { notificationService } from './notification-service.js';

const ctx = { organizationId: 'org1', userId: 'u1', role: 'OWNER' as const };

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
