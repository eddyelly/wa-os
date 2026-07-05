/**
 * Reminder scheduling math and message templates, pure and unit-tested.
 * Offsets are config-driven (REMINDER_OFFSETS_MINUTES); offsets already in
 * the past at scheduling time are skipped.
 */

export interface PlannedReminder {
  offset: 'FIRST' | 'SECOND';
  delayMs: number;
}

export function planReminders(
  startsAt: Date,
  now: Date,
  offsetsMinutes: readonly number[],
): PlannedReminder[] {
  const labels: PlannedReminder['offset'][] = ['FIRST', 'SECOND'];
  const planned: PlannedReminder[] = [];
  offsetsMinutes.slice(0, 2).forEach((minutes, index) => {
    const fireAt = startsAt.getTime() - minutes * 60_000;
    const delayMs = fireAt - now.getTime();
    if (delayMs > 0) {
      planned.push({ offset: labels[index] ?? 'SECOND', delayMs });
    }
  });
  return planned;
}

const templates = {
  sw: (vars: { name: string; service: string; time: string; business: string }) =>
    `Habari ${vars.name}! Kikumbusho kutoka ${vars.business}: una miadi ya ${vars.service} ${vars.time}. Karibu sana! Kama huwezi kufika, tafadhali tujulishe.`,
  en: (vars: { name: string; service: string; time: string; business: string }) =>
    `Hello ${vars.name}! A reminder from ${vars.business}: you have a ${vars.service} appointment ${vars.time}. See you soon! If you cannot make it, please let us know.`,
} as const;

export function renderReminder(params: {
  language: string;
  name: string | null;
  service: string;
  startsAt: Date;
  timezone: string;
  business: string;
}): string {
  const locale = params.language === 'sw' ? 'sw-TZ' : 'en-GB';
  const time = new Intl.DateTimeFormat(locale, {
    timeZone: params.timezone,
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    hour: '2-digit',
    minute: '2-digit',
  }).format(params.startsAt);
  const template = params.language === 'sw' ? templates.sw : templates.en;
  return template({
    name: params.name ?? (params.language === 'sw' ? 'mteja wetu' : 'valued customer'),
    service: params.service,
    time,
    business: params.business,
  });
}
