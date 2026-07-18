import { randomUUID } from 'node:crypto';
import type { CreateProductRequest, ProductDto, UpdateProductRequest } from '@waos/shared';
import type { LLMPort } from '@waos/ports';
import { embeddingPort } from '../adapters/embeddings/embedding-adapter.js';
import { llmPort } from '../adapters/llm/gemini-adapter.js';
import { requireRequestContext } from '../lib/context.js';
import { NotFoundError, ValidationError } from '../lib/errors.js';
import { logger } from '../lib/logger.js';
import { getMediaUrl, putMediaObject } from '../lib/minio.js';
import { productRepository, type ProductWithImages } from '../repositories/product-repository.js';
import { notificationService } from './notification-service.js';

const VISION_DESCRIPTION_MAX_LENGTH = 500;

const VISION_PROMPT =
  'Describe this product photo for a shop catalog in one short paragraph: what the item is, its colors, materials, and any distinguishing features. Plain text, no lists.';

function buildEmbeddingText(product: ProductWithImages): string {
  return [product.name, product.description ?? '', ...product.images.map((image) => image.description)]
    .filter(Boolean)
    .join('\n');
}

/**
 * Vision description for a single product photo. Reused as-is by the
 * customer-photo worker (Task 8), which is why it is a free function rather
 * than a service method: it has no tenant or product concept of its own.
 * Throws on LLM failure; callers decide how to degrade.
 */
export async function describeImage(
  buffer: Buffer,
  mimeType: string,
  ports: { llm: LLMPort } = { llm: llmPort },
): Promise<string> {
  const completion = await ports.llm.complete({
    system: VISION_PROMPT,
    messages: [
      {
        role: 'user',
        content: [{ type: 'image', mimeType, data: buffer.toString('base64') }],
      },
    ],
    maxTokens: 200,
  });
  return completion.text.trim().slice(0, VISION_DESCRIPTION_MAX_LENGTH);
}

