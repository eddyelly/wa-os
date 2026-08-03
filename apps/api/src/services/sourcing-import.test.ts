import { beforeEach, describe, expect, it, vi } from 'vitest';

const { supplierServiceMock, sourcedItemServiceMock } = vi.hoisted(() => ({
  supplierServiceMock: { create: vi.fn(), findById: vi.fn() },
  sourcedItemServiceMock: { create: vi.fn() },
}));
vi.mock('./supplier-service.js', () => ({ supplierService: supplierServiceMock }));
vi.mock('./sourced-item-service.js', () => ({ sourcedItemService: sourcedItemServiceMock }));

import { importSourcedItemsCsv, importSuppliersCsv } from './sourcing-import.js';

const SUPPLIER_HEADER = 'name,country,city,market,address,contactName,contactPhone,contactNote,notes';
const ITEM_HEADER = 'name,description,price,priceCurrency,unit,moq,notes';

beforeEach(() => {
  vi.clearAllMocks();
  supplierServiceMock.create.mockResolvedValue({ id: 's1' });
  supplierServiceMock.findById.mockResolvedValue({ id: 's1' });
  sourcedItemServiceMock.create.mockResolvedValue({ id: 'i1' });
});

describe('importSuppliersCsv', () => {
  it('creates each valid row', async () => {
    const csv = `${SUPPLIER_HEADER}\n"Guangzhou Bag City",CN,Guangzhou,"Bag City",,Lin,+8613800000000,"WeChat: lin",\n`;
    const result = await importSuppliersCsv(csv);
    expect(result).toEqual({ created: 1, failures: [] });
    expect(supplierServiceMock.create).toHaveBeenCalledWith({
      name: 'Guangzhou Bag City',
      country: 'CN',
      city: 'Guangzhou',
      market: 'Bag City',
      contactName: 'Lin',
      contactPhone: '+8613800000000',
      contactNote: 'WeChat: lin',
    });
  });

  it('reports an invalid country code as a row failure and keeps going', async () => {
    const csv = `${SUPPLIER_HEADER}\nGood,CN,,,,,,,\nBad,CHINA,,,,,,,\n`;
    const result = await importSuppliersCsv(csv);
    expect(result.created).toBe(1);
    expect(result.failures).toHaveLength(1);
    expect(result.failures[0]?.row).toBe(2);
  });

  it('rejects a wrong header', async () => {
    await expect(importSuppliersCsv('nope,country\nx,CN')).rejects.toThrow(/header/i);
  });

  it('skips fully empty padding rows', async () => {
    const csv = `${SUPPLIER_HEADER}\nGood,CN,,,,,,,\n,,,,,,,,\n`;
    const result = await importSuppliersCsv(csv);
    expect(result).toEqual({ created: 1, failures: [] });
  });
});

describe('importSourcedItemsCsv', () => {
  it('creates each valid row against the given supplier', async () => {
    const csv = `${ITEM_HEADER}\n"Leather handbag",,45.50,CNY,"per piece",50,\n`;
    const result = await importSourcedItemsCsv('s1', csv);
    expect(result).toEqual({ created: 1, failures: [] });
    expect(sourcedItemServiceMock.create).toHaveBeenCalledWith('s1', {
      name: 'Leather handbag',
      priceAmount: 4550,
      priceCurrency: 'CNY',
      unit: 'per piece',
      moq: 50,
    });
  });

  it('reports an unsupported currency as a row failure', async () => {
    const csv = `${ITEM_HEADER}\nGood,,100,CNY,,,\nBad,,100,XYZ,,,\n`;
    const result = await importSourcedItemsCsv('s1', csv);
    expect(result.created).toBe(1);
    expect(result.failures[0]?.row).toBe(2);
  });

  it('fails the whole file once when the supplier does not exist', async () => {
    supplierServiceMock.findById.mockRejectedValueOnce(new Error('This supplier no longer exists.'));
    const csv = `${ITEM_HEADER}\nGood,,100,CNY,,,\nAlso good,,100,CNY,,,\n`;
    await expect(importSourcedItemsCsv('missing', csv)).rejects.toThrow(/no longer exists/);
    expect(sourcedItemServiceMock.create).not.toHaveBeenCalled();
  });
});
