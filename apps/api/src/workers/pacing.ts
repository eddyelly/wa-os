/**
 * Entry tier send pacing (CLAUDE.md 3.3): a per-channel gap derived from
 * SEND_RATE_PER_MINUTE plus randomized jitter between 2 and 9 seconds so the
 * cadence never looks robotic.
 */

export const JITTER_MIN_MS = 2_000;
export const JITTER_MAX_MS = 9_000;

export function computeSendDelayMs(params: {
  lastSentAtMs: number | null;
  nowMs: number;
  ratePerMinute: number;
  random: number;
}): number {
  const gapMs = Math.ceil(60_000 / Math.max(params.ratePerMinute, 1));
  const wait =
    params.lastSentAtMs === null ? 0 : Math.max(0, params.lastSentAtMs + gapMs - params.nowMs);
  const jitter = JITTER_MIN_MS + Math.floor(params.random * (JITTER_MAX_MS - JITTER_MIN_MS));
  return wait + jitter;
}

/** Start of the next UTC day, used to postpone sends past the warm-up cap. */
export function nextUtcMidnightMs(nowMs: number): number {
  const next = new Date(nowMs);
  next.setUTCHours(24, 0, 0, 0);
  return next.getTime();
}

export function utcDayStamp(nowMs: number): string {
  return new Date(nowMs).toISOString().slice(0, 10);
}
