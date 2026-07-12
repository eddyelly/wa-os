import { z } from 'zod';
import { appointmentSchema } from './appointment.js';

export const dashboardSummarySchema = z.object({
  conversationsToday: z.number().int(),
  pendingHandoffs: z.number().int(),
  deflection: z.object({
    replied: z.number().int(),
    handedOff: z.number().int(),
    percent: z.number().nullable(),
  }),
  upcomingAppointments: z.array(appointmentSchema),
});
export type DashboardSummaryDto = z.infer<typeof dashboardSummarySchema>;
