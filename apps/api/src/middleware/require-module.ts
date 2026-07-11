import type { NextFunction, Request, RequestHandler, Response } from 'express';
import type { BusinessModule } from '@waos/shared';
import { requireRequestContext } from '../lib/context.js';
import { ModuleDisabledError, NotFoundError } from '../lib/errors.js';
import { organizationRepository } from '../repositories/organization-repository.js';

/** Gate a router behind an enabled organization module. Mount after requireAuth. */
export function requireModule(module: BusinessModule): RequestHandler {
  return async (_req: Request, _res: Response, next: NextFunction): Promise<void> => {
    try {
      const { organizationId } = requireRequestContext();
      const organization = await organizationRepository.findCurrent(organizationId);
      if (!organization) {
        throw new NotFoundError('Your business could not be found.');
      }
      if (!organization.modules.includes(module)) {
        throw new ModuleDisabledError(module);
      }
      next();
    } catch (error) {
      next(error);
    }
  };
}
