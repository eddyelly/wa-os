import { PrismaClient } from '@prisma/client';
import { requireRequestContext } from './context.js';
import { createTenantExtension } from './tenant.js';

/**
 * Pre-auth client. Only for flows that run before a tenant exists or is
 * known: signup, login, refresh, seeds, and boot-time reconciliation. All
 * request-scoped data access goes through `prisma` below.
 */
export const basePrisma = new PrismaClient();

/**
 * Tenant-scoped client: every query is filtered to the organization of the
 * authenticated request (see lib/tenant.ts). Throws MissingTenantContextError
 * outside a request context, so unscoped access fails closed.
 */
export const prisma = basePrisma.$extends(
  createTenantExtension(() => requireRequestContext().organizationId),
);

export type TenantPrismaClient = typeof prisma;
