import { describe, expect, it } from 'vitest';
import { warmupCap, warmupCapForDay, warmupDayIndex } from './warmup.js';

const CAPS = [20, 40, 60, 80, 120];

describe('warm-up caps', () => {
  it('day zero uses the first cap', () => {
    const start = new Date('2026-07-01T08:00:00Z');
    const now = new Date('2026-07-01T20:00:00Z');
    expect(warmupDayIndex(start, now)).toBe(0);
    expect(warmupCap(start, now, CAPS)).toBe(20);
  });

  it('ramps day by day', () => {
    const start = new Date('2026-07-01T08:00:00Z');
    expect(warmupCap(start, new Date('2026-07-02T09:00:00Z'), CAPS)).toBe(40);
    expect(warmupCap(start, new Date('2026-07-03T09:00:00Z'), CAPS)).toBe(60);
    expect(warmupCap(start, new Date('2026-07-05T09:00:00Z'), CAPS)).toBe(120);
  });

  it('holds the last cap after the schedule ends', () => {
    const start = new Date('2026-07-01T08:00:00Z');
    expect(warmupCap(start, new Date('2026-09-01T09:00:00Z'), CAPS)).toBe(120);
  });

  it('a clock skew before the start clamps to day zero', () => {
    const start = new Date('2026-07-02T08:00:00Z');
    expect(warmupCap(start, new Date('2026-07-01T08:00:00Z'), CAPS)).toBe(20);
  });

  it('uses the first cap when warm-up has not started yet', () => {
    expect(warmupCap(null, new Date('2026-07-01T08:00:00Z'), CAPS)).toBe(20);
  });

  it('is unlimited only when no schedule is configured', () => {
    expect(warmupCapForDay(3, [])).toBe(Number.POSITIVE_INFINITY);
  });
});
