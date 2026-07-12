import { describe, expect, it, vi } from 'vitest';

// The worker module pulls in bullmq (Queue/Worker) and the shared redis
// client at import time (via lib/queues.js and lib/redis.js). Both are
// stubbed here so this stays a hermetic unit test of the two pure guard
// helpers, with no real network connection attempted.
vi.mock('bullmq', () => ({
  Queue: class {
    add = (): Promise<void> => Promise.resolve();
    getJob = (): Promise<null> => Promise.resolve(null);
    close = (): Promise<void> => Promise.resolve();
  },
  Worker: class {
    on = (): void => undefined;
  },
}));

vi.mock('../lib/redis.js', () => ({
  redisConnectionOptions: () => ({ host: 'localhost', port: 6379, maxRetriesPerRequest: null }),
  redis: { set: vi.fn() },
}));

import { aiReplyGuardKey, shouldSendAiReply } from './ai-reply-worker.js';

describe('aiReplyGuardKey', () => {
  it('builds a per-message guard key', () => {
    expect(aiReplyGuardKey('msg1')).toBe('ai-replied:msg1');
    expect(aiReplyGuardKey('msg2')).toBe('ai-replied:msg2');
  });
});

describe('shouldSendAiReply', () => {
  it('sends only when the guard SET NX acquired the key ("OK")', () => {
    expect(shouldSendAiReply('OK')).toBe(true);
  });

  it('skips when a prior send already holds the key (SET NX returns null)', () => {
    expect(shouldSendAiReply(null)).toBe(false);
  });

  it('skips for any other value, defensively', () => {
    expect(shouldSendAiReply('SOMETHING_ELSE')).toBe(false);
  });
});
