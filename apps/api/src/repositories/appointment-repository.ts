import type { Appointment, AppointmentStatus, Contact } from '@prisma/client';
import { requireRequestContext } from '../lib/context.js';
import { prisma } from '../lib/prisma.js';

export type AppointmentWithContact = Appointment & { contact: Contact };

export const appointmentRepository = {
  create(data: {
    contactId: string;
    serviceName: string;
    notes?: string;
    startsAt: Date;
    endsAt: Date;
  }): Promise<AppointmentWithContact> {
    return prisma.appointment.create({
      data: {
        ...data,
        notes: data.notes ?? null,
        organizationId: requireRequestContext().organizationId,
      },
      include: { contact: true },
    });
  },

  findById(id: string): Promise<AppointmentWithContact | null> {
    return prisma.appointment.findUnique({ where: { id }, include: { contact: true } });
  },

  list(range: { from: Date; to: Date }): Promise<AppointmentWithContact[]> {
    return prisma.appointment.findMany({
      where: { startsAt: { gte: range.from, lt: range.to } },
      include: { contact: true },
      orderBy: { startsAt: 'asc' },
    });
  },

  update(
    id: string,
    data: Partial<{
      serviceName: string;
      notes: string | null;
      startsAt: Date;
      endsAt: Date;
      status: AppointmentStatus;
      reminderJobIds: string[];
    }>,
  ): Promise<AppointmentWithContact> {
    return prisma.appointment.update({ where: { id }, data, include: { contact: true } });
  },

  countNoShowsSince(since: Date): Promise<number> {
    return prisma.appointment.count({
      where: { status: 'NO_SHOW', updatedAt: { gte: since } },
    });
  },

  countRemindersSentSince(since: Date): Promise<number> {
    // Reminders are the only SYSTEM-authored messages in this phase.
    return prisma.message.count({
      where: { authorType: 'SYSTEM', direction: 'OUT', createdAt: { gte: since } },
    });
  },

  upcoming(limit = 5): Promise<AppointmentWithContact[]> {
    return prisma.appointment.findMany({
      where: { startsAt: { gte: new Date() }, status: { in: ['BOOKED', 'REMINDED'] } },
      include: { contact: true },
      orderBy: { startsAt: 'asc' },
      take: limit,
    });
  },
};
