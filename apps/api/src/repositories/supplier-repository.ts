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

/** Update accepts null on the optional fields to clear them. */
export type UpdateSupplierData = {
  name?: string;
  country?: string;
} & {
  [K in Exclude<keyof CreateSupplierData, 'name' | 'country'>]?: string | null;
};

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

  /** Optional fields accept null to clear a previously set value. */
  update(id: string, data: UpdateSupplierData): Promise<SupplierWithCount> {
    return prisma.supplier.update({ where: { id }, data, include: withCount });
  },

  /**
   * Deleting a supplier cascades through its items to their photos, so this
   * returns every media key the cascade removed for the caller to delete
   * from storage. Read them first: after the delete the rows are gone and
   * the keys are unrecoverable.
   */
  async remove(id: string): Promise<string[]> {
    const images = await prisma.sourcedItemImage.findMany({
      where: { sourcedItem: { supplierId: id } },
      select: { mediaKey: true },
    });
    await prisma.supplier.delete({ where: { id } });
    return images.map((image) => image.mediaKey);
  },
};