export const productService = {
  async toDto(product: ProductWithImages): Promise<ProductDto> {
    const images = await Promise.all(
      product.images.map(async (image) => ({
        id: image.id,
        mediaUrl: await getMediaUrl(image.mediaKey),
        description: image.description,
      })),
    );
    return {
      id: product.id,
      name: product.name,
      description: product.description,
      price: product.price,
      minPrice: product.minPrice,
      stockQty: product.stockQty,
      lowStockThreshold: product.lowStockThreshold,
      isActive: product.isActive,
      tags: product.tags,
      images,
      createdAt: product.createdAt.toISOString(),
      updatedAt: product.updatedAt.toISOString(),
    };
  },

  /**
   * Builds one 'document' embedding from name + description + image
   * descriptions and stores it. Embedding failures are caught and logged
   * here, never surfaced to the caller: a slow or down embedding provider
   * must not block product CRUD.
   */
  async refreshEmbedding(id: string): Promise<void> {
    const product = await productRepository.findById(id);
    if (!product) {
      return;
    }
    const text = buildEmbeddingText(product);
    if (!text) {
      return;
    }
    try {
      const [vector] = await embeddingPort.embed([text], 'document');
      await productRepository.setEmbedding(id, vector ?? null);
    } catch (error) {
      logger.warn({ err: error, productId: id }, 'product embedding failed');
    }
  },

  /**
   * `deferEmbedding` skips the inline embedding refresh so the caller can
   * batch it in the background (the CSV import path: awaiting a Gemini call
   * per row would keep a 200-row request open well past a typical proxy
   * timeout). Manual single-product creation never sets it, so its
   * behavior is unchanged.
   */
  async create(
    input: CreateProductRequest,
    options?: { deferEmbedding?: boolean },
  ): Promise<ProductDto> {
    const product = await productRepository.create({
      name: input.name,
      description: input.description,
      price: input.price,
      minPrice: input.minPrice,
      stockQty: input.stockQty,
      lowStockThreshold: input.lowStockThreshold,
      tags: input.tags,
    });
    if (!options?.deferEmbedding) {
      await this.refreshEmbedding(product.id);
    }
    return this.toDto(product);
  },

  async list(includeInactive: boolean): Promise<ProductDto[]> {
    const rows = await productRepository.list({ includeInactive });
    return Promise.all(rows.map((row) => this.toDto(row)));
  },

  async update(id: string, input: UpdateProductRequest): Promise<ProductDto> {
    const stored = await productRepository.findById(id);
    if (!stored) {
      throw new NotFoundError('This product no longer exists.');
    }
    const effectiveMinPrice = input.minPrice !== undefined ? input.minPrice : stored.minPrice;
    const effectivePrice = input.price !== undefined ? input.price : stored.price;
    if (effectiveMinPrice != null && effectiveMinPrice > effectivePrice) {
      throw new ValidationError('minPrice cannot exceed price');
    }

    const updated = await productRepository.update(id, {
      ...(input.name !== undefined ? { name: input.name } : {}),
      ...(input.description !== undefined ? { description: input.description } : {}),
      ...(input.price !== undefined ? { price: input.price } : {}),
      ...(input.minPrice !== undefined ? { minPrice: input.minPrice } : {}),
      ...(input.stockQty !== undefined ? { stockQty: input.stockQty } : {}),
      ...(input.lowStockThreshold !== undefined ? { lowStockThreshold: input.lowStockThreshold } : {}),
      ...(input.isActive !== undefined ? { isActive: input.isActive } : {}),
      ...(input.tags !== undefined ? { tags: input.tags } : {}),
    });

    if (input.name !== undefined || input.description !== undefined) {
      await this.refreshEmbedding(id);
    }

    // A manual stock edit (the owner correcting a count, not a sale) fires
    // the same LOW_STOCK alert a sale-driven decrement does, but only on
    // the downward crossing: stored qty strictly above the threshold and
    // the new qty at or below it. An upward edit, or an edit that starts
    // and stays at or below threshold, never notifies.
    if (input.stockQty !== undefined) {
      const threshold =
        input.lowStockThreshold !== undefined ? input.lowStockThreshold : stored.lowStockThreshold;
      if (input.stockQty <= threshold && stored.stockQty > threshold) {
        try {
          await notificationService.notify('LOW_STOCK', {
            productId: id,
            name: updated.name,
            stockQty: input.stockQty,
          });
        } catch (error) {
          // Best-effort: the stock update already committed. Log ids only
          // and continue so a slow or down notification path never fails
          // a manual stock correction.
          logger.warn({ err: error, productId: id }, 'low stock notification failed');
        }
      }
    }

    return this.toDto(updated);
  },

  async remove(id: string): Promise<void> {
    const product = await productRepository.findById(id);
    if (!product) {
      throw new NotFoundError('This product no longer exists.');
    }
    await productRepository.remove(id);
  },

  /**
   * Uploads a product photo to MinIO, asks Gemini vision for a catalog
   * description, and refreshes the product's embedding so search picks up
   * the new description. A vision failure is not fatal: the photo is kept
   * with an empty description and the embedding refresh still runs, so a
   * down or slow vision model never blocks a photo upload.
   */
  async addImage(
    id: string,
    file: { buffer: Buffer; mimetype: string; originalname: string },
  ): Promise<ProductDto> {
    if (!file.mimetype.startsWith('image/')) {
      throw new ValidationError('Attach an image file.');
    }
    const product = await productRepository.findById(id);
    if (!product) {
      throw new NotFoundError('This product no longer exists.');
    }

    const { organizationId } = requireRequestContext();
    const mediaKey = `${organizationId}/products/${id}/${randomUUID()}`;
    await putMediaObject(mediaKey, file.buffer, file.mimetype);

    let description = '';
    try {
      description = await describeImage(file.buffer, file.mimetype);
    } catch (error) {
      logger.warn({ err: error, productId: id }, 'product image description failed');
    }

    await productRepository.addImage(id, { mediaKey, description });
    await this.refreshEmbedding(id);

    const updated = await productRepository.findById(id);
    if (!updated) {
      throw new NotFoundError('This product no longer exists.');
    }
    return this.toDto(updated);
  },

  async removeImage(id: string, imageId: string): Promise<ProductDto> {
    await productRepository.removeImage(id, imageId);
    await this.refreshEmbedding(id);

    const updated = await productRepository.findById(id);
    if (!updated) {
      throw new NotFoundError('This product no longer exists.');
    }
    return this.toDto(updated);
  },
};
