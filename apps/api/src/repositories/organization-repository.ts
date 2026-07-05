import type { Organization, Prisma, PrismaClient } from '@prisma/client';
import { basePrisma, prisma } from '../lib/prisma.js';

type TransactionClient = Prisma.TransactionClient | PrismaClient;

export const organizationRepository = {
  /** Tenant-scoped: only ever returns the caller's own organization. */
  findCurrent(id: string): Promise<Organization | null> {
    return prisma.organization.findUnique({ where: { id } });
  },

  /** Pre-auth lookup for flows that run before a request context exists. */
  findByIdPreAuth(id: string): Promise<Organization | null> {
    return basePrisma.organization.findUnique({ where: { id } });
  },

  create(
    tx: TransactionClient,
    data: { name: string; vertical: string; language: string; timezone: string },
  ): Promise<Organization> {
    return tx.organization.create({ data });
  },
};
