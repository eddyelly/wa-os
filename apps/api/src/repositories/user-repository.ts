import type { Prisma, PrismaClient, User } from '@prisma/client';
import { basePrisma, prisma } from '../lib/prisma.js';

type TransactionClient = Prisma.TransactionClient | PrismaClient;

export const userRepository = {
  /** Pre-auth lookup for login and refresh; email is globally unique. */
  findByEmailPreAuth(email: string): Promise<User | null> {
    return basePrisma.user.findUnique({ where: { email } });
  },

  /** Pre-auth lookup used by token refresh to confirm the user still exists. */
  findByIdPreAuth(id: string): Promise<User | null> {
    return basePrisma.user.findUnique({ where: { id } });
  },

  /** Tenant-scoped lookup; returns null for users of other organizations. */
  findById(id: string): Promise<User | null> {
    return prisma.user.findUnique({ where: { id } });
  },

  createOwner(
    tx: TransactionClient,
    data: { organizationId: string; email: string; passwordHash: string; name: string },
  ): Promise<User> {
    return tx.user.create({ data: { ...data, role: 'OWNER' } });
  },
};
