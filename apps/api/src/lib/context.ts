import { AsyncLocalStorage } from 'node:async_hooks';
import type { UserRole } from '@waos/shared';
import { MissingTenantContextError } from './errors.js';

export interface RequestContext {
  organizationId: string;
  userId: string;
  role: UserRole;
}

const storage = new AsyncLocalStorage<RequestContext>();

export function runWithRequestContext<T>(context: RequestContext, fn: () => T): T {
  return storage.run(context, fn);
}

export function getRequestContext(): RequestContext | undefined {
  return storage.getStore();
}

export function requireRequestContext(): RequestContext {
  const context = storage.getStore();
  if (!context) {
    throw new MissingTenantContextError();
  }
  return context;
}
