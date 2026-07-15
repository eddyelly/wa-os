import { beforeEach, describe, expect, it, vi } from 'vitest';

// outbound-worker.ts pulls in bullmq (Worker/DelayedError), the shared redis
// client, minio, the messaging adapter, the message repository, and the
// socket gateway at import time. All are stubbed here so this stays a
// hermetic unit test with no real network, Redis, or Prisma connection
// attempted (mirrors ai-reply-guard.test.ts's approach for the sibling
// worker). The mocked Worker class captures the processor callback passed to
// `new Worker(...)` so the test can invoke it directly, exercising the exact
// same try/catch wrapper `startOutboundWorker` installs.
type Processor = (job: unknown, token: string | undefined) => Promise<void>;

const { messageRepo, redisMock, port, emitToOrg } = vi.hoisted(() => ({
  messageRepo: {
    findByIdWithThread: vi.fn(),
    findById: vi.fn(),
    updateStatus: vi.fn(),
  },
  redisMock: {
    get: vi.fn(),
    set: vi.fn(),
    incr: vi.fn(),
    expire: vi.fn(),
  },
  port: {
    sendText: vi.fn(),
    sendMedia: vi.fn(),
  },
  emitToOrg: vi.fn(),
}));

let capturedProcessor: Processor | undefined;

vi.mock('bullmq', () => ({
  Queue: class {
    add = (): Promise<void> => Promise.resolve();
    getJob = (): Promise<null> => Promise.resolve(null);
    close = (): Promise<void> => Promise.resolve();
  },
  Worker: class {
    constructor(_name: string, processor: Processor) {
      capturedProcessor = processor;
    }
    on = (): void => undefined;
  },
  DelayedError: class DelayedError extends Error {},
}));

vi.mock('../lib/redis.js', () => ({
  redisConnectionOptions: () => ({ host: 'localhost', port: 6379, maxRetriesPerRequest: null }),
  redis: redisMock,
}));

vi.mock('../lib/minio.js', () => ({
  getProviderMediaUrl: vi.fn(),
  getMediaMimeType: vi.fn(),
}));

vi.mock('../adapters/messaging.js', () => ({
  messagingPortFor: vi.fn(() => port),
}));

vi.mock('../repositories/message-repository.js', () => ({
  messageRepository: messageRepo,
}));

vi.mock('../sockets/gateway.js', () => ({
  emitToOrg,
}));

import { startOutboundWorker } from './outbound-worker.js';

startOutboundWorker();

const baseJobData = {
  organizationId: 'org1',
  channelId: 'chan1',
  messageId: 'msg1',
  action: 'REPLY_ACTIVE_CONVERSATION' as const,
};

// cloud_api never rate-limits (policyEngine.check), so the test exercises
// the quoted-ref build and the send call without also driving the entry
// tier's pacing/warm-up path (covered separately by pacing.test.ts).
const cloudApiThread = (overrides: Partial<{ replyToMessageId: string | null }> = {}) => ({
  id: 'msg1',
  status: 'QUEUED',
  mediaKey: null,
  body: 'Karibu, tunayo.',
  replyToMessageId: null,
  ...overrides,
  conversation: {
    id: 'conv1',
    contact: { phone: '+255700000001', optedInAt: new Date('2026-01-01T00:00:00Z') },
    channel: { id: 'chan1', provider: 'cloud_api', warmupStartedAt: null },
  },
});

function fakeJob(): unknown {
  return {
    id: 'job1',
    data: baseJobData,
    opts: { attempts: 3 },
    attemptsMade: 0,
    moveToDelayed: vi.fn(),
  };
}

describe('outbound worker: quoted replies', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    port.sendText.mockResolvedValue({ providerMessageId: 'WAMSG2' });
    port.sendMedia.mockResolvedValue({ providerMessageId: 'WAMSG2' });
  });

  it('passes a QuotedRef built from the target message when replyToMessageId is set and the target was delivered', async () => {
    messageRepo.findByIdWithThread.mockResolvedValue(cloudApiThread({ replyToMessageId: 'target1' }));
    messageRepo.findById.mockResolvedValue({
      id: 'target1',
      providerMessageId: 'WAMSG1',
      direction: 'IN',
      body: 'Mnayo rasta?',
    });

    await capturedProcessor?.(fakeJob(), 'token1');

    expect(messageRepo.findById).toHaveBeenCalledWith('target1');
    expect(port.sendText).toHaveBeenCalledWith('chan1', '+255700000001', 'Karibu, tunayo.', {
      providerMessageId: 'WAMSG1',
      fromMe: false,
      text: 'Mnayo rasta?',
    });
    expect(messageRepo.updateStatus).toHaveBeenCalledWith('msg1', 'SENT', {
      providerMessageId: 'WAMSG2',
    });
  });

  it('sets fromMe true when the quoted target was one of our own outbound messages', async () => {
    messageRepo.findByIdWithThread.mockResolvedValue(cloudApiThread({ replyToMessageId: 'target1' }));
    messageRepo.findById.mockResolvedValue({
      id: 'target1',
      providerMessageId: 'WAMSG0',
      direction: 'OUT',
      body: 'Bei ni TZS 25,000.',
    });

    await capturedProcessor?.(fakeJob(), 'token1');

    expect(port.sendText).toHaveBeenCalledWith(
      'chan1',
      '+255700000001',
      'Karibu, tunayo.',
      expect.objectContaining({ fromMe: true }),
    );
  });

  it('sends without a quote when replyToMessageId is not set', async () => {
    messageRepo.findByIdWithThread.mockResolvedValue(cloudApiThread());

    await capturedProcessor?.(fakeJob(), 'token1');

    expect(messageRepo.findById).not.toHaveBeenCalled();
    expect(port.sendText).toHaveBeenCalledWith('chan1', '+255700000001', 'Karibu, tunayo.', undefined);
  });

  it('sends without a quote when the target message was never delivered (no providerMessageId)', async () => {
    messageRepo.findByIdWithThread.mockResolvedValue(cloudApiThread({ replyToMessageId: 'target1' }));
    messageRepo.findById.mockResolvedValue({
      id: 'target1',
      providerMessageId: null,
      direction: 'IN',
      body: 'Mnayo rasta?',
    });

    await capturedProcessor?.(fakeJob(), 'token1');

    expect(port.sendText).toHaveBeenCalledWith('chan1', '+255700000001', 'Karibu, tunayo.', undefined);
  });
});
