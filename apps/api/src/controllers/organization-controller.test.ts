import type { Request, Response } from 'express';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { runWithRequestContext } from '../lib/context.js';
import { ForbiddenError } from '../lib/errors.js';

// vi.hoisted is required because vi.mock's factory below is hoisted above
// this file's imports; a plain top-level const referenced from inside the
// factory would throw a temporal-dead-zone ReferenceError otherwise.
const { update } = vi.hoisted(() => ({
  update: vi.fn(),
}));

vi.mock('../repositories/organization-repository.js', () => ({
  organizationRepository: {
    update,
  },
}));

import { update as updateOrganization } from './organization-controller.js';

// Mirrors the fields the controller echoes back on res.json. This layer
// must never import `@prisma/client` (see eslint no-restricted-imports for
// apps/api/src/controllers/**), so this is a local shape, not the Prisma
// `Organization` type.
interface FakeOrganization {
  id: string;
  name: string;
  vertical: string;
  language: string;
  timezone: string;
  settings: Record<string, unknown>;
  modules: string[];
}

function fakeOrganization(overrides: Partial<FakeOrganization> = {}): FakeOrganization {
  return {
    id: 'org1',
    name: 'Nuru Salon',
    vertical: 'local-services',
    language: 'sw',
    timezone: 'Africa/Dar_es_Salaam',
    settings: {},
    modules: ['appointments'],
    ...overrides,
  };
}

function buildReq(body: unknown): Request {
  return { body } as unknown as Request;
}

function buildRes(): Response & { json: ReturnType<typeof vi.fn> } {
  return { json: vi.fn() } as unknown as Response & { json: ReturnType<typeof vi.fn> };
}

describe('organization-controller update', () => {
  beforeEach(() => {
    update.mockReset();
  });

  it('rejects a STAFF request that includes modules', async () => {
    update.mockResolvedValue(fakeOrganization());
    const req = buildReq({ modules: ['shop'] });
    const res = buildRes();

    await expect(
      runWithRequestContext({ organizationId: 'org1', userId: 'u1', role: 'STAFF' }, () =>
        updateOrganization(req, res),
      ),
    ).rejects.toBeInstanceOf(ForbiddenError);

    expect(update).not.toHaveBeenCalled();
  });

  it('lets a STAFF request update non-module fields', async () => {
    const updated = fakeOrganization({ name: 'New Name' });
    update.mockResolvedValue(updated);
    const req = buildReq({ name: 'New Name' });
    const res = buildRes();

    await runWithRequestContext({ organizationId: 'org1', userId: 'u1', role: 'STAFF' }, () =>
      updateOrganization(req, res),
    );

    expect(update).toHaveBeenCalledWith('org1', { name: 'New Name' });
    expect(res.json).toHaveBeenCalledWith({
      organization: {
        id: updated.id,
        name: updated.name,
        vertical: updated.vertical,
        language: updated.language,
        timezone: updated.timezone,
        modules: updated.modules,
        settings: updated.settings,
      },
    });
  });

  it('lets an OWNER change modules and passes the deduped list through', async () => {
    const updated = fakeOrganization({ modules: ['appointments', 'shop'] });
    update.mockResolvedValue(updated);
    const req = buildReq({ modules: ['appointments', 'shop', 'appointments'] });
    const res = buildRes();

    await runWithRequestContext({ organizationId: 'org1', userId: 'u1', role: 'OWNER' }, () =>
      updateOrganization(req, res),
    );

    expect(update).toHaveBeenCalledWith('org1', { modules: ['appointments', 'shop'] });
    expect(res.json).toHaveBeenCalledWith({
      organization: {
        id: updated.id,
        name: updated.name,
        vertical: updated.vertical,
        language: updated.language,
        timezone: updated.timezone,
        modules: updated.modules,
        settings: updated.settings,
      },
    });
  });
});
