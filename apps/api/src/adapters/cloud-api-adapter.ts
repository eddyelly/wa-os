import type { ConnectResult, MessagingPort, SendResult, SessionStatus } from '@waos/ports';
import { NotImplementedError } from '../lib/errors.js';

/**
 * Phase 3 placeholder proving the MessagingPort swaps. Every method throws
 * NotImplementedError; the policy engine and channel service must never
 * route entry-tier traffic here.
 */
export class CloudApiAdapter implements MessagingPort {
  sendText(): Promise<SendResult> {
    return Promise.reject(new NotImplementedError('The Cloud API transport arrives in a later phase.'));
  }

  sendMedia(): Promise<SendResult> {
    return Promise.reject(new NotImplementedError('The Cloud API transport arrives in a later phase.'));
  }

  sendTemplate(): Promise<SendResult> {
    return Promise.reject(new NotImplementedError('The Cloud API transport arrives in a later phase.'));
  }

  getSessionStatus(): Promise<SessionStatus> {
    return Promise.reject(new NotImplementedError('The Cloud API transport arrives in a later phase.'));
  }

  connect(): Promise<ConnectResult> {
    return Promise.reject(new NotImplementedError('The Cloud API transport arrives in a later phase.'));
  }

  disconnect(): Promise<void> {
    return Promise.reject(new NotImplementedError('The Cloud API transport arrives in a later phase.'));
  }
}

export const cloudApiAdapter = new CloudApiAdapter();
