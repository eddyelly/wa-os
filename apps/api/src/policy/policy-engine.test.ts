import { describe, expect, it } from 'vitest';
import { policyEngine } from './policy-engine.js';

const optedIn = { contactOptedIn: true };
const notOptedIn = { contactOptedIn: false };

describe('policy engine: evolution (entry tier)', () => {
  it('allows replies in an active conversation, rate limited', () => {
    expect(policyEngine.check('REPLY_ACTIVE_CONVERSATION', 'evolution', notOptedIn)).toEqual({
      outcome: 'allow',
      rateLimited: true,
    });
  });

  it('allows media in an active chat, rate limited', () => {
    expect(policyEngine.check('MEDIA_ACTIVE_CONVERSATION', 'evolution', notOptedIn)).toEqual({
      outcome: 'allow',
      rateLimited: true,
    });
  });

  it('allows reminders to opted-in contacts, rate limited', () => {
    expect(policyEngine.check('REMINDER_OPTED_IN', 'evolution', optedIn)).toEqual({
      outcome: 'allow',
      rateLimited: true,
    });
  });

  it('blocks reminders without opt-in', () => {
    expect(policyEngine.check('REMINDER_OPTED_IN', 'evolution', notOptedIn)).toEqual({
      outcome: 'block',
      reason: 'OPT_IN_REQUIRED',
    });
  });

  it('blocks broadcasts as COMING_SOON (ban risk, never an upsell)', () => {
    expect(policyEngine.check('BROADCAST', 'evolution', optedIn)).toEqual({
      outcome: 'block',
      reason: 'COMING_SOON',
    });
  });

  it('blocks messages to non-contacts', () => {
    expect(policyEngine.check('MESSAGE_NON_CONTACT', 'evolution', notOptedIn)).toEqual({
      outcome: 'block',
      reason: 'OPT_IN_REQUIRED',
    });
  });

  it('allows owner alerts to an opted-in owner contact, rate limited', () => {
    expect(policyEngine.check('OWNER_ALERT', 'evolution', optedIn)).toEqual({
      outcome: 'allow',
      rateLimited: true,
    });
  });

  it('blocks owner alerts without opt-in', () => {
    expect(policyEngine.check('OWNER_ALERT', 'evolution', notOptedIn)).toEqual({
      outcome: 'block',
      reason: 'OPT_IN_REQUIRED',
    });
  });
});

describe('policy engine: cloud_api (later)', () => {
  it.each([
    'REPLY_ACTIVE_CONVERSATION',
    'MEDIA_ACTIVE_CONVERSATION',
    'REMINDER_OPTED_IN',
    'BROADCAST',
    'MESSAGE_NON_CONTACT',
    'OWNER_ALERT',
  ] as const)('allows %s without entry tier pacing', (action) => {
    expect(policyEngine.check(action, 'cloud_api', notOptedIn)).toEqual({
      outcome: 'allow',
      rateLimited: false,
    });
  });
});
