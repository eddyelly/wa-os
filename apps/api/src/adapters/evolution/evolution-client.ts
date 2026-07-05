import type { z } from 'zod';
import { AppError } from '../../lib/errors.js';
import { config } from '../../lib/config.js';
import { logger } from '../../lib/logger.js';
import {
  connectionStateResponseSchema,
  mediaBase64ResponseSchema,
  qrPayloadSchema,
  sendMessageResponseSchema,
} from './evolution-schemas.js';

class ProviderError extends AppError {
  constructor(message: string, details?: unknown) {
    super(message, { statusCode: 502, code: 'PROVIDER_ERROR', details });
  }
}

async function request<T extends z.ZodTypeAny>(
  method: 'GET' | 'POST' | 'DELETE',
  path: string,
  schema: T,
  body?: unknown,
): Promise<z.infer<T>> {
  const url = `${config.EVOLUTION_API_URL}${path}`;
  let response: Response;
  try {
    response = await fetch(url, {
      method,
      headers: {
        apikey: config.EVOLUTION_API_KEY,
        'Content-Type': 'application/json',
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch (error) {
    logger.error({ err: error, path }, 'evolution request failed');
    throw new ProviderError('The WhatsApp service is unreachable. Try again shortly.');
  }
  const text = await response.text();
  if (!response.ok) {
    logger.error({ path, status: response.status }, 'evolution request rejected');
    throw new ProviderError('The WhatsApp service rejected the request.', {
      status: response.status,
    });
  }
  let json: unknown;
  try {
    json = text.length > 0 ? JSON.parse(text) : {};
  } catch {
    throw new ProviderError('The WhatsApp service returned an unreadable response.');
  }
  const parsed = schema.safeParse(json);
  if (!parsed.success) {
    logger.error({ path, issues: parsed.error.issues }, 'evolution response shape mismatch');
    throw new ProviderError('The WhatsApp service returned an unexpected response.');
  }
  return parsed.data as z.infer<T>;
}

/** E.164 (+255...) to the digits-only form Evolution expects. */
export function toProviderNumber(phone: string): string {
  return phone.replace(/[^0-9]/g, '');
}

export const evolutionClient = {
  // POST /instance/create (instance.router.ts): instanceName, integration,
  // qrcode, webhook { enabled, url, events, byEvents, base64 }.
  async createInstance(instanceName: string, webhookUrl: string): Promise<void> {
    const anySchema = qrPayloadSchema.partial().passthrough();
    await request('POST', '/instance/create', anySchema, {
      instanceName,
      integration: 'WHATSAPP-BAILEYS',
      qrcode: true,
      webhook: {
        enabled: true,
        url: webhookUrl,
        byEvents: false,
        base64: false,
        events: ['MESSAGES_UPSERT', 'MESSAGES_UPDATE', 'CONNECTION_UPDATE', 'QRCODE_UPDATED'],
      },
    });
  },

  // GET /instance/connect/:instanceName returns the QR payload.
  connect(instanceName: string): Promise<z.infer<typeof qrPayloadSchema>> {
    return request('GET', `/instance/connect/${instanceName}`, qrPayloadSchema);
  },

  // GET /instance/connectionState/:instanceName -> { instance: { state } }
  async connectionState(instanceName: string): Promise<string> {
    const data = await request(
      'GET',
      `/instance/connectionState/${instanceName}`,
      connectionStateResponseSchema,
    );
    return data.instance.state;
  },

  async logout(instanceName: string): Promise<void> {
    await request('DELETE', `/instance/logout/${instanceName}`, qrPayloadSchema.partial());
  },

  async deleteInstance(instanceName: string): Promise<void> {
    await request('DELETE', `/instance/delete/${instanceName}`, qrPayloadSchema.partial());
  },

  // POST /message/sendText/:instanceName { number, text }
  async sendText(instanceName: string, number: string, text: string): Promise<string> {
    const data = await request(
      'POST',
      `/message/sendText/${instanceName}`,
      sendMessageResponseSchema,
      { number, text },
    );
    return data.key.id;
  },

  // POST /message/sendMedia/:instanceName { number, mediatype, mimetype,
  // caption, fileName, media (url or base64) }
  async sendMedia(
    instanceName: string,
    number: string,
    media: { mediatype: 'image' | 'document' | 'audio'; mimetype: string; url: string },
    caption?: string,
    fileName?: string,
  ): Promise<string> {
    const data = await request(
      'POST',
      `/message/sendMedia/${instanceName}`,
      sendMessageResponseSchema,
      {
        number,
        mediatype: media.mediatype,
        mimetype: media.mimetype,
        media: media.url,
        ...(caption ? { caption } : {}),
        ...(fileName ? { fileName } : {}),
      },
    );
    return data.key.id;
  },

  // POST /chat/getBase64FromMediaMessage/:instanceName { message: { key: { id } } }
  async getMediaBase64(
    instanceName: string,
    providerMessageId: string,
  ): Promise<{ base64: string; mimetype?: string; fileName?: string }> {
    const data = await request(
      'POST',
      `/chat/getBase64FromMediaMessage/${instanceName}`,
      mediaBase64ResponseSchema,
      { message: { key: { id: providerMessageId } }, convertToMp4: false },
    );
    return { base64: data.base64, mimetype: data.mimetype, fileName: data.fileName };
  },
};
