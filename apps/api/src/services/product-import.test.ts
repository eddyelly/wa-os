import { beforeEach, describe, expect, it, vi } from 'vitest';

const { productServiceMock } = vi.hoisted(() => ({
  productServiceMock: { create: vi.fn() },
}));
vi.mock('./product-service.js', () => ({ productService: productServiceMock }));

import { importProductsCsv } from './product-import.js';

const HEADER = 'name,description,price,minPrice,stockQty,lowStockThreshold,tags';

beforeEach(() => {
  vi.clearAllMocks();
  productServiceMock.create.mockResolvedValue({ id: 'p1' });
});

describe('importProductsCsv', () => {
  it('creates every valid row and splits tags on |', async () => {
    const csv = `${HEADER}\n"Shea Butter","Pure shea",20000,17000,10,5,"hair|butter"\nComb,,3000,,25,5,`;
    const result = await importProductsCsv(csv);
    expect(result).toEqual({ created: 2, failures: [] });
    expect(productServiceMock.create).toHaveBeenNthCalledWith(1, {
      name: 'Shea Butter',
      description: 'Pure shea',
      price: 20000,
      minPrice: 17000,
      stockQty: 10,
      lowStockThreshold: 5,
      tags: ['hair', 'butter'],
    });
    expect(productServiceMock.create).toHaveBeenNthCalledWith(2, {
      name: 'Comb',
      price: 3000,
      stockQty: 25,
      lowStockThreshold: 5,
      tags: [],
    });
  });

  it('reports invalid rows with 1-based data row numbers and keeps creating valid ones', async () => {
    const csv = `${HEADER}\nGood,,1000,,1,5,\nBad,,abc,,1,5,\nAlso Bad,,1000,2000,1,5,`;
    const result = await importProductsCsv(csv);
    expect(result.created).toBe(1);
    expect(result.failures).toHaveLength(2);
    expect(result.failures[0]?.row).toBe(2);
    expect(result.failures[1]?.row).toBe(3);
    expect(productServiceMock.create).toHaveBeenCalledTimes(1);
  });

  it('reports a wrong column count as a row failure', async () => {
    const csv = `${HEADER}\nOnlyName,1000`;
    const result = await importProductsCsv(csv);
    expect(result.created).toBe(0);
    expect(result.failures[0]?.row).toBe(1);
    expect(result.failures[0]?.reason).toContain('7');
  });

  it('counts a service failure as a row failure', async () => {
    productServiceMock.create.mockRejectedValueOnce(new Error('db down'));
    const csv = `${HEADER}\nGood,,1000,,1,5,\nAlso Good,,1000,,1,5,`;
    const result = await importProductsCsv(csv);
    expect(result.created).toBe(1);
    expect(result.failures).toEqual([{ row: 1, reason: 'db down' }]);
  });

  it('rejects a wrong header', async () => {
    await expect(importProductsCsv('nope,price\nx,1')).rejects.toThrow(/header/i);
  });

  it('rejects an empty file', async () => {
    await expect(importProductsCsv('')).rejects.toThrow();
  });

  it('rejects more than 200 data rows', async () => {
    const rows = Array.from({ length: 201 }, (_, i) => `P${i},,100,,1,5,`).join('\n');
    await expect(importProductsCsv(`${HEADER}\n${rows}`)).rejects.toThrow(/200/);
  });
});
