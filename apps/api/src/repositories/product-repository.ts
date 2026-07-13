import { Prisma, type Product, type ProductImage } from '@prisma/client';
import { requireRequestContext } from '../lib/context.js';
import { NotFoundError, ValidationError } from '../lib/errors.js';
import { basePrisma, prisma } from '../lib/prisma.js';

export type ProductWithImages = Product & { images: ProductImage[] };

export interface ProductSearchResult {
  id: string;
  name: string;
  description: string | null;
  price: number;
  stockQty: number;
  isActive: boolean;
  score: number;
}

interface CreateProductData {
  name: string;
  description?: string;
  price: number;
  minPrice?: number;
  stockQty: number;
  lowStockThreshold: number;
  tags: string[];
}

type UpdateProductData = Partial<{
  name: string;
  description: string | null;
  price: number;
  minPrice: number | null;
  stockQty: number;
  lowStockThreshold: number;
  isActive: boolean;
  tags: string[];
}>;

function toVectorLiteral(embedding: number[]): string {
  return `[${embedding.join(',')}]`;
}

export const productRepository = {
  create(data: CreateProductData): Promise<ProductWithImages> {
    return prisma.product.create({
      data: {
        name: data.name,
        description: data.description ?? null,
        price: data.price,
        minPrice: data.minPrice ?? null,
        stockQty: data.stockQty,
        lowStockThreshold: data.lowStockThreshold,
        tags: data.tags,
        organizationId: requireRequestContext().organizationId,
      },
      include: { images: { orderBy: { createdAt: 'asc' } } },
    });
  },

  findById(id: string): Promise<ProductWithImages | null> {
    return prisma.product.findUnique({
      where: { id },
      include: { images: { orderBy: { createdAt: 'asc' } } },
    });
  },

  list(params: { includeInactive?: boolean } = {}): Promise<ProductWithImages[]> {
    return prisma.product.findMany({
      where: params.includeInactive ? {} : { isActive: true },
      include: { images: { orderBy: { createdAt: 'asc' } } },
      orderBy: { createdAt: 'desc' },
    });
  },

  /**
   * Count active products at or below their low-stock threshold. Prisma has
   * no column-to-column comparison in `where`, so the comparison runs in JS
   * over a lean projection. The catalog is small (MVP scale), so this stays
   * within the tenant-scoped client and avoids raw SQL. Read-only.
   */
  async countLowStock(): Promise<number> {
    const rows = await prisma.product.findMany({
      where: { isActive: true },
      select: { stockQty: true, lowStockThreshold: true },
    });
    return rows.filter((row) => row.stockQty <= row.lowStockThreshold).length;
  },

  update(id: string, data: UpdateProductData): Promise<ProductWithImages> {
    return prisma.product.update({
      where: { id },
      data,
      include: { images: { orderBy: { createdAt: 'asc' } } },
    });
  },

  async remove(id: string): Promise<void> {
    await prisma.product.delete({ where: { id } });
  },

  /**
   * Raw SQL because Prisma cannot write to the Unsupported vector column.
   * Copies the org-scoped, parameterized pattern from
   * knowledge-repository.ts exactly: never $queryRawUnsafe, the tenant
   * filter is bound explicitly here rather than left to the caller.
   */
  async setEmbedding(id: string, embedding: number[] | null): Promise<void> {
    const { organizationId } = requireRequestContext();
    if (embedding) {
      await basePrisma.$executeRaw(
        Prisma.sql`
          UPDATE "Product"
          SET embedding = ${toVectorLiteral(embedding)}::vector, "updatedAt" = now()
          WHERE id = ${id} AND "organizationId" = ${organizationId}
        `,
      );
      return;
    }
    await basePrisma.$executeRaw(
      Prisma.sql`
        UPDATE "Product"
        SET embedding = NULL, "updatedAt" = now()
        WHERE id = ${id} AND "organizationId" = ${organizationId}
      `,
    );
  },

  /**
   * Top-k cosine similarity, scoped to the calling organization,
   * active-only, with a relevance floor so unrelated products never surface.
   */
  async searchByEmbedding(
    queryEmbedding: number[],
    k = 5,
    floor = 0.3,
  ): Promise<ProductSearchResult[]> {
    const { organizationId } = requireRequestContext();
    const vector = toVectorLiteral(queryEmbedding);
    const rows = await basePrisma.$queryRaw<ProductSearchResult[]>(
      Prisma.sql`
        SELECT id, name, description, price, "stockQty", "isActive",
               1 - (embedding <=> ${vector}::vector) AS score
        FROM "Product"
        WHERE "organizationId" = ${organizationId}
          AND "isActive" = true
          AND embedding IS NOT NULL
        ORDER BY embedding <=> ${vector}::vector
        LIMIT ${k}
      `,
    );
    return rows.filter((row) => row.score >= floor);
  },

  /** ILIKE fallback for organizations with no embedded products yet. */
  searchByName(query: string, k = 5): Promise<ProductWithImages[]> {
    return prisma.product.findMany({
      where: { name: { contains: query, mode: 'insensitive' }, isActive: true },
      include: { images: true },
      take: k,
    });
  },

  /**
   * Creates the ProductImage row directly (not a nested write: the tenant
   * extension forbids those). The tenant client forces organizationId onto
   * the create, so this can never attach an image to another tenant's row.
   */
  async addImage(productId: string, data: { mediaKey: string; description: string }): Promise<void> {
    await prisma.productImage.create({
      data: {
        productId,
        mediaKey: data.mediaKey,
        description: data.description,
        // Overridden by the tenant extension at runtime; the generated
        // Prisma type still requires it here.
        organizationId: requireRequestContext().organizationId,
      },
    });
  },

  /**
   * Verifies the image belongs to this product before deleting it, so a
   * caller cannot remove another product's photo by guessing its id.
   */
  async removeImage(productId: string, imageId: string): Promise<void> {
    const image = await prisma.productImage.findUnique({ where: { id: imageId } });
    if (!image || image.productId !== productId) {
      throw new NotFoundError('This product photo no longer exists.');
    }
    await prisma.productImage.delete({ where: { id: imageId } });
  },

  /**
   * Atomic stock adjustment. Reads the current row, validates the floor,
   * and writes inside a single transaction on the tenant client so the
   * check and the increment cannot race; the tenant extension carries
   * through into the transaction client, so this stays org-scoped.
   */
  adjustStock(
    id: string,
    delta: number,
  ): Promise<{ stockQty: number; lowStockThreshold: number; name: string }> {
    return prisma.$transaction(async (tx) => {
      const current = await tx.product.findUnique({ where: { id } });
      if (!current) {
        throw new NotFoundError('This product no longer exists.');
      }
      if (current.stockQty + delta < 0) {
        throw new ValidationError('stock cannot go negative');
      }
      const updated = await tx.product.update({
        where: { id },
        data: { stockQty: { increment: delta } },
      });
      return {
        stockQty: updated.stockQty,
        lowStockThreshold: updated.lowStockThreshold,
        name: updated.name,
      };
    });
  },
};
