import type {
  ConnectResult,
  IncomingMessage,
  IncomingMessageType,
  MediaRef,
  MessagingPort,
  QuotedRef,
  SendResult,
  SessionStatus,
} from '@waos/ports';
import { NotImplementedError } from '../../lib/errors.js';
import {
  connectionUpdateDataSchema,
  messagesUpdateDataSchema,
  messagesUpsertDataSchema,
  qrcodeUpdatedDataSchema,
  webhookEnvelopeSchema,
  type WebhookEnvelope,
} from './evolution-schemas.js';
import { evolutionClient, toProviderNumber } from './evolution-client.js';

// One Evolution instance per Channel; the instance name IS the channel id.
// Everything Evolution-specific stays inside this directory.

export type ProviderMessageStatus = 'SENT' | 'DELIVERED' | 'READ';

export type NormalizedEvent =
  | { kind: 'message'; message: IncomingMessage }
  | { kind: 'message_status'; providerMessageId: string; status: ProviderMessageStatus }
  | { kind: 'status'; status: SessionStatus }
  | { kind: 'qr'; code: string; base64?: string }
  | { kind: 'ignored'; reason: string };

function mapAckStatus(status: string): ProviderMessageStatus | null {
  switch (status) {
    case 'SERVER_ACK':
      return 'SENT';
    case 'DELIVERY_ACK':
      return 'DELIVERED';
    case 'READ':
    case 'PLAYED':
      return 'READ';
    default:
      return null;
  }
}

function mapState(state: string): SessionStatus {
  switch (state) {
    case 'open':
      return 'CONNECTED';
    case 'connecting':
      return 'PENDING';
    case 'close':
    case 'refused':
      return 'DISCONNECTED';
    default:
      return 'DISCONNECTED';
  }
}

function jidToPhone(jid: string): string {
  const [user] = jid.split('@');
  return `+${(user ?? '').split(':')[0] ?? ''}`;
}

export class EvolutionAdapter implements MessagingPort {
  async sendText(
    channelId: string,
    to: string,
    text: string,
    quoted?: QuotedRef,
  ): Promise<SendResult> {
    const providerMessageId = await evolutionClient.sendText(
      channelId,
      toProviderNumber(to),
      text,
      quoted,
    );
    return { providerMessageId };
  }

  async sendMedia(
    channelId: string,
    to: string,
    media: MediaRef,
    caption?: string,
    quoted?: QuotedRef,
  ): Promise<SendResult> {
    if (media.kind !== 'url') {
      throw new NotImplementedError('Only URL media sends are supported on the entry tier.');
    }
    const mediatype = media.mimeType.startsWith('image/')
      ? 'image'
      : media.mimeType.startsWith('audio/')
        ? 'audio'
        : 'document';
    const providerMessageId = await evolutionClient.sendMedia(
      channelId,
      toProviderNumber(to),
      { mediatype, mimetype: media.mimeType, url: media.url },
      caption,
      media.fileName,
      quoted,
    );
    return { providerMessageId };
  }

  sendTemplate(): Promise<SendResult> {
    // Templates are a Cloud API concept; the policy engine never routes them here.
    return Promise.reject(
      new NotImplementedError('Template messages are not available on the entry tier.'),
    );
  }

  async getSessionStatus(channelId: string): Promise<SessionStatus> {
    const state = await evolutionClient.connectionState(channelId);
    return mapState(state);
  }

  async connect(channelId: string): Promise<ConnectResult> {
    const qr = await evolutionClient.connect(channelId);
    if (qr.code) {
      return { status: 'QR_READY', qr: { code: qr.code, base64: qr.base64 } };
    }
    // No QR usually means the session is already up; confirm with the state.
    const status = await this.getSessionStatus(channelId);
    return { status };
  }

  async disconnect(channelId: string): Promise<void> {
    await evolutionClient.logout(channelId);
  }

  /** Provision the provider-side instance for a new channel. */
  async createInstance(channelId: string, webhookUrl: string): Promise<void> {
    await evolutionClient.createInstance(channelId, webhookUrl);
  }

  async deleteInstance(channelId: string): Promise<void> {
    await evolutionClient.deleteInstance(channelId);
  }

  /** Resolve provider media to bytes for storage in MinIO. */
  async downloadMedia(
    channelId: string,
    providerMessageId: string,
  ): Promise<{ data: Buffer; mimeType: string; fileName?: string }> {
    const media = await evolutionClient.getMediaBase64(channelId, providerMessageId);
    return {
      data: Buffer.from(media.base64, 'base64'),
      mimeType: media.mimetype ?? 'application/octet-stream',
      fileName: media.fileName,
    };
  }

