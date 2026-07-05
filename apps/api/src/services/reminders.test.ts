import { describe, expect, it } from 'vitest';
import { planReminders, renderReminder } from './reminders.js';

describe('reminder planning', () => {
  const startsAt = new Date('2026-07-10T14:00:00Z');

  it('schedules both offsets when far in the future', () => {
    const now = new Date('2026-07-08T14:00:00Z');
    const planned = planReminders(startsAt, now, [1440, 120]);
    expect(planned).toHaveLength(2);
    expect(planned[0]).toEqual({ offset: 'FIRST', delayMs: 24 * 60 * 60_000 });
    expect(planned[1]).toEqual({ offset: 'SECOND', delayMs: 46 * 60 * 60_000 });
  });

  it('skips offsets that are already in the past', () => {
    const now = new Date('2026-07-10T00:00:00Z');
    const planned = planReminders(startsAt, now, [1440, 120]);
    expect(planned).toHaveLength(1);
    expect(planned[0]?.offset).toBe('SECOND');
  });

  it('schedules nothing for an appointment starting immediately', () => {
    const now = new Date('2026-07-10T13:59:00Z');
    expect(planReminders(startsAt, now, [1440, 120])).toEqual([]);
  });

  it('supports a single dev override offset', () => {
    const now = new Date('2026-07-10T13:50:00Z');
    const planned = planReminders(startsAt, now, [5]);
    expect(planned).toHaveLength(1);
    expect(planned[0]).toEqual({ offset: 'FIRST', delayMs: 5 * 60_000 });
  });
});

describe('reminder templates', () => {
  const base = {
    name: 'Zawadi',
    service: 'kusuka rasta',
    startsAt: new Date('2026-07-10T14:00:00Z'),
    timezone: 'Africa/Dar_es_Salaam',
    business: 'Nuru Salon',
  };

  it('renders swahili with all variables', () => {
    const text = renderReminder({ ...base, language: 'sw' });
    expect(text).toContain('Zawadi');
    expect(text).toContain('kusuka rasta');
    expect(text).toContain('Nuru Salon');
    expect(text).toContain('Kikumbusho');
  });

  it('renders english with all variables', () => {
    const text = renderReminder({ ...base, language: 'en', service: 'braiding' });
    expect(text).toContain('reminder from Nuru Salon');
    expect(text).toContain('braiding');
  });

  it('falls back politely when the contact has no name', () => {
    expect(renderReminder({ ...base, language: 'sw', name: null })).toContain('mteja wetu');
    expect(renderReminder({ ...base, language: 'en', name: null })).toContain('valued customer');
  });

  it('formats the time in the business timezone', () => {
    const text = renderReminder({ ...base, language: 'en' });
    // 14:00 UTC is 17:00 in Dar es Salaam (UTC+3).
    expect(text).toContain('17:00');
  });
});
