import type { Prisma, Supplier } from '@prisma/client';
import { requireRequestContext } from '../lib/context.js';
import { prisma } from '../lib/prisma.js';

export type SupplierWithCount = Supplier & { _count: { items: number } };

export interface CreateSupplierData {
  name: string;
  country: string;
  city?: string;
  market?: string;
  address?: string;
  contactName?: string;
  contactPhone?: string;
  contactNote?: string;
  notes?: string;
}

const withCount = { _count: { select: { items: true } } } satisfies Prisma.SupplierInclude;

export const supplierRepository = {
  create(data: CreateSupplierData): Promise<SupplierWithCount> {
    return prisma.supplier.create({
      data: {
        name: data.name,
        country: data.country,
        city: data.city ?? null,
        market: data.market ?? null,
        address: data.address ?? null,
        contactName: data.contactName ?? null,
        contactPhone: data.contactPhone ?? null,
        contactNote: data.contactNote ?? null,
        notes: data.notes ?? null,
        organizationId: requireRequestContext().organizationId,
      },
      include: withCount,
    });
  },

  findById(id: string): Promise<SupplierWithCount | null> {
    return prisma.supplier.findUnique({ where: { id }, include: withCount });
  },

  list(): Promise<SupplierWithCount[]> {
    return prisma.supplier.findMany({ include: withCount, orderBy: { createdAt: 'desc' } });
  },

  update(id: string, data: Partial<CreateSupplierData>): Promise<SupplierWithCount> {
    return prisma.supplier.update({ where: { id }, data, include: withCount });
  },

  async remove(id: string): Promise<void> {
    await prisma.supplier.delete({ where: { id } });
  },
};
