import type {
  CreateSourcedItemRequest,
  SourcedItemDto,
  SourcedItemSearchResult,
  UpdateSourcedItemRequest,
} from '@waos/shared';
import { NotFoundError } from '../lib/errors.js';
import { deleteMediaObjects, getMediaUrl, putMediaObject } from '../lib/minio.js';
import { requireRequestContext } from '../lib/context.js';
import {
  sourcedItemRepository,
  type SourcedItemWithImages,
  type SourcedItemWithSupplier,
} from '../repositories/sourced-item-repository.js';
import { supplierRepository } from '../repositories/supplier-repository.js';

async function assertSupplier(supplierId: string): Promise<void> {
  const supplier = await supplierRepository.findById(supplierId);
  if (!supplier) {
    throw new NotFoundError('This supplier no longer exists.');
  }
}

async function loadOwned(supplierId: string, itemId: string): Promise<SourcedItemWithImages> {
  const item = await sourcedItemRepository.findById(itemId);
  if (!item || item.supplierId !== supplierId) {
    throw new NotFoundError('This item no longer exists.');
  }
  return item;
}

export const sourcedItemService = {
  async toDto(item: SourcedItemWithImages): Promise<SourcedItemDto> {
    return {
      id: item.id,
      supplierId: item.supplierId,
      name: item.name,
      description: item.description,
      priceAmount: item.priceAmount,
      priceCurrency: item.priceCurrency,
      unit: item.unit,
      moq: item.moq,
      notes: item.notes,
      images: await Promise.all(
        item.images.map(async (image) => ({
          id: image.id,
          mediaUrl: await getMediaUrl(image.mediaKey),
        })),
      ),
      createdAt: item.createdAt.toISOString(),
      updatedAt: item.updatedAt.toISOString(),
    };
  },

  async create(supplierId: string, input: CreateSourcedItemRequest): Promise<SourcedItemDto> {
    await assertSupplier(supplierId);
    const item = await sourcedItemRepository.create({ ...input, supplierId });
    return this.toDto(item);
  },

  async listBySupplier(supplierId: string): Promise<SourcedItemDto[]> {
    await assertSupplier(supplierId);
    const rows = await sourcedItemRepository.listBySupplier(supplierId);
    return Promise.all(rows.map((row) => this.toDto(row)));
  },

  async update(
    supplierId: string,
    itemId: string,
    input: UpdateSourcedItemRequest,
  ): Promise<SourcedItemDto> {
    await loadOwned(supplierId, itemId);
    return this.toDto(await sourcedItemRepository.update(itemId, input));
  },

  async remove(supplierId: string, itemId: string): Promise<void> {
    await loadOwned(supplierId, itemId);
    const mediaKeys = await sourcedItemRepository.remove(itemId);
    await deleteMediaObjects(mediaKeys);
  },

  async addImage(
    supplierId: string,
    itemId: string,
    file: { buffer: Buffer; mimeType: string },
  ): Promise<SourcedItemDto> {
    await loadOwned(supplierId, itemId);
    const key = `${requireRequestContext().organizationId}/sourcing/${itemId}/${Date.now()}`;
    const mediaKey = await putMediaObject(key, file.buffer, file.mimeType);
    await sourcedItemRepository.addImage(itemId, mediaKey);
    return this.toDto(await loadOwned(supplierId, itemId));
  },

  async removeImage(supplierId: string, itemId: string, imageId: string): Promise<SourcedItemDto> {
    await loadOwned(supplierId, itemId);
    const mediaKey = await sourcedItemRepository.removeImage(itemId, imageId);
    await deleteMediaObjects(mediaKey ? [mediaKey] : []);
    return this.toDto(await loadOwned(supplierId, itemId));
  },

  /**
   * The six-months-later question: "where did I get this, and what did it
   * cost?" A blank query returns nothing rather than dumping the whole
   * directory.
   */
  async search(query: string): Promise<SourcedItemSearchResult[]> {
    const trimmed = query.trim();
    if (trimmed.length === 0) {
      return [];
    }
    const rows = await sourcedItemRepository.search(trimmed);
    return Promise.all(
      rows.map(async (row: SourcedItemWithSupplier) => ({
        ...(await this.toDto(row)),
        supplierName: row.supplier.name,
        supplierCity: row.supplier.city,
        supplierCountry: row.supplier.country,
      })),
    );
  },
};
