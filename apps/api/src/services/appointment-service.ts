import type { AppointmentStatus } from '@prisma/client';
import type { AppointmentDto, CreateAppointmentRequest, WeeklyStats } from '@waos/shared';
import { config } from '../lib/config.js';
import { requireRequestContext } from '../lib/context.js';
import { NotFoundError, ValidationError } from '../lib/errors.js';
import { cancelReminder, enqueueReminder } from '../lib/queues.js';
import {
  appointmentRepository,
  type AppointmentWithContact,
} from '../repositories/appointment-repository.js';
import { contactRepository } from '../repositories/contact-repository.js';
import { planReminders } from './reminders.js';

const TERMINAL_STATUSES: AppointmentStatus[] = ['CANCELLED', 'COMPLETED', 'NO_SHOW'];

function toDto(appointment: AppointmentWithContact): AppointmentDto {
  return {
    id: appointment.id,
    serviceName: appointment.serviceName,
    notes: appointment.notes,
    startsAt: appointment.startsAt,
    endsAt: appointment.endsAt,
    status: appointment.status,
    contact: {
      id: appointment.contact.id,
      name: appointment.contact.name,
      phone: appointment.contact.phone,
      optedInAt: appointment.contact.optedInAt,
    },
  };
}

async function scheduleReminders(appointmentId: string, startsAt: Date): Promise<string[]> {
  const { organizationId } = requireRequestContext();
  const planned = planReminders(startsAt, new Date(), config.REMINDER_OFFSETS_MINUTES);
  const jobIds: string[] = [];
  for (const reminder of planned) {
    jobIds.push(
      await enqueueReminder(
        { organizationId, appointmentId, offset: reminder.offset },
        reminder.delayMs,
      ),
    );
  }
  return jobIds;
}

async function cancelReminders(jobIds: string[]): Promise<void> {
  for (const jobId of jobIds) {
    await cancelReminder(jobId);
  }
}

export const appointmentService = {
  toDto,

  async create(input: CreateAppointmentRequest): Promise<AppointmentDto> {
    const contact = await contactRepository.findById(input.contactId);
    if (!contact) {
      throw new NotFoundError('This customer no longer exists.');
    }
    if (input.startsAt.getTime() <= Date.now()) {
      throw new ValidationError('The appointment must be in the future.');
    }
    const appointment = await appointmentRepository.create({
      contactId: contact.id,
      serviceName: input.serviceName,
      notes: input.notes,
      startsAt: input.startsAt,
      endsAt: input.endsAt,
    });
    const jobIds = await scheduleReminders(appointment.id, appointment.startsAt);
    const updated = await appointmentRepository.update(appointment.id, {
      reminderJobIds: jobIds,
    });
    return toDto(updated);
  },

  async listWeek(fromIso?: string): Promise<AppointmentDto[]> {
    const from = fromIso ? new Date(fromIso) : new Date();
    if (Number.isNaN(from.getTime())) {
      throw new ValidationError('Invalid date.');
    }
    from.setHours(0, 0, 0, 0);
    const to = new Date(from.getTime() + 7 * 24 * 60 * 60 * 1000);
    const rows = await appointmentRepository.list({ from, to });
    return rows.map(toDto);
  },

  /**
   * Moving an appointment reschedules its reminders; cancelling or closing
   * it removes them. Idempotent: reminder jobs are keyed per appointment
   * and offset.
   */
  async reschedule(
    id: string,
    input: { serviceName?: string; notes?: string; startsAt?: Date; endsAt?: Date },
  ): Promise<AppointmentDto> {
    const appointment = await appointmentRepository.findById(id);
    if (!appointment) {
      throw new NotFoundError('This appointment no longer exists.');
    }
    const timeChanged =
      input.startsAt !== undefined &&
      input.startsAt.getTime() !== appointment.startsAt.getTime();
    let reminderJobIds = appointment.reminderJobIds;
    if (timeChanged && !TERMINAL_STATUSES.includes(appointment.status)) {
      await cancelReminders(appointment.reminderJobIds);
      reminderJobIds = await scheduleReminders(appointment.id, input.startsAt ?? appointment.startsAt);
    }
    const updated = await appointmentRepository.update(id, {
      ...(input.serviceName !== undefined ? { serviceName: input.serviceName } : {}),
      ...(input.notes !== undefined ? { notes: input.notes } : {}),
      ...(input.startsAt !== undefined ? { startsAt: input.startsAt } : {}),
      ...(input.endsAt !== undefined ? { endsAt: input.endsAt } : {}),
      reminderJobIds,
    });
    return toDto(updated);
  },

  async setStatus(id: string, status: AppointmentStatus): Promise<AppointmentDto> {
    const appointment = await appointmentRepository.findById(id);
    if (!appointment) {
      throw new NotFoundError('This appointment no longer exists.');
    }
    if (TERMINAL_STATUSES.includes(status)) {
      await cancelReminders(appointment.reminderJobIds);
    }
    const updated = await appointmentRepository.update(id, {
      status,
      ...(TERMINAL_STATUSES.includes(status) ? { reminderJobIds: [] } : {}),
    });
    return toDto(updated);
  },

  async weeklyStats(): Promise<WeeklyStats> {
    const weekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
    const [remindersSent, noShowsMarked] = await Promise.all([
      appointmentRepository.countRemindersSentSince(weekAgo),
      appointmentRepository.countNoShowsSince(weekAgo),
    ]);
    return { remindersSent, noShowsMarked };
  },
};
