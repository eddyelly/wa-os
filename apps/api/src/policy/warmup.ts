/**
 * New-channel warm-up: day-indexed daily send caps that ramp up over the
 * configured schedule (WARMUP_DAILY_CAPS). Past the end of the schedule the
 * last cap applies forever.
 */

const DAY_MS = 24 * 60 * 60 * 1000;

export function warmupDayIndex(warmupStartedAt: Date, now: Date): number {
  const elapsed = now.getTime() - warmupStartedAt.getTime();
  return Math.max(0, Math.floor(elapsed / DAY_MS));
}

export function warmupCapForDay(dayIndex: number, caps: readonly number[]): number {
  if (caps.length === 0) {
    return Number.POSITIVE_INFINITY;
  }
  const index = Math.min(Math.max(dayIndex, 0), caps.length - 1);
  return caps[index] ?? Number.POSITIVE_INFINITY;
}

export function warmupCap(warmupStartedAt: Date | null, now: Date, caps: readonly number[]): number {
  if (!warmupStartedAt) {
    // Warm-up starts at first connection; before that nothing sends anyway.
    return warmupCapForDay(0, caps);
  }
  return warmupCapForDay(warmupDayIndex(warmupStartedAt, now), caps);
}
