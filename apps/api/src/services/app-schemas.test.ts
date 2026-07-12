import { describe, expect, it } from 'vitest';
import {
  aiTestResultSchema,
  contactSchema,
  dashboardSummarySchema,
  organizationDetailSchema,
  teamMemberSchema,
} from '@waos/shared';

describe('app response schemas', () => {
  it('parses a dashboard summary with a null deflection percent', () => {
    const parsed = dashboardSummarySchema.parse({
      conversationsToday: 0,
      pendingHandoffs: 0,
      deflection: { replied: 0, handedOff: 0, percent: null },
      upcomingAppointments: [],
    });
    expect(parsed.deflection.percent).toBeNull();
  });

  it('parses a contact and strips unknown keys', () => {
    const parsed = contactSchema.parse({
      id: 'c1', phone: '+255700000001', name: null, language: null,
      tags: [], optedInAt: null, customFields: null,
      createdAt: '2026-07-13T00:00:00.000Z',
    });
    expect('createdAt' in parsed).toBe(false);
  });

  it('ai test result accepts only REPLY or HANDOFF actions', () => {
    expect(() =>
      aiTestResultSchema.parse({ reply: 'x', confidence: 0.5, intent: 'question', action: 'MAYBE', chunksUsed: 1 }),
    ).toThrow();
  });

  it('organization detail keeps unknown settings keys (passthrough)', () => {
    const parsed = organizationDetailSchema.parse({
      id: 'o1', name: 'N', vertical: 'salon', language: 'sw', timezone: 'Africa/Dar_es_Salaam',
      modules: ['appointments'], settings: { aiEnabled: true, futureKey: 1 },
    });
    expect((parsed.settings as Record<string, unknown>).futureKey).toBe(1);
  });

  it('team member requires email', () => {
    expect(() => teamMemberSchema.parse({ id: 'u1', name: 'A', role: 'OWNER' })).toThrow();
  });
});
