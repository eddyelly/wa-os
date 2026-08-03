import type { Prisma, SourcedItem, SourcedItemImage } from '@prisma/client';
import { requireRequestContext } from '../lib/context.js';
import { prisma } from '../lib/prisma.js';

export type SourcedItemWithImages = SourcedItem & { images: SourcedItemImage[] };

export type SourcedItemWithSupplier = SourcedItemWithImages & {
  supplier: { name: string; city: string | null; country: string };
};

export interface CreateSourcedItemData {
  supplierId: string;
  name: string;
  description?: string;
  priceAmount: number;
  priceCurrency: string;
  unit?: string;
  moq?: number;
  notes?: string;
}

/** Update accepts null on the optional fields to clear them. */
export interface UpdateSourcedItemData {
  name?: string;
  description?: string | null;
  priceAmount?: number;
  priceCurrency?: string;
  unit?: string | null;
  moq?: number | null;
  notes?: string | null;
}

const withImages = {
  images: { orderBy: { createdAt: 'asc' } },
} satisfies Prisma.SourcedItemInclude;

export const sourcedItemRepository = {
  create(data: CreateSourcedItemData): Promise<SourcedItemWithImages> {
    return prisma.sourcedItem.create({
      data: {
        supplierId: data.supplierId,
        name: data.name,
        description: data.description ?? null,
        priceAmount: data.priceAmount,
        priceCurrency: data.priceCurrency,
        unit: data.unit ?? null,
        moq: data.moq ?? null,
        notes: data.notes ?? null,
        organizationId: requireRequestContext().organizationId,
      },
      include: withImages,
    });
  },

  findById(id: string): Promise<SourcedItemWithImages | null> {
    return prisma.sourcedItem.findUnique({ where: { id }, include: withImages });
  },

  listBySupplier(supplierId: string): Promise<SourcedItemWithImages[]> {
    return prisma.sourcedItem.findMany({
      where: { supplierId },
      include: withImages,
      orderBy: { createdAt: 'desc' },
    });
  },

  /** Case-insensitive match on item name or description, newest first. */
  search(query: string): Promise<SourcedItemWithSupplier[]> {
    return prisma.sourcedItem.findMany({
      where: {
        OR: [
          { name: { contains: query, mode: 'insensitive' } },
          { description: { contains: query, mode: 'insensitive' } },
        ],
      },
      include: {
        ...withImages,
        supplier: { select: { name: true, city: true, country: true } },
      },
      orderBy: { createdAt: 'desc' },
      take: 50,
    });
  },

  /** Optional fields accept null to clear a previously set value. */
  update(id: string, data: UpdateSourcedItemData): Promise<SourcedItemWithImages> {
    return prisma.sourcedItem.update({ where: { id }, data, include: withImages });
  },

  async remove(id: string): Promise<void> {
    await prisma.sourcedItem.delete({ where: { id } });
  },

  async addImage(sourcedItemId: string, mediaKey: string): Promise<void> {
    await prisma.sourcedItemImage.create({
      data: {
        sourcedItemId,
        mediaKey,
        organizationId: requireRequestContext().organizationId,
      },
    });
  },

  async removeImage(sourcedItemId: string, imageId: string): Promise<void> {
    // The id pair keeps a caller from deleting an image of another item.
    await prisma.sourcedItemImage.deleteMany({ where: { id: imageId, sourcedItemId } });
  },
};
