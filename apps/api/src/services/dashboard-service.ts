import type { AppointmentDto } from '@waos/shared';
import { aiReplyLogRepository } from '../repositories/ai-reply-log-repository.js';
import { appointmentRepository } from '../repositories/appointment-repository.js';
import { conversationRepository } from '../repositories/conversation-repository.js';
import { appointmentService } from './appointment-service.js';

export interface DashboardSummary {
  conversationsToday: number;
  pendingHandoffs: number;
  deflection: { replied: number; handedOff: number; percent: number | null };
  upcomingAppointments: AppointmentDto[];
}

export async function dashboardSummary(): Promise<DashboardSummary> {
  const weekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
  const [openToday, pendingToday, pendingAll, counts, upcoming] = await Promise.all([
    conversationRepository.countByStatusToday('OPEN'),
    conversationRepository.countByStatusToday('PENDING'),
    conversationRepository.list({ status: 'PENDING' }),
    aiReplyLogRepository.countsSince(weekAgo),
    appointmentRepository.upcoming(5),
  ]);
  const total = counts.replied + counts.handedOff;
  return {
    conversationsToday: openToday + pendingToday,
    pendingHandoffs: pendingAll.length,
    deflection: {
      replied: counts.replied,
      handedOff: counts.handedOff,
      percent: total > 0 ? Math.round((counts.replied / total) * 100) : null,
    },
    upcomingAppointments: upcoming.map((appointment) => appointmentService.toDto(appointment)),
  };
}
