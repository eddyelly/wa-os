// Inbound pipeline against a live database: webhook -> contact ->
// conversation -> message, idempotent on redelivery. Gated on
// INTEGRATION_DATABASE_URL (and uses the local redis for the ai-reply
// enqueue side effect).
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from './app.js';
import { config } from './lib/config.js';
import { basePrisma } from './lib/prisma.js';
import { closeQueues } from './lib/queues.js';
import { redis } from './lib/redis.js';

const databaseUrl = process.env.INTEGRATION_DATABASE_URL;

describe.skipIf(!databaseUrl)('evolution webhook inbound pipeline (live database)', () => {
  const app = createApp();
  let organizationId = '';
  let channelId = '';

  const upsertBody = (id: string, text: string): Record<string, unknown> => ({
    event: 'messages.upsert',
    instance: channelId,
    data: {
      key: { remoteJid: '255744000111@s.whatsapp.net', fromMe: false, id },
      pushName: 'Neema Customer',
      message: { conversation: text },
      messageTimestamp: 1_751_700_000,
    },
  });

  beforeAll(async () => {
    const organization = await basePrisma.organization.create({
      data: { name: 'Webhook Test Org' },
    });
    organizationId = organization.id;
    const channel = await basePrisma.channel.create({
      data: { organizationId, provider: 'evolution', status: 'CONNECTED' },
    });
    channelId = channel.id;
  });

  afterAll(async () => {
    await basePrisma.organization.delete({ where: { id: organizationId } });
    await closeQueues().catch(() => undefined);
    await redis.quit().catch(() => undefined);
    await basePrisma.$disconnect();
  });

  it('rejects a bad webhook secret', async () => {
    const response = await request(app)
      .post('/api/v1/webhooks/evolution/wrong-secret')
      .send(upsertBody('WH-SECRET', 'hello'));
    expect(response.status).toBe(401);
  });

  it('stores contact, conversation, and message from a text webhook', async () => {
    const response = await request(app)
      .post(`/api/v1/webhooks/evolution/${config.EVOLUTION_WEBHOOK_SECRET}`)
      .send(upsertBody('WH-1', 'Habari, naomba bei?'));
    expect(response.status).toBe(200);

    const contact = await basePrisma.contact.findFirst({
      where: { organizationId, phone: '+255744000111' },
    });
    expect(contact?.name).toBe('Neema Customer');

    const conversation = await basePrisma.conversation.findFirst({
      where: { organizationId, contactId: contact?.id },
    });
    expect(conversation?.status).toBe('OPEN');

    const message = await basePrisma.message.findFirst({
      where: { organizationId, providerMessageId: 'WH-1' },
    });
    expect(message?.body).toBe('Habari, naomba bei?');
    expect(message?.direction).toBe('IN');
    expect(message?.authorType).toBe('CONTACT');
  });

  it('is idempotent on webhook redelivery', async () => {
    await request(app)
      .post(`/api/v1/webhooks/evolution/${config.EVOLUTION_WEBHOOK_SECRET}`)
      .send(upsertBody('WH-1', 'Habari, naomba bei?'));
    const count = await basePrisma.message.count({
      where: { organizationId, providerMessageId: 'WH-1' },
    });
    expect(count).toBe(1);
  });

  it('updates the channel status from connection.update', async () => {
    const response = await request(app)
      .post(`/api/v1/webhooks/evolution/${config.EVOLUTION_WEBHOOK_SECRET}`)
      .send({ event: 'connection.update', instance: channelId, data: { state: 'open' } });
    expect(response.status).toBe(200);
    const channel = await basePrisma.channel.findUnique({ where: { id: channelId } });
    expect(channel?.status).toBe('CONNECTED');
    expect(channel?.warmupStartedAt).not.toBeNull();
  });

  it('silently accepts webhooks for unknown instances', async () => {
    const response = await request(app)
      .post(`/api/v1/webhooks/evolution/${config.EVOLUTION_WEBHOOK_SECRET}`)
      .send({ event: 'connection.update', instance: 'ghost-instance', data: { state: 'open' } });
    expect(response.status).toBe(200);
  });
});
