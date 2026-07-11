import { describe, expect, it, vi } from 'vitest';
import type { NextFunction, Request, Response } from 'express';
import { runWithRequestContext } from '../lib/context.js';
import { ModuleDisabledError } from '../lib/errors.js';

vi.mock('../repositories/organization-repository.js', () => ({
  organizationRepository: {
    findCurrent: vi.fn((id: string) =>
      Promise.resolve({ id, modules: ['appointments'] as string[] }),
    ),
  },
}));

import { requireModule } from './require-module.js';

const ctx = { organizationId: 'org1', userId: 'u1', role: 'OWNER' as const };

async function invoke(module: 'appointments' | 'shop'): Promise<unknown> {
  return new Promise((resolve) => {
    const next: NextFunction = (err?: unknown) => {
      resolve(err);
    };
    void runWithRequestContext(ctx, () =>
      requireModule(module)({} as Request, {} as Response, next),
    );
  });
}

describe('requireModule', () => {
  it('passes when the module is enabled', async () => {
    expect(await invoke('appointments')).toBeUndefined();
  });

  it('rejects with ModuleDisabledError when the module is off', async () => {
    const err = await invoke('shop');
    expect(err).toBeInstanceOf(ModuleDisabledError);
    expect((err as ModuleDisabledError).code).toBe('MODULE_DISABLED');
    expect((err as ModuleDisabledError).statusCode).toBe(403);
  });
});
