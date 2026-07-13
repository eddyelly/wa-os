import { beforeEach, describe, expect, it, vi } from 'vitest';
import { runWithRequestContext } from '../lib/context.js';

// vi.hoisted is required because the vi.mock factories below are hoisted
// above these consts; a plain top-level const referenced from inside a
// factory would throw a temporal-dead-zone ReferenceError otherwise.
const { aiReplyLogRepo, appointmentRepo, conversationRepo, orderRepo, organizationRepo, productRepo } =
  vi.hoisted(() => ({
    aiReplyLogRepo: { countsSince: vi.fn() },
    appointmentRepo: { upcoming: vi.fn() },
    conversationRepo: { countByStatusToday: vi.fn(), list: vi.fn() },
    orderRepo: { countCreatedSince: vi.fn(), sumAgreedSince: vi.fn(), countByStatus: vi.fn() },
    organizationRepo: { findCurrent: vi.fn() },
    productRepo: { countLowStock: vi.fn() },
  }));

vi.mock('../repositories/ai-reply-log-repository.js', () => ({ aiReplyLogRepository: aiReplyLogRepo }));
vi.mock('../repositories/appointment-repository.js', () => ({ appointmentRepository: appointmentRepo }));
vi.mock('../repositories/conversation-repository.js', () => ({ conversationRepository: conversationRepo }));
vi.mock('../repositories/order-repository.js', () => ({ orderRepository: orderRepo }));
vi.mock('../repositories/organization-repository.js', () => ({ organizationRepository: organizationRepo }));
vi.mock('../repositories/product-repository.js', () => ({ productRepository: productRepo }));

import { dashboardSummary } from './dashboard-service.js';

const ctx = { organizationId: 'org1', userId: 'u1', role: 'OWNER' as const };

beforeEach(() => {
  vi.clearAllMocks();
  conversationRepo.countByStatusToday.mockResolvedValue(0);
  conversationRepo.list.mockResolvedValue([]);
  aiReplyLogRepo.countsSince.mockResolvedValue({ replied: 0, handedOff: 0 });
  appointmentRepo.upcoming.mockResolvedValue([]);
  orderRepo.countCreatedSince.mockResolvedValue(0);
  orderRepo.sumAgreedSince.mockResolvedValue(0);
  orderRepo.countByStatus.mockResolvedValue(0);
  productRepo.countLowStock.mockResolvedValue(0);
});

describe('dashboardSummary', () => {
  it('includes sales KPIs for a shop organization', async () => {
    organizationRepo.findCurrent.mockResolvedValue({ id: 'org1', modules: ['shop'] });
    orderRepo.countCreatedSince.mockResolvedValue(3);
    orderRepo.sumAgreedSince.mockResolvedValue(120000);
    orderRepo.countByStatus.mockResolvedValue(2);
    productRepo.countLowStock.mockResolvedValue(4);

    const result = await runWithRequestContext(ctx, () => dashboardSummary());

    expect(result.sales).toEqual({
      ordersToday: 3,
      revenueAgreedThisWeek: 120000,
      pendingConfirmations: 2,
      lowStockCount: 4,
    });
    expect(orderRepo.countByStatus).toHaveBeenCalledWith('PENDING_CONFIRMATION');
    expect(orderRepo.sumAgreedSince).toHaveBeenCalledWith(expect.any(Date), ['CONFIRMED', 'PAID', 'FULFILLED']);
  });

  it('omits sales KPIs for an appointments-only organization', async () => {
    organizationRepo.findCurrent.mockResolvedValue({ id: 'org1', modules: ['appointments'] });

    const result = await runWithRequestContext(ctx, () => dashboardSummary());

    expect(result.sales).toBeUndefined();
    expect(orderRepo.countByStatus).not.toHaveBeenCalled();
    expect(productRepo.countLowStock).not.toHaveBeenCalled();
  });

  it('still returns booking stats and deflection percent', async () => {
    organizationRepo.findCurrent.mockResolvedValue({ id: 'org1', modules: ['appointments'] });
    conversationRepo.countByStatusToday.mockImplementation((status: string) =>
      Promise.resolve(status === 'OPEN' ? 5 : 2),
    );
    conversationRepo.list.mockResolvedValue([{ id: 'c1' }, { id: 'c2' }]);
    aiReplyLogRepo.countsSince.mockResolvedValue({ replied: 8, handedOff: 2 });

    const result = await runWithRequestContext(ctx, () => dashboardSummary());

    expect(result.conversationsToday).toBe(7);
    expect(result.pendingHandoffs).toBe(2);
    expect(result.deflection).toEqual({ replied: 8, handedOff: 2, percent: 80 });
  });
});
