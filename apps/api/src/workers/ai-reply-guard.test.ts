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
  redis: { set: vi.fn(), del: vi.fn() },
}));

import {
  aiReplyGuardKey,
  buildHandoffNotifyPayload,
  sendWithGuardRelease,
  shouldSendAiReply,
} from './ai-reply-worker.js';

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

describe('sendWithGuardRelease', () => {
  it('releases the guard key and rethrows when the send fails', async () => {
    const del = vi.fn().mockResolvedValue(1);
    const sendError = new Error('provider timed out');
    const send = vi.fn().mockRejectedValue(sendError);

    await expect(
      sendWithGuardRelease({ send, releaseKey: 'ai-replied:msg1', redisClient: { del } }),
    ).rejects.toThrow('provider timed out');
    expect(del).toHaveBeenCalledTimes(1);
    expect(del).toHaveBeenCalledWith('ai-replied:msg1');
  });

  it('never touches the guard key when the send succeeds', async () => {
    const del = vi.fn().mockResolvedValue(1);
    const send = vi.fn().mockResolvedValue(undefined);

    await sendWithGuardRelease({ send, releaseKey: 'ai-replied:msg2', redisClient: { del } });
    expect(del).not.toHaveBeenCalled();
  });

  it('still rethrows the original send error when the guard release itself fails', async () => {
    const del = vi.fn().mockRejectedValue(new Error('redis unreachable'));
    const sendError = new Error('provider timed out');
    const send = vi.fn().mockRejectedValue(sendError);

    await expect(
      sendWithGuardRelease({ send, releaseKey: 'ai-replied:msg3', redisClient: { del } }),
    ).rejects.toThrow('provider timed out');
  });
});

describe('buildHandoffNotifyPayload', () => {
  it('extracts conversationId and the contact name for the HANDOFF notification', () => {
    expect(
      buildHandoffNotifyPayload({ id: 'conv1', contact: { name: 'Fatuma' } }),
    ).toEqual({ conversationId: 'conv1', contactName: 'Fatuma' });
  });

  it('passes through a null contact name rather than substituting a placeholder', () => {
    expect(buildHandoffNotifyPayload({ id: 'conv2', contact: { name: null } })).toEqual({
      conversationId: 'conv2',
      contactName: null,
    });
  });
});
