import { Prisma, type Contact } from '@prisma/client';
import { requireRequestContext } from '../lib/context.js';
import { prisma } from '../lib/prisma.js';

export const contactRepository = {
  findByPhone(phone: string): Promise<Contact | null> {
    return prisma.contact.findFirst({ where: { phone } });
  },

  findById(id: string): Promise<Contact | null> {
    return prisma.contact.findUnique({ where: { id } });
  },

  async upsertByPhone(phone: string, name?: string): Promise<Contact> {
    const existing = await prisma.contact.findFirst({ where: { phone } });
    if (existing) {
      if (name && !existing.name) {
        return prisma.contact.update({ where: { id: existing.id }, data: { name } });
      }
      return existing;
    }
    try {
      return await prisma.contact.create({
        data: {
          phone,
          name: name ?? null,
          organizationId: requireRequestContext().organizationId,
        },
      });
    } catch (error) {
      // Concurrent webhook deliveries can race on the unique (org, phone).
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        const winner = await prisma.contact.findFirst({ where: { phone } });
        if (winner) {
          return winner;
        }
      }
      throw error;
    }
  },

  setOptedIn(id: string): Promise<Contact> {
    return prisma.contact.update({ where: { id }, data: { optedInAt: new Date() } });
  },

  list(params: { search?: string; tag?: string }): Promise<Contact[]> {
    return prisma.contact.findMany({
      where: {
        ...(params.search
          ? {
              OR: [
                { name: { contains: params.search, mode: 'insensitive' } },
                { phone: { contains: params.search } },
              ],
            }
          : {}),
        ...(params.tag ? { tags: { has: params.tag } } : {}),
      },
      orderBy: { updatedAt: 'desc' },
      take: 200,
    });
  },

  update(
    id: string,
    data: { name?: string | null; language?: string | null; tags?: string[]; customFields?: Prisma.InputJsonValue },
  ): Promise<Contact> {
    return prisma.contact.update({ where: { id }, data });
  },
};
