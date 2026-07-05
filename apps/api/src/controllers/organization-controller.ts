import type { Request, Response } from 'express';
import { updateOrganizationRequestSchema } from '@waos/shared';
import { requireRequestContext } from '../lib/context.js';
import { NotFoundError } from '../lib/errors.js';
import { organizationRepository } from '../repositories/organization-repository.js';
import { userRepository } from '../repositories/user-repository.js';

export const get = async (_req: Request, res: Response): Promise<void> => {
  const { organizationId } = requireRequestContext();
  const organization = await organizationRepository.findCurrent(organizationId);
  if (!organization) {
    throw new NotFoundError('Your business could not be found.');
  }
  res.json({
    organization: {
      id: organization.id,
      name: organization.name,
      vertical: organization.vertical,
      language: organization.language,
      timezone: organization.timezone,
      settings: organization.settings,
    },
  });
};

export const update = async (req: Request, res: Response): Promise<void> => {
  const input = updateOrganizationRequestSchema.parse(req.body);
  const { organizationId } = requireRequestContext();
  const organization = await organizationRepository.update(organizationId, input);
  res.json({
    organization: {
      id: organization.id,
      name: organization.name,
      vertical: organization.vertical,
      language: organization.language,
      timezone: organization.timezone,
      settings: organization.settings,
    },
  });
};

export const listUsers = async (_req: Request, res: Response): Promise<void> => {
  const users = await userRepository.listForOrg();
  res.json({ users });
};
