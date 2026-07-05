import { describe, expect, it } from 'vitest';
import { computeSendDelayMs, JITTER_MAX_MS, JITTER_MIN_MS, nextUtcMidnightMs } from './pacing.js';

describe('send pacing', () => {
  it('applies only jitter for the first send on a channel', () => {
    const delay = computeSendDelayMs({
      lastSentAtMs: null,
      nowMs: 1_000_000,
      ratePerMinute: 6,
      random: 0,
    });
    expect(delay).toBe(JITTER_MIN_MS);
  });

  it('jitter stays between 2 and 9 seconds', () => {
    for (const random of [0, 0.25, 0.5, 0.999]) {
      const delay = computeSendDelayMs({
        lastSentAtMs: null,
        nowMs: 0,
        ratePerMinute: 6,
        random,
      });
      expect(delay).toBeGreaterThanOrEqual(JITTER_MIN_MS);
      expect(delay).toBeLessThan(JITTER_MAX_MS);
    }
  });

  it('respects the per-channel rate gap', () => {
    // 6 per minute = one send every 10 seconds; last send was 4s ago.
    const delay = computeSendDelayMs({
      lastSentAtMs: 100_000,
      nowMs: 104_000,
      ratePerMinute: 6,
      random: 0,
    });
    expect(delay).toBe(6_000 + JITTER_MIN_MS);
  });

  it('does not wait for the gap when it already passed', () => {
    const delay = computeSendDelayMs({
      lastSentAtMs: 100_000,
      nowMs: 200_000,
      ratePerMinute: 6,
      random: 0,
    });
    expect(delay).toBe(JITTER_MIN_MS);
  });

  it('computes the next utc midnight', () => {
    const now = Date.UTC(2026, 6, 5, 22, 30, 0);
    expect(nextUtcMidnightMs(now)).toBe(Date.UTC(2026, 6, 6, 0, 0, 0));
  });
});
