import { describe, expect, it } from 'vitest';
import {
  createProductRequestSchema,
  orderStatusSchema,
  setOrderStatusRequestSchema,
  updateShopSettingsRequestSchema,
} from '@waos/shared';

describe('shop schemas', () => {
  it('accepts a minimal product and applies defaults', () => {
    const parsed = createProductRequestSchema.parse({ name: 'Hair oil', price: 12000 });
    expect(parsed).toMatchObject({ name: 'Hair oil', price: 12000, stockQty: 0, lowStockThreshold: 5, tags: [] });
  });

  it('rejects a floor above the list price', () => {
    expect(() =>
      createProductRequestSchema.parse({ name: 'Hair oil', price: 10000, minPrice: 12000 }),
    ).toThrow();
  });

  it('rejects non-integer or non-positive prices', () => {
    expect(() => createProductRequestSchema.parse({ name: 'X', price: 99.5 })).toThrow();
    expect(() => createProductRequestSchema.parse({ name: 'X', price: 0 })).toThrow();
  });

  it('order status enum is exactly the five states', () => {
    expect(orderStatusSchema.options).toEqual([
      'PENDING_CONFIRMATION',
      'CONFIRMED',
      'PAID',
      'FULFILLED',
      'CANCELLED',
    ]);
    expect(setOrderStatusRequestSchema.parse({ status: 'CONFIRMED' }).status).toBe('CONFIRMED');
  });

  it('shop settings accepts payment instructions and an E.164 owner phone', () => {
    const parsed = updateShopSettingsRequestSchema.parse({
      paymentInstructions: 'Lipa Namba 555111, jina WaOS Demo',
      ownerAlertPhone: '+255700000001',
      ownerAlertsEnabled: true,
    });
    expect(parsed.ownerAlertPhone).toBe('+255700000001');
    expect(() => updateShopSettingsRequestSchema.parse({ ownerAlertPhone: '0712345678' })).toThrow();
  });
});
