import { beforeEach, describe, expect, it, vi } from 'vitest';

const { repo, deleteMediaObjects } = vi.hoisted(() => ({
  repo: {
    create: vi.fn(),
    findById: vi.fn(),
    list: vi.fn(),
    update: vi.fn(),
    remove: vi.fn(),
  },
  deleteMediaObjects: vi.fn(() => Promise.resolve()),
}));
vi.mock('../repositories/supplier-repository.js', () => ({ supplierRepository: repo }));
vi.mock('../lib/minio.js', () => ({ deleteMediaObjects }));

import { supplierService } from './supplier-service.js';

const row = {
  id: 's1',
  name: 'Guangzhou Bag City',
  country: 'CN',
  city: 'Guangzhou',
  market: 'Bag City',
  address: null,
  contactName: 'Lin',
  contactPhone: '+8613800000000',
  contactNote: 'WeChat: lin_bags',
  notes: null,
  createdAt: new Date('2026-08-01T00:00:00Z'),
  updatedAt: new Date('2026-08-01T00:00:00Z'),
  _count: { items: 3 },
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe('supplierService', () => {
  it('maps a row to a DTO with the item count and ISO date strings', async () => {
    repo.list.mockResolvedValue([row]);
    const [dto] = await supplierService.list();
    expect(dto).toEqual({
      id: 's1',
      name: 'Guangzhou Bag City',
      country: 'CN',
      city: 'Guangzhou',
      market: 'Bag City',
      address: null,
      contactName: 'Lin',
      contactPhone: '+8613800000000',
      contactNote: 'WeChat: lin_bags',
      notes: null,
      itemCount: 3,
      createdAt: '2026-08-01T00:00:00.000Z',
      updatedAt: '2026-08-01T00:00:00.000Z',
    });
  });

  it('rejects an update for a supplier that does not exist', async () => {
    repo.findById.mockResolvedValue(null);
    await expect(supplierService.update('missing', { name: 'x' })).rejects.toThrow();
    expect(repo.update).not.toHaveBeenCalled();
  });

  it('rejects a delete for a supplier that does not exist', async () => {
    repo.findById.mockResolvedValue(null);
    await expect(supplierService.remove('missing')).rejects.toThrow();
    expect(repo.remove).not.toHaveBeenCalled();
  });

  it('passes an explicit null through so an edit can clear an optional field', async () => {
    repo.findById.mockResolvedValue(row);
    repo.update.mockResolvedValue({ ...row, contactPhone: null });
    const dto = await supplierService.update('s1', { contactPhone: null });
    expect(repo.update).toHaveBeenCalledWith('s1', { contactPhone: null });
    expect(dto.contactPhone).toBeNull();
  });

  it('deleting a supplier deletes the photos of all its items, not just the rows', async () => {
    repo.findById.mockResolvedValue(row);
    // Deleting a supplier cascades supplier -> items -> photos, so every key
    // the cascade removed has to be cleaned out of storage too.
    repo.remove.mockResolvedValue(['org/sourcing/i1/a.jpg', 'org/sourcing/i2/b.jpg']);

    await supplierService.remove('s1');

    expect(deleteMediaObjects).toHaveBeenCalledWith([
      'org/sourcing/i1/a.jpg',
      'org/sourcing/i2/b.jpg',
    ]);
  });
});
