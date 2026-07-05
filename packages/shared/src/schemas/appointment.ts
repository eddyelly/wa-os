import { z } from 'zod';

export const appointmentStatusSchema = z.enum([
  'BOOKED',
  'REMINDED',
  'COMPLETED',
  'NO_SHOW',
  'CANCELLED',
]);
export type AppointmentStatus = z.infer<typeof appointmentStatusSchema>;

export const createAppointmentRequestSchema = z
  .object({
    contactId: z.string().min(1),
    serviceName: z.string().trim().min(2).max(120),
    notes: z.string().trim().max(1000).optional(),
    startsAt: z.coerce.date(),
    endsAt: z.coerce.date(),
  })
  .refine((value) => value.endsAt > value.startsAt, {
    message: 'endsAt must be after startsAt',
    path: ['endsAt'],
  });
export type CreateAppointmentRequest = z.infer<typeof createAppointmentRequestSchema>;

export const updateAppointmentRequestSchema = z.object({
  serviceName: z.string().trim().min(2).max(120).optional(),
  notes: z.string().trim().max(1000).optional(),
  startsAt: z.coerce.date().optional(),
  endsAt: z.coerce.date().optional(),
});

export const setAppointmentStatusRequestSchema = z.object({
  status: appointmentStatusSchema,
});

export const appointmentSchema = z.object({
  id: z.string(),
  serviceName: z.string(),
  notes: z.string().nullable(),
  startsAt: z.coerce.date(),
  endsAt: z.coerce.date(),
  status: appointmentStatusSchema,
  contact: z.object({
    id: z.string(),
    name: z.string().nullable(),
    phone: z.string(),
    optedInAt: z.coerce.date().nullable(),
  }),
});
export type AppointmentDto = z.infer<typeof appointmentSchema>;

export const weeklyStatsSchema = z.object({
  remindersSent: z.number(),
  noShowsMarked: z.number(),
});
export type WeeklyStats = z.infer<typeof weeklyStatsSchema>;
