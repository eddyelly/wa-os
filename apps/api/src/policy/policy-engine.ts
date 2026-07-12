import type { ChannelProvider } from '@prisma/client';
import type { PolicyAction, PolicyDecision } from '@waos/shared';

/**
 * Every outbound action passes through here BEFORE it is enqueued, and again
 * in the send worker right before the provider call. Rules are keyed on the
 * channel provider (CLAUDE.md 3.2). Broadcasts are gated for ban risk, not
 * money: the reason is COMING_SOON, surfaced as "coming soon", never an
 * upsell. Volume throttling itself lives in the outbound worker; the
 * rateLimited flag tells it to apply the entry tier pacing.
 */

export interface PolicyContext {
  /** Contact.optedInAt is set (proactive sends require it on the entry tier). */
  contactOptedIn: boolean;
}

const allow = (rateLimited: boolean): PolicyDecision => ({ outcome: 'allow', rateLimited });

export const policyEngine = {
  check(action: PolicyAction, provider: ChannelProvider, context: PolicyContext): PolicyDecision {
    if (provider === 'cloud_api') {
      // The official API carries no ban risk; everything is allowed. The
      // transport itself is a Phase 3 stub, so nothing reaches it yet.
      return allow(false);
    }

    switch (action) {
      case 'REPLY_ACTIVE_CONVERSATION':
      case 'MEDIA_ACTIVE_CONVERSATION':
        return allow(true);
      case 'REMINDER_OPTED_IN':
        return context.contactOptedIn
          ? allow(true)
          : { outcome: 'block', reason: 'OPT_IN_REQUIRED' };
      case 'BROADCAST':
        return { outcome: 'block', reason: 'COMING_SOON' };
      case 'MESSAGE_NON_CONTACT':
        return { outcome: 'block', reason: 'OPT_IN_REQUIRED' };
      case 'OWNER_ALERT':
        return context.contactOptedIn
          ? allow(true)
          : { outcome: 'block', reason: 'OPT_IN_REQUIRED' };
    }
  },
};
