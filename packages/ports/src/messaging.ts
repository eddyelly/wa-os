/**
 * The MessagingPort contract (CLAUDE.md 3.1).
 * The application core only ever talks to a provider through this interface.
 * Provider payloads never leak past the adapter boundary: inbound events are
 * normalized to IncomingMessage before they touch the core.
 */

export type SessionStatus = 'PENDING' | 'QR_READY' | 'CONNECTED' | 'DISCONNECTED' | 'BANNED';

export interface SendResult {
  providerMessageId: string;
}

export type MediaRef =
  | { kind: 'url'; url: string; mimeType: string; fileName?: string }
  | { kind: 'storage'; key: string; mimeType: string; fileName?: string };

export interface ConnectResult {
  status: SessionStatus;
  /** QR payload for the entry tier; absent for providers that connect without one. */
  qr?: {
    code: string;
    /** data URL image of the QR code when the provider supplies one */
    base64?: string;
  };
}

export type IncomingMessageType = 'TEXT' | 'IMAGE' | 'AUDIO' | 'DOCUMENT' | 'LOCATION' | 'OTHER';

export interface IncomingMedia {
  /** provider download reference, resolved and copied to MinIO by the inbound pipeline */
  providerRef: string;
  mimeType: string;
  fileName?: string;
}

export interface IncomingMessage {
  channelId: string;
  providerMessageId: string;
  /** sender phone in E.164 */
  from: string;
  contactName?: string;
  type: IncomingMessageType;
  text?: string;
  media?: IncomingMedia;
  sentAt: Date;
}

export interface MessagingPort {
  sendText(channelId: string, to: string, text: string): Promise<SendResult>;
  sendMedia(channelId: string, to: string, media: MediaRef, caption?: string): Promise<SendResult>;
  /** Cloud API only; the entry tier adapter rejects this. */
  sendTemplate(
    channelId: string,
    to: string,
    templateId: string,
    vars: Record<string, string>,
  ): Promise<SendResult>;
  getSessionStatus(channelId: string): Promise<SessionStatus>;
  /** Returns the QR payload for the entry tier. */
  connect(channelId: string): Promise<ConnectResult>;
  disconnect(channelId: string): Promise<void>;
}
