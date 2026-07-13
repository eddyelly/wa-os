import { z } from 'zod';
import { appointmentSchema } from './appointment.js';

export const salesSummarySchema = z.object({
  ordersToday: z.number().int(),
  revenueAgreedThisWeek: z.number().int(),
  pendingConfirmations: z.number().int(),
  lowStockCount: z.number().int(),
});
export type SalesSummaryDto = z.infer<typeof salesSummarySchema>;

export const dashboardSummarySchema = z.object({
  conversationsToday: z.number().int(),
  pendingHandoffs: z.number().int(),
  deflection: z.object({
    replied: z.number().int(),
    handedOff: z.number().int(),
    percent: z.number().nullable(),
  }),
  upcomingAppointments: z.array(appointmentSchema),
  sales: salesSummarySchema.optional(),
});
export type DashboardSummaryDto = z.infer<typeof dashboardSummarySchema>;
