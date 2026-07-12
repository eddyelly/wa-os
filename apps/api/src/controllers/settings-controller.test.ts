import type { Request, Response } from 'express';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { runWithRequestContext } from '../lib/context.js';

// vi.hoisted is required because vi.mock's factory below is hoisted above
// this file's imports; a plain top-level const referenced from inside the
// factory would throw a temporal-dead-zone ReferenceError otherwise.
const { findCurrent, update } = vi.hoisted(() => ({
  findCurrent: vi.fn(),
  update: vi.fn(),
}));

vi.mock('../repositories/organization-repository.js', () => ({
  organizationRepository: {
    findCurrent,
    update,
  },
}));

import { updateShopSettings } from './settings-controller.js';

function fakeOrganization(settings: Record<string, unknown> = {}): { settings: Record<string, unknown> } {
  return { settings };
}

function buildReq(body: unknown): Request {
  return { body } as unknown as Request;
}

function buildRes(): Response & { json: ReturnType<typeof vi.fn> } {
  return { json: vi.fn() } as unknown as Response & { json: ReturnType<typeof vi.fn> };
}

describe('settings-controller updateShopSettings', () => {
  beforeEach(() => {
    findCurrent.mockReset();
    update.mockReset();
  });

  it('merges paymentInstructions and ownerAlertPhone into settings, preserving existing keys', async () => {
    findCurrent.mockResolvedValue(fakeOrganization({ aiEnabled: true }));
    update.mockResolvedValue(
      fakeOrganization({
        aiEnabled: true,
        paymentInstructions: 'Pay via M-Pesa to 0700 000 000.',
        ownerAlertPhone: '+255700000000',
      }),
    );
    const req = buildReq({
      paymentInstructions: 'Pay via M-Pesa to 0700 000 000.',
      ownerAlertPhone: '+255700000000',
    });
    const res = buildRes();

    await runWithRequestContext({ organizationId: 'org1', userId: 'u1', role: 'OWNER' }, () =>
      updateShopSettings(req, res),
    );

    expect(update).toHaveBeenCalledWith('org1', {
      settings: {
        aiEnabled: true,
        paymentInstructions: 'Pay via M-Pesa to 0700 000 000.',
        ownerAlertPhone: '+255700000000',
      },
    });
    expect(res.json).toHaveBeenCalledWith({
      settings: {
        aiEnabled: true,
        paymentInstructions: 'Pay via M-Pesa to 0700 000 000.',
        ownerAlertPhone: '+255700000000',
      },
    });
  });

  it('clears the stored owner alert phone when sent explicitly as null', async () => {
    findCurrent.mockResolvedValue(
      fakeOrganization({ aiEnabled: true, ownerAlertPhone: '+255700000000' }),
    );
    update.mockResolvedValue(fakeOrganization({ aiEnabled: true, ownerAlertPhone: null }));
    const req = buildReq({ ownerAlertPhone: null });
    const res = buildRes();

    await runWithRequestContext({ organizationId: 'org1', userId: 'u1', role: 'OWNER' }, () =>
      updateShopSettings(req, res),
    );

    expect(update).toHaveBeenCalledWith('org1', {
      settings: { aiEnabled: true, ownerAlertPhone: null },
    });
  });

  it('preserves unrelated settings keys when only ownerAlertsEnabled changes', async () => {
    findCurrent.mockResolvedValue(
      fakeOrganization({ aiEnabled: false, toneNotes: 'warm and brief' }),
    );
    update.mockResolvedValue(
      fakeOrganization({ aiEnabled: false, toneNotes: 'warm and brief', ownerAlertsEnabled: true }),
    );
    const req = buildReq({ ownerAlertsEnabled: true });
    const res = buildRes();

    await runWithRequestContext({ organizationId: 'org1', userId: 'u1', role: 'OWNER' }, () =>
      updateShopSettings(req, res),
    );

    expect(update).toHaveBeenCalledWith('org1', {
      settings: { aiEnabled: false, toneNotes: 'warm and brief', ownerAlertsEnabled: true },
    });
  });
});
