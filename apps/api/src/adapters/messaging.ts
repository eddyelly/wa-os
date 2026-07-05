import type { MessagingPort } from '@waos/ports';
import type { ChannelProvider } from '@prisma/client';
import { cloudApiAdapter } from './cloud-api-adapter.js';
import { evolutionAdapter } from './evolution/evolution-adapter.js';

/** The only place a provider name maps to a concrete adapter. */
export function messagingPortFor(provider: ChannelProvider): MessagingPort {
  return provider === 'evolution' ? evolutionAdapter : cloudApiAdapter;
}
