import { beforeEach, describe, expect, it, vi } from 'vitest';

const { repo, supplierRepo, getMediaUrl, deleteMediaObjects } = vi.hoisted(() => ({
  repo: {
    create: vi.fn(),
    findById: vi.fn(),
    listBySupplier: vi.fn(),
    update: vi.fn(),
    remove: vi.fn(),
    addImage: vi.fn(),
    removeImage: vi.fn(),
    search: vi.fn(),
  },
  supplierRepo: { findById: vi.fn() },
  getMediaUrl: vi.fn((key: string) => Promise.resolve(`https://cdn.example/${key}`)),
  deleteMediaObjects: vi.fn(() => Promise.resolve()),
}));
vi.mock('../repositories/sourced-item-repository.js', () => ({ sourcedItemRepository: repo }));
vi.mock('../repositories/supplier-repository.js', () => ({ supplierRepository: supplierRepo }));
vi.mock('../lib/minio.js', () => ({ getMediaUrl, putMediaObject: vi.fn(), deleteMediaObjects }));

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

  it('maps search hits to results carrying the supplier name and city', async () => {
    repo.search.mockResolvedValue([
      { ...row, supplier: { name: 'Guangzhou Bag City', city: 'Guangzhou', country: 'CN' } },
    ]);
    const [hit] = await sourcedItemService.search('handbag');
    expect(hit).toMatchObject({
      id: 'i1',
      name: 'Leather handbag',
      priceAmount: 4550,
      priceCurrency: 'CNY',
      supplierName: 'Guangzhou Bag City',
      supplierCity: 'Guangzhou',
      supplierCountry: 'CN',
    });
  });

  it('returns nothing for a blank query instead of listing everything', async () => {
    await expect(sourcedItemService.search('   ')).resolves.toEqual([]);
    expect(repo.search).not.toHaveBeenCalled();
  });

  it('deleting an item deletes its stored photos, so nothing is orphaned', async () => {
    repo.findById.mockResolvedValue(row);
    repo.remove.mockResolvedValue(['org/sourcing/i1/a.jpg', 'org/sourcing/i1/b.jpg']);

    await sourcedItemService.remove('s1', 'i1');

    expect(deleteMediaObjects).toHaveBeenCalledWith([
      'org/sourcing/i1/a.jpg',
      'org/sourcing/i1/b.jpg',
    ]);
  });

  it('removing a photo deletes that stored object', async () => {
    repo.findById.mockResolvedValue(row);
    repo.removeImage.mockResolvedValue('org/sourcing/i1/a.jpg');

    await sourcedItemService.removeImage('s1', 'i1', 'img1');

    expect(deleteMediaObjects).toHaveBeenCalledWith(['org/sourcing/i1/a.jpg']);
  });

  it('deletes nothing from storage when the photo row was already gone', async () => {
    repo.findById.mockResolvedValue(row);
    repo.removeImage.mockResolvedValue(null);

    await sourcedItemService.removeImage('s1', 'i1', 'gone');

    expect(deleteMediaObjects).toHaveBeenCalledWith([]);
  });
});