  /**
   * Normalize a webhook delivery to a provider-agnostic event. Returns
   * 'ignored' for anything the core has no business seeing.
   */
  normalizeWebhookEvent(body: unknown): { channelId: string; event: NormalizedEvent } | null {
    const parsed = webhookEnvelopeSchema.safeParse(body);
    if (!parsed.success) {
      return null;
    }
    const envelope: WebhookEnvelope = parsed.data;
    const channelId = envelope.instance;

    switch (envelope.event) {
      case 'connection.update': {
        const data = connectionUpdateDataSchema.safeParse(envelope.data);
        if (!data.success || !data.data.state) {
          return { channelId, event: { kind: 'ignored', reason: 'malformed-connection-update' } };
        }
        return { channelId, event: { kind: 'status', status: mapState(data.data.state) } };
      }
      case 'qrcode.updated': {
        const data = qrcodeUpdatedDataSchema.safeParse(envelope.data);
        const code = data.success ? data.data.qrcode?.code : undefined;
        if (!code) {
          return { channelId, event: { kind: 'ignored', reason: 'malformed-qr-update' } };
        }
        return {
          channelId,
          event: { kind: 'qr', code, base64: data.success ? data.data.qrcode?.base64 : undefined },
        };
      }
      case 'messages.update': {
        const data = messagesUpdateDataSchema.safeParse(envelope.data);
        if (!data.success) {
          return { channelId, event: { kind: 'ignored', reason: 'malformed-message-update' } };
        }
        const providerMessageId = data.data.keyId ?? data.data.key?.id;
        const status = data.data.status ? mapAckStatus(data.data.status) : null;
        if (!providerMessageId || !status) {
          return { channelId, event: { kind: 'ignored', reason: 'unmapped-message-update' } };
        }
        return { channelId, event: { kind: 'message_status', providerMessageId, status } };
      }
      case 'messages.upsert': {
        const data = messagesUpsertDataSchema.safeParse(envelope.data);
        if (!data.success) {
          return { channelId, event: { kind: 'ignored', reason: 'malformed-message' } };
        }
        const msg = data.data;
        if (msg.key.fromMe) {
          return { channelId, event: { kind: 'ignored', reason: 'own-message' } };
        }
        if (!msg.key.remoteJid.endsWith('@s.whatsapp.net')) {
          // Groups, broadcast lists, and newsletters are out of scope.
          return { channelId, event: { kind: 'ignored', reason: 'non-direct-chat' } };
        }
        const content = msg.message ?? {};
        let type: IncomingMessageType = 'OTHER';
        let text: string | undefined;
        let media: IncomingMessage['media'];
        if (typeof content.conversation === 'string' && content.conversation.length > 0) {
          type = 'TEXT';
          text = content.conversation;
        } else if (content.extendedTextMessage?.text) {
          type = 'TEXT';
          text = content.extendedTextMessage.text;
        } else if (content.imageMessage) {
          type = 'IMAGE';
          text = content.imageMessage.caption;
          media = {
            providerRef: msg.key.id,
            mimeType: content.imageMessage.mimetype ?? 'image/jpeg',
          };
        } else if (content.audioMessage) {
          type = 'AUDIO';
          media = {
            providerRef: msg.key.id,
            mimeType: content.audioMessage.mimetype ?? 'audio/ogg',
          };
        } else if (content.documentMessage) {
          type = 'DOCUMENT';
          text = content.documentMessage.caption;
          media = {
            providerRef: msg.key.id,
            mimeType: content.documentMessage.mimetype ?? 'application/octet-stream',
            fileName: content.documentMessage.fileName,
          };
        } else if (content.locationMessage) {
          type = 'LOCATION';
          const lat = content.locationMessage.degreesLatitude;
          const lng = content.locationMessage.degreesLongitude;
          text = lat !== undefined && lng !== undefined ? `${lat},${lng}` : undefined;
        } else if (content.videoMessage) {
          type = 'OTHER';
          text = content.videoMessage.caption;
        }

        const quotedProviderMessageId =
          content.extendedTextMessage?.contextInfo?.stanzaId ??
          content.imageMessage?.contextInfo?.stanzaId ??
          content.audioMessage?.contextInfo?.stanzaId ??
          content.documentMessage?.contextInfo?.stanzaId ??
          content.videoMessage?.contextInfo?.stanzaId ??
          undefined;

        const timestamp =
          msg.messageTimestamp !== undefined ? Number(msg.messageTimestamp) * 1000 : NaN;
        const message: IncomingMessage = {
          channelId,
          providerMessageId: msg.key.id,
          from: jidToPhone(msg.key.remoteJid),
          contactName: msg.pushName,
          type,
          text,
          media,
          sentAt: Number.isFinite(timestamp) ? new Date(timestamp) : new Date(),
          quotedProviderMessageId,
        };
        return { channelId, event: { kind: 'message', message } };
      }
      default:
        return { channelId, event: { kind: 'ignored', reason: `unhandled-event` } };
    }
  }
}

export const evolutionAdapter = new EvolutionAdapter();
