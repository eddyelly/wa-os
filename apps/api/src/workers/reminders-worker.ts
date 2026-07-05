import { Worker } from 'bullmq';
import { reminderJobSchema, type ReminderJob } from '@waos/shared';
import { requireRequestContext, runWithRequestContext } from '../lib/context.js';
import { logger } from '../lib/logger.js';
import { QUEUE_NAMES } from '../lib/queues.js';
import { redisConnectionOptions } from '../lib/redis.js';
import { appointmentRepository } from '../repositories/appointment-repository.js';
import { channelRepository } from '../repositories/channel-repository.js';
import { conversationRepository } from '../repositories/conversation-repository.js';
import { organizationRepository } from '../repositories/organization-repository.js';
import { outboundService } from '../services/outbound-service.js';
import { renderReminder } from '../services/reminders.js';

/**
 * Delayed reminder jobs go through the same policy + send pipeline as
 * everything else. The policy engine enforces opt-in
 * (REMINDER_OPTED_IN blocks with OPT_IN_REQUIRED when the contact never
 * consented), so an un-consented reminder is stored BLOCKED, never sent.
 */
export async function processReminderJob(payload: ReminderJob): Promise<void> {
  await runWithRequestContext(
    { organizationId: payload.organizationId, userId: 'worker:reminders', role: 'OWNER' },
    async () => {
      const appointment = await appointmentRepository.findById(payload.appointmentId);
      if (!appointment) {
        return;
      }
      if (['CANCELLED', 'COMPLETED', 'NO_SHOW'].includes(appointment.status)) {
        return; // cancelled or already resolved: reminder is moot
      }
      if (appointment.startsAt.getTime() < Date.now()) {
        return; // appointment already started; do not remind after the fact
      }
      const organization = await organizationRepository.findCurrent(
        requireRequestContext().organizationId,
      );
      if (!organization) {
        return;
      }
      const channels = await channelRepository.list();
      const channel = channels.find((c) => c.status === 'CONNECTED') ?? channels[0];
      if (!channel) {
        logger.warn({ appointmentId: appointment.id }, 'no channel to send reminder through');
        return;
      }
      const conversation = await conversationRepository.upsertForContact(
        channel.id,
        appointment.contactId,
      );
      const body = renderReminder({
        language: appointment.contact.language ?? organization.language,
        name: appointment.contact.name,
        service: appointment.serviceName,
        startsAt: appointment.startsAt,
        timezone: organization.timezone,
        business: organization.name,
      });
      await outboundService.sendText({
        conversationId: conversation.id,
        body,
        authorType: 'SYSTEM',
        action: 'REMINDER_OPTED_IN',
      });
      if (appointment.status === 'BOOKED') {
        await appointmentRepository.update(appointment.id, { status: 'REMINDED' });
      }
      logger.info(
        { appointmentId: appointment.id, offset: payload.offset },
        'reminder dispatched to send pipeline',
      );
    },
  );
}

export function startRemindersWorker(): Worker<ReminderJob> {
  const worker = new Worker<ReminderJob>(
    QUEUE_NAMES.reminders,
    async (job) => {
      await processReminderJob(reminderJobSchema.parse(job.data));
    },
    { connection: redisConnectionOptions(), concurrency: 2 },
  );
  worker.on('error', (error) => {
    logger.error({ err: error }, 'reminders worker error');
  });
  worker.on('failed', (job, error) => {
    logger.error(
      { err: error, jobId: job?.id, appointmentId: job?.data.appointmentId },
      'reminder job failed',
    );
  });
  return worker;
}
