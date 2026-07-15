import { beforeEach, describe, expect, it, vi } from 'vitest';

// vi.hoisted is required (see notification-service.test.ts / outbound-service.test.ts)
// because the vi.mock factories below are hoisted above these consts; a plain
// top-level const referenced from inside a factory would throw a
// temporal-dead-zone ReferenceError otherwise.
const {
  normalizeWebhookEvent,
  downloadMedia,
  channelRepo,
  contactRepo,
  conversationRepo,
  messageRepo,
  enqueueAiReply,
  emitToOrg,
  applyStatusEvent,
  logger,
} = vi.hoisted(() => ({
  normalizeWebhookEvent: vi.fn(),
  downloadMedia: vi.fn(),
  channelRepo: { findByIdSystem: vi.fn(), updateStatusSystem: vi.fn() },
  contactRepo: { upsertByPhone: vi.fn() },
  conversationRepo: { upsertForContact: vi.fn() },
  messageRepo: { findByProviderId: vi.fn(), createInbound: vi.fn() },
  enqueueAiReply: vi.fn(),
  emitToOrg: vi.fn(),
  applyStatusEvent: vi.fn(),
  logger: { warn: vi.fn(), debug: vi.fn(), error: vi.fn() },
}));

vi.mock('../adapters/evolution/evolution-adapter.js', () => ({
  evolutionAdapter: { normalizeWebhookEvent, downloadMedia },
}));
vi.mock('../repositories/channel-repository.js', () => ({ channelRepository: channelRepo }));
vi.mock('../repositories/contact-repository.js', () => ({ contactRepository: contactRepo }));
vi.mock('../repositories/conversation-repository.js', () => ({ conversationRepository: conversationRepo }));
vi.mock('../repositories/message-repository.js', () => ({ messageRepository: messageRepo }));
vi.mock('../lib/queues.js', () => ({ enqueueAiReply }));
vi.mock('../sockets/gateway.js', () => ({ emitToOrg }));
vi.mock('./channel-service.js', () => ({ channelService: { applyStatusEvent } }));
vi.mock('../lib/logger.js', () => ({ logger }));

import { inboundService } from './inbound-service.js';

const channel = {
  id: 'chan1',
  organizationId: 'org1',
  provider: 'evolution' as const,
  status: 'CONNECTED' as const,
};

function incomingMessage(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    channelId: 'chan1',
    providerMessageId: 'wa-in-1',
    from: '+255700000001',
    contactName: 'Asha',
    type: 'TEXT',
    text: 'Hujambo',
    sentAt: new Date('2026-01-01T00:00:00Z'),
    ...overrides,
  };
}

describe('inboundService.processEvolutionWebhook quote resolution', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    channelRepo.findByIdSystem.mockResolvedValue(channel);
    contactRepo.upsertByPhone.mockResolvedValue({ id: 'contact1' });
    conversationRepo.upsertForContact.mockResolvedValue({ id: 'conv1', aiEnabled: false });
    messageRepo.createInbound.mockResolvedValue({ id: 'msg1', conversationId: 'conv1' });
  });

  it('resolves quotedProviderMessageId to the local message id in the same conversation', async () => {
    const message = incomingMessage({ quotedProviderMessageId: 'wa-quoted-1' });
    normalizeWebhookEvent.mockReturnValue({ channelId: 'chan1', event: { kind: 'message', message } });
    messageRepo.findByProviderId.mockImplementation((providerMessageId: string) => {
      if (providerMessageId === 'wa-in-1') {
        return Promise.resolve(null); // not a re-delivered duplicate
      }
      if (providerMessageId === 'wa-quoted-1') {
        return Promise.resolve({ id: 'local-1', conversationId: 'conv1' });
      }
      return Promise.resolve(null);
    });

    await inboundService.processEvolutionWebhook({});

    expect(messageRepo.createInbound).toHaveBeenCalledWith(
      expect.objectContaining({ replyToMessageId: 'local-1' }),
    );
  });

  it('leaves replyToMessageId undefined when the quoted message cannot be resolved', async () => {
    const message = incomingMessage({ quotedProviderMessageId: 'wa-quoted-missing' });
    normalizeWebhookEvent.mockReturnValue({ channelId: 'chan1', event: { kind: 'message', message } });
    messageRepo.findByProviderId.mockResolvedValue(null);

    await inboundService.processEvolutionWebhook({});

    expect(messageRepo.createInbound).toHaveBeenCalledWith(
      expect.objectContaining({ replyToMessageId: undefined }),
    );
  });

  it('leaves replyToMessageId undefined when the resolved message belongs to a different conversation', async () => {
    const message = incomingMessage({ quotedProviderMessageId: 'wa-quoted-other-conv' });
    normalizeWebhookEvent.mockReturnValue({ channelId: 'chan1', event: { kind: 'message', message } });
    messageRepo.findByProviderId.mockImplementation((providerMessageId: string) => {
      if (providerMessageId === 'wa-in-1') {
        return Promise.resolve(null);
      }
      return Promise.resolve({ id: 'local-2', conversationId: 'conv-other' });
    });

    await inboundService.processEvolutionWebhook({});

    expect(messageRepo.createInbound).toHaveBeenCalledWith(
      expect.objectContaining({ replyToMessageId: undefined }),
    );
  });

  it('does not attempt to resolve a quote when the incoming message carries none', async () => {
    const message = incomingMessage();
    normalizeWebhookEvent.mockReturnValue({ channelId: 'chan1', event: { kind: 'message', message } });
    messageRepo.findByProviderId.mockResolvedValue(null);

    await inboundService.processEvolutionWebhook({});

    expect(messageRepo.createInbound).toHaveBeenCalledWith(
      expect.objectContaining({ replyToMessageId: undefined }),
    );
    // Only the re-delivery idempotency lookup runs, no quote-resolution lookup.
    expect(messageRepo.findByProviderId).toHaveBeenCalledTimes(1);
  });
});
