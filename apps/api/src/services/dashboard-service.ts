import type { OrderStatus } from '@prisma/client';
import type { AppointmentDto } from '@waos/shared';
import { aiReplyLogRepository } from '../repositories/ai-reply-log-repository.js';
import { appointmentRepository } from '../repositories/appointment-repository.js';
import { conversationRepository } from '../repositories/conversation-repository.js';
import { orderRepository } from '../repositories/order-repository.js';
import { organizationRepository } from '../repositories/organization-repository.js';
import { productRepository } from '../repositories/product-repository.js';
import { requireRequestContext } from '../lib/context.js';
import { appointmentService } from './appointment-service.js';

export interface SalesSummary {
  ordersToday: number;
  revenueAgreedThisWeek: number;
  pendingConfirmations: number;
  lowStockCount: number;
}

export interface DashboardSummary {
  conversationsToday: number;
  pendingHandoffs: number;
  deflection: { replied: number; handedOff: number; percent: number | null };
  upcomingAppointments: AppointmentDto[];
  sales?: SalesSummary;
}

// Orders whose value counts as "agreed" revenue: past the unconfirmed stage
// and not cancelled.
const CONFIRMED_SALE_STATUSES: OrderStatus[] = ['CONFIRMED', 'PAID', 'FULFILLED'];

async function salesSummary(weekAgo: Date): Promise<SalesSummary> {
  const startOfToday = new Date();
  startOfToday.setHours(0, 0, 0, 0);
  const [ordersToday, revenueAgreedThisWeek, pendingConfirmations, lowStockCount] = await Promise.all([
    orderRepository.countCreatedSince(startOfToday),
    orderRepository.sumAgreedSince(weekAgo, CONFIRMED_SALE_STATUSES),
    orderRepository.countByStatus('PENDING_CONFIRMATION'),
    productRepository.countLowStock(),
  ]);
  return { ordersToday, revenueAgreedThisWeek, pendingConfirmations, lowStockCount };
}

export async function dashboardSummary(): Promise<DashboardSummary> {
  const weekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
  const [openToday, pendingToday, pendingAll, counts, upcoming, organization] = await Promise.all([
    conversationRepository.countByStatusToday('OPEN'),
    conversationRepository.countByStatusToday('PENDING'),
    conversationRepository.list({ status: 'PENDING' }),
    aiReplyLogRepository.countsSince(weekAgo),
    appointmentRepository.upcoming(5),
    organizationRepository.findCurrent(requireRequestContext().organizationId),
  ]);
  const total = counts.replied + counts.handedOff;
  const summary: DashboardSummary = {
    conversationsToday: openToday + pendingToday,
    pendingHandoffs: pendingAll.length,
    deflection: {
      replied: counts.replied,
      handedOff: counts.handedOff,
      percent: total > 0 ? Math.round((counts.replied / total) * 100) : null,
    },
    upcomingAppointments: upcoming.map((appointment) => appointmentService.toDto(appointment)),
  };
  if (organization?.modules.includes('shop')) {
    summary.sales = await salesSummary(weekAgo);
  }
  return summary;
}
