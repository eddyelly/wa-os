import { beforeEach, describe, expect, it, vi } from 'vitest';

const { repo, supplierRepo, getMediaUrl } = vi.hoisted(() => ({
  repo: {
    create: vi.fn(),
    findById: vi.fn(),
    listBySupplier: vi.fn(),
    update: vi.fn(),
    remove: vi.fn(),
    addImage: vi.fn(),
    removeImage: vi.fn(),
  },
  supplierRepo: { findById: vi.fn() },
  getMediaUrl: vi.fn((key: string) => Promise.resolve(`https://cdn.example/${key}`)),
}));
vi.mock('../repositories/sourced-item-repository.js', () => ({ sourcedItemRepository: repo }));
vi.mock('../repositories/supplier-repository.js', () => ({ supplierRepository: supplierRepo }));
vi.mock('../lib/minio.js', () => ({ getMediaUrl, putMediaObject: vi.fn() }));

import { sourcedItemService } from './sourced-item-service.js';

const row = {
  id: 'i1',
  supplierId: 's1',
  name: 'Leather handbag',
  description: null,
  priceAmount: 4550,
  priceCurrency: 'CNY',
  unit: 'per piece',
  moq: 50,
  notes: null,
  images: [{ id: 'img1', mediaKey: 'org/sourcing/img1.jpg' }],
  createdAt: new Date('2026-08-01T00:00:00Z'),
  updatedAt: new Date('2026-08-01T00:00:00Z'),
};

beforeEach(() => {
  vi.clearAllMocks();
  supplierRepo.findById.mockResolvedValue({ id: 's1' });
});

describe('sourcedItemService', () => {
  it('maps a row to a DTO with presigned image urls and never exposes mediaKey', async () => {
    repo.listBySupplier.mockResolvedValue([row]);
    const [dto] = await sourcedItemService.listBySupplier('s1');
    expect(dto).toEqual({
      id: 'i1',
      supplierId: 's1',
      name: 'Leather handbag',
      description: null,
      priceAmount: 4550,
      priceCurrency: 'CNY',
      unit: 'per piece',
      moq: 50,
      notes: null,
      images: [{ id: 'img1', mediaUrl: 'https://cdn.example/org/sourcing/img1.jpg' }],
      createdAt: '2026-08-01T00:00:00.000Z',
      updatedAt: '2026-08-01T00:00:00.000Z',
    });
    expect(JSON.stringify(dto)).not.toContain('mediaKey');
  });

  it('refuses to create an item for a supplier that does not exist', async () => {
    supplierRepo.findById.mockResolvedValue(null);
    await expect(
      sourcedItemService.create('missing', {
        name: 'x',
        priceAmount: 100,
        priceCurrency: 'CNY',
      }),
    ).rejects.toThrow();
    expect(repo.create).not.toHaveBeenCalled();
  });

  it('refuses to update an item that belongs to a different supplier', async () => {
    repo.findById.mockResolvedValue({ ...row, supplierId: 'other' });
    await expect(sourcedItemService.update('s1', 'i1', { name: 'x' })).rejects.toThrow();
    expect(repo.update).not.toHaveBeenCalled();
  });
});
