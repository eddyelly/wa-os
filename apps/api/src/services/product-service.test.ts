import { beforeEach, describe, expect, it, vi } from 'vitest';
import { logger } from '../lib/logger.js';
import { NotFoundError } from '../lib/errors.js';
import type { ProductWithImages } from '../repositories/product-repository.js';

interface FakeImage {
  id: string;
  mediaKey: string;
  description: string;
}

interface FakeProduct {
  id: string;
  name: string;
  description: string | null;
  price: number;
  minPrice: number | null;
  stockQty: number;
  lowStockThreshold: number;
  isActive: boolean;
  tags: string[];
  images: FakeImage[];
  createdAt: Date;
  updatedAt: Date;
}

// vi.hoisted is required (see apps/api/src/lib/queues.test.ts) because the
// vi.mock factories below are hoisted above these consts; a plain top-level
// const referenced from inside a factory would throw a temporal-dead-zone
// ReferenceError otherwise.
const { store, repo, embed, getMediaUrl } = vi.hoisted(() => {
  const store = new Map<string, FakeProduct>();
  let nextId = 1;

  const repo = {
    create: vi.fn(
      (data: {
        name: string;
        description?: string;
        price: number;
        minPrice?: number;
        stockQty: number;
        lowStockThreshold: number;
        tags: string[];
      }) => {
        const id = `p${nextId++}`;
        const product: FakeProduct = {
          id,
          name: data.name,
          description: data.description ?? null,
          price: data.price,
          minPrice: data.minPrice ?? null,
          stockQty: data.stockQty,
          lowStockThreshold: data.lowStockThreshold,
          isActive: true,
          tags: data.tags,
          images: [],
          createdAt: new Date('2026-01-01T00:00:00Z'),
          updatedAt: new Date('2026-01-01T00:00:00Z'),
        };
        store.set(id, product);
        return Promise.resolve(product);
      },
    ),
    findById: vi.fn((id: string) => Promise.resolve(store.get(id) ?? null)),
    list: vi.fn(() => Promise.resolve([...store.values()])),
    update: vi.fn((id: string, data: Partial<FakeProduct>) => {
      const existing = store.get(id);
      if (!existing) {
        return Promise.reject(new Error('not found'));
      }
      const updated: FakeProduct = { ...existing, ...data, updatedAt: new Date() };
      store.set(id, updated);
      return Promise.resolve(updated);
    }),
    remove: vi.fn((id: string) => {
      store.delete(id);
      return Promise.resolve();
    }),
    setEmbedding: vi.fn(() => Promise.resolve()),
    searchByEmbedding: vi.fn(() => Promise.resolve([])),
    searchByName: vi.fn(() => Promise.resolve([])),
    adjustStock: vi.fn(),
  };

  const embed = vi.fn();
  const getMediaUrl = vi.fn((key: string) => Promise.resolve(`https://cdn.example/${key}`));

  return { store, repo, embed, getMediaUrl };
});

vi.mock('../repositories/product-repository.js', () => ({ productRepository: repo }));
vi.mock('../adapters/embeddings/embedding-adapter.js', () => ({
  embeddingPort: { embed },
}));
vi.mock('../lib/minio.js', () => ({ getMediaUrl }));

import { productService } from './product-service.js';

describe('productService', () => {
  beforeEach(() => {
    store.clear();
    vi.clearAllMocks();
    embed.mockReset();
    getMediaUrl.mockImplementation((key: string) => Promise.resolve(`https://cdn.example/${key}`));
  });

  it('embeds name + description as a document and stores it via setEmbedding', async () => {
    embed.mockResolvedValue([[0.1, 0.2, 0.3]]);

    const product = await productService.create({
      name: 'Hair oil',
      description: 'Coconut hair oil',
      price: 12000,
      stockQty: 0,
      lowStockThreshold: 5,
      tags: [],
    });

    expect(embed).toHaveBeenCalledTimes(1);
    const [texts, intent] = embed.mock.calls[0] as [string[], string];
    expect(intent).toBe('document');
    expect(texts[0]).toContain('Hair oil');
    expect(texts[0]).toContain('Coconut hair oil');
    expect(repo.setEmbedding).toHaveBeenCalledWith(product.id, [0.1, 0.2, 0.3]);
  });

  it('still succeeds when the embedding port rejects (embedding skipped, warn logged)', async () => {
    embed.mockRejectedValue(new Error('embedding service unavailable'));
    const warnSpy = vi.spyOn(logger, 'warn').mockImplementation(() => logger);

    const product = await productService.create({
      name: 'Hair oil',
      price: 12000,
      stockQty: 0,
      lowStockThreshold: 5,
      tags: [],
    });

    expect(product.name).toBe('Hair oil');
    expect(repo.setEmbedding).not.toHaveBeenCalled();
    expect(warnSpy).toHaveBeenCalled();
    warnSpy.mockRestore();
  });

  it('re-embeds on a name/description change but not on a stock-only change', async () => {
    embed.mockResolvedValue([[0.5]]);
    const product = await productService.create({
      name: 'Hair oil',
      price: 12000,
      stockQty: 10,
      lowStockThreshold: 5,
      tags: [],
    });
    embed.mockClear();
    repo.setEmbedding.mockClear();

    await productService.update(product.id, { stockQty: 8 });
    expect(embed).not.toHaveBeenCalled();
    expect(repo.setEmbedding).not.toHaveBeenCalled();

    await productService.update(product.id, { name: 'Hair oil deluxe' });
    expect(embed).toHaveBeenCalledTimes(1);
    expect(repo.setEmbedding).toHaveBeenCalledTimes(1);
  });

  it('rejects lowering price below the stored minPrice', async () => {
    embed.mockResolvedValue([[0.2]]);
    const product = await productService.create({
      name: 'Wig',
      price: 85000,
      minPrice: 70000,
      stockQty: 3,
      lowStockThreshold: 2,
      tags: [],
    });

    await expect(productService.update(product.id, { price: 50000 })).rejects.toThrow(
      'minPrice cannot exceed price',
    );
  });

  it('toDto presigns each image mediaKey via getMediaUrl and never exposes mediaKey', async () => {
    const fakeProduct: ProductWithImages = {
      id: 'p1',
      organizationId: 'org1',
      name: 'Hair oil',
      description: null,
      price: 12000,
      minPrice: null,
      stockQty: 5,
      lowStockThreshold: 5,
      isActive: true,
      tags: [],
      images: [
        {
          id: 'img1',
          organizationId: 'org1',
          productId: 'p1',
          mediaKey: 'products/img1.jpg',
          description: 'bottle photo',
          createdAt: new Date('2026-01-01T00:00:00Z'),
          updatedAt: new Date('2026-01-01T00:00:00Z'),
        },
      ],
      createdAt: new Date('2026-01-01T00:00:00Z'),
      updatedAt: new Date('2026-01-01T00:00:00Z'),
    };
    const dto = await productService.toDto(fakeProduct);

    expect(getMediaUrl).toHaveBeenCalledWith('products/img1.jpg');
    expect(dto.images).toEqual([
      { id: 'img1', mediaUrl: 'https://cdn.example/products/img1.jpg', description: 'bottle photo' },
    ]);
    expect(JSON.stringify(dto)).not.toContain('mediaKey');
  });

  it('remove() of a missing id throws NotFoundError', async () => {
    await expect(productService.remove('missing')).rejects.toBeInstanceOf(NotFoundError);
    expect(repo.remove).not.toHaveBeenCalled();
  });
});
