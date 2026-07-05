import { describe, expect, it } from 'vitest';
import { evolutionAdapter } from './evolution-adapter.js';

const CHANNEL = 'channel-1';

function envelope(event: string, data: unknown): unknown {
  return { event, instance: CHANNEL, data, sender: 'x', server_url: 'http://evo' };
}

describe('evolution webhook normalization', () => {
  it('normalizes a plain text message', () => {
    const result = evolutionAdapter.normalizeWebhookEvent(
      envelope('messages.upsert', {
        key: { remoteJid: '255712345678@s.whatsapp.net', fromMe: false, id: 'MSG1' },
        pushName: 'Asha',
        message: { conversation: 'Habari, bei ya rasta?' },
        messageTimestamp: 1_751_700_000,
      }),
    );
    expect(result?.channelId).toBe(CHANNEL);
    expect(result?.event).toMatchObject({
      kind: 'message',
      message: {
        providerMessageId: 'MSG1',
        from: '+255712345678',
        contactName: 'Asha',
        type: 'TEXT',
        text: 'Habari, bei ya rasta?',
      },
    });
  });

  it('normalizes an extended text message', () => {
    const result = evolutionAdapter.normalizeWebhookEvent(
      envelope('messages.upsert', {
        key: { remoteJid: '255700000001@s.whatsapp.net', fromMe: false, id: 'MSG2' },
        message: { extendedTextMessage: { text: 'with link preview' } },
      }),
    );
    expect(result?.event).toMatchObject({ kind: 'message', message: { type: 'TEXT' } });
  });

  it('normalizes an image message with media ref', () => {
    const result = evolutionAdapter.normalizeWebhookEvent(
      envelope('messages.upsert', {
        key: { remoteJid: '255700000001@s.whatsapp.net', fromMe: false, id: 'MSG3' },
        message: { imageMessage: { caption: 'picha', mimetype: 'image/jpeg' } },
      }),
    );
    expect(result?.event).toMatchObject({
      kind: 'message',
      message: {
        type: 'IMAGE',
        text: 'picha',
        media: { providerRef: 'MSG3', mimeType: 'image/jpeg' },
      },
    });
  });

  it('normalizes a location message', () => {
    const result = evolutionAdapter.normalizeWebhookEvent(
      envelope('messages.upsert', {
        key: { remoteJid: '255700000001@s.whatsapp.net', fromMe: false, id: 'MSG4' },
        message: { locationMessage: { degreesLatitude: -6.8, degreesLongitude: 39.28 } },
      }),
    );
    expect(result?.event).toMatchObject({
      kind: 'message',
      message: { type: 'LOCATION', text: '-6.8,39.28' },
    });
  });

  it('ignores own messages and group chats', () => {
    expect(
      evolutionAdapter.normalizeWebhookEvent(
        envelope('messages.upsert', {
          key: { remoteJid: '255700000001@s.whatsapp.net', fromMe: true, id: 'MSG5' },
          message: { conversation: 'me' },
        }),
      )?.event.kind,
    ).toBe('ignored');
    expect(
      evolutionAdapter.normalizeWebhookEvent(
        envelope('messages.upsert', {
          key: { remoteJid: '1203630@g.us', fromMe: false, id: 'MSG6' },
          message: { conversation: 'group chatter' },
        }),
      )?.event.kind,
    ).toBe('ignored');
  });

  it('maps connection.update states to session statuses', () => {
    for (const [state, status] of [
      ['open', 'CONNECTED'],
      ['connecting', 'PENDING'],
      ['close', 'DISCONNECTED'],
    ] as const) {
      const result = evolutionAdapter.normalizeWebhookEvent(
        envelope('connection.update', { state }),
      );
      expect(result?.event).toEqual({ kind: 'status', status });
    }
  });

  it('normalizes QR updates', () => {
    const result = evolutionAdapter.normalizeWebhookEvent(
      envelope('qrcode.updated', { qrcode: { code: 'QRDATA', base64: 'data:image/png;base64,x' } }),
    );
    expect(result?.event).toEqual({
      kind: 'qr',
      code: 'QRDATA',
      base64: 'data:image/png;base64,x',
    });
  });

  it('maps delivery acks and keeps unknown ones ignored', () => {
    expect(
      evolutionAdapter.normalizeWebhookEvent(
        envelope('messages.update', { keyId: 'MSG7', status: 'DELIVERY_ACK' }),
      )?.event,
    ).toEqual({ kind: 'message_status', providerMessageId: 'MSG7', status: 'DELIVERED' });
    expect(
      evolutionAdapter.normalizeWebhookEvent(
        envelope('messages.update', { keyId: 'MSG8', status: 'PENDING' }),
      )?.event.kind,
    ).toBe('ignored');
  });

  it('ignores unhandled events and rejects unparseable envelopes', () => {
    expect(
      evolutionAdapter.normalizeWebhookEvent(envelope('contacts.update', {}))?.event.kind,
    ).toBe('ignored');
    expect(evolutionAdapter.normalizeWebhookEvent({ nonsense: true })).toBeNull();
  });
});
