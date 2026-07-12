import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { OrderStatus } from '@waos/shared';
import { NotFoundError, ValidationError } from '../lib/errors.js';

interface FakeProduct {
  id: string;
  name: string;
  price: number;
  minPrice: number | null;
  stockQty: number;
  lowStockThreshold: number;
  isActive: boolean;
}

interface FakeOrderItem {
  id: string;
  productId: string | null;
  productName: string;
  quantity: number;
  listPrice: number;
  agreedPrice: number;
}

interface FakeOrder {
  id: string;
  organizationId: string;
  conversationId: string | null;
  contactId: string;
  status: OrderStatus;
  totalAgreed: number;
  note: string | null;
  items: FakeOrderItem[];
  contact: { id: string; name: string | null; phone: string };
  createdAt: Date;
  updatedAt: Date;
}

// vi.hoisted is required (see product-service.test.ts) because the vi.mock
// factories below are hoisted above these consts; a plain top-level const
// referenced from inside a factory would throw a temporal-dead-zone
// ReferenceError otherwise.
const { products, orders, orderRepo, productRepo, notify } = vi.hoisted(() => {
  const products = new Map<string, FakeProduct>();
  const orders = new Map<string, FakeOrder>();
  let nextOrderId = 1;
  let nextItemId = 1;

  const orderRepo = {
    create: vi.fn(
      (data: {
        conversationId: string | null;
        contactId: string;
        totalAgreed: number;
        note?: string;
        items: Array<{
          productId: string | null;
          productName: string;
          quantity: number;
          listPrice: number;
          agreedPrice: number;
        }>;
      }) => {
        const id = `o${nextOrderId++}`;
        const items: FakeOrderItem[] = data.items.map((item) => ({
          id: `oi${nextItemId++}`,
          productId: item.productId,
          productName: item.productName,
          quantity: item.quantity,
          listPrice: item.listPrice,
          agreedPrice: item.agreedPrice,
        }));
        const order: FakeOrder = {
          id,
          organizationId: 'org1',
          conversationId: data.conversationId,
          contactId: data.contactId,
          status: 'PENDING_CONFIRMATION',
          totalAgreed: data.totalAgreed,
          note: data.note ?? null,
          items,
          contact: { id: data.contactId, name: 'Fatuma', phone: '+255700000000' },
          createdAt: new Date('2026-01-01T00:00:00Z'),
          updatedAt: new Date('2026-01-01T00:00:00Z'),
        };
        orders.set(id, order);
        return Promise.resolve(order);
      },
    ),
    findById: vi.fn((id: string) => Promise.resolve(orders.get(id) ?? null)),
    list: vi.fn((status?: OrderStatus) =>
      Promise.resolve([...orders.values()].filter((order) => !status || order.status === status)),
    ),
    updateStatus: vi.fn((id: string, status: OrderStatus) => {
      const existing = orders.get(id);
      if (!existing) {
        return Promise.reject(new Error('not found'));
      }
      const updated: FakeOrder = { ...existing, status, updatedAt: new Date() };
      orders.set(id, updated);
      return Promise.resolve(updated);
    }),
  };

  const productRepo = {
    findById: vi.fn((id: string) => Promise.resolve(products.get(id) ?? null)),
    adjustStock: vi.fn((id: string, delta: number) => {
      const product = products.get(id);
      if (!product) {
        return Promise.reject(new Error('missing product'));
      }
      const next = product.stockQty + delta;
      if (next < 0) {
        return Promise.reject(new Error('stock cannot go negative'));
      }
      product.stockQty = next;
      return Promise.resolve({
        stockQty: product.stockQty,
        lowStockThreshold: product.lowStockThreshold,
        name: product.name,
      });
    }),
  };

  const notify = vi.fn((_type: string, _payload: Record<string, unknown>) => Promise.resolve());

  return { products, orders, orderRepo, productRepo, notify };
});

vi.mock('../repositories/order-repository.js', () => ({ orderRepository: orderRepo }));
vi.mock('../repositories/product-repository.js', () => ({ productRepository: productRepo }));
vi.mock('./notification-service.js', () => ({ notificationService: { notify } }));

import { orderService } from './order-service.js';

function addProduct(product: Partial<FakeProduct> & { id: string }): FakeProduct {
  const full: FakeProduct = {
    name: 'Product',
    price: 10000,
    minPrice: null,
    stockQty: 10,
    lowStockThreshold: 3,
    isActive: true,
    ...product,
  };
  products.set(full.id, full);
  return full;
}

describe('orderService.createFromAgent', () => {
  beforeEach(() => {
    products.clear();
    orders.clear();
    vi.clearAllMocks();
  });

  it('rejects any item priced below the floor with ValidationError', async () => {
    addProduct({ id: 'p1', price: 10000, minPrice: 8000, stockQty: 5 });

    await expect(
      orderService.createFromAgent({
        conversationId: null,
        contactId: 'c1',
        items: [{ productId: 'p1', quantity: 1, agreedPrice: 7999 }],
      }),
    ).rejects.toBeInstanceOf(ValidationError);
    expect(orderRepo.create).not.toHaveBeenCalled();
  });

  it('rejects quantity exceeding stockQty', async () => {
    addProduct({ id: 'p1', price: 10000, stockQty: 2 });

    await expect(
      orderService.createFromAgent({
        conversationId: null,
        contactId: 'c1',
        items: [{ productId: 'p1', quantity: 3, agreedPrice: 10000 }],
      }),
    ).rejects.toBeInstanceOf(ValidationError);
    expect(orderRepo.create).not.toHaveBeenCalled();
  });

  it('snapshots productName and listPrice and totals agreed prices', async () => {
    addProduct({ id: 'p1', name: 'Hair oil', price: 12000, stockQty: 10 });
    addProduct({ id: 'p2', name: 'Wig', price: 85000, minPrice: 70000, stockQty: 4 });

    const result = await orderService.createFromAgent({
      conversationId: 'conv1',
      contactId: 'c1',
      items: [
        { productId: 'p1', quantity: 2, agreedPrice: 12000 },
        { productId: 'p2', quantity: 1, agreedPrice: 75000 },
      ],
    });

    expect(result.totalAgreed).toBe(2 * 12000 + 75000);
    const created = orderRepo.create.mock.calls[0]?.[0] as { items: Array<Record<string, unknown>> };
    expect(created.items).toEqual([
      { productId: 'p1', productName: 'Hair oil', quantity: 2, listPrice: 12000, agreedPrice: 12000 },
      { productId: 'p2', productName: 'Wig', quantity: 1, listPrice: 85000, agreedPrice: 75000 },
    ]);
    expect(notify).toHaveBeenCalledWith('NEW_ORDER', {
      orderId: result.orderId,
      total: result.totalAgreed,
      contactName: 'Fatuma',
    });
  });

  it('rejects an inactive product and a missing product', async () => {
    addProduct({ id: 'p1', isActive: false });

    await expect(
      orderService.createFromAgent({
        conversationId: null,
        contactId: 'c1',
        items: [{ productId: 'p1', quantity: 1, agreedPrice: 10000 }],
      }),
    ).rejects.toBeInstanceOf(ValidationError);

    await expect(
      orderService.createFromAgent({
        conversationId: null,
        contactId: 'c1',
        items: [{ productId: 'missing', quantity: 1, agreedPrice: 10000 }],
      }),
    ).rejects.toBeInstanceOf(ValidationError);
  });
});

describe('orderService.setStatus: transition matrix', () => {
  beforeEach(() => {
    products.clear();
    orders.clear();
    vi.clearAllMocks();
  });

  async function makeOrder(status: OrderStatus = 'PENDING_CONFIRMATION'): Promise<FakeOrder> {
    addProduct({ id: 'p1', stockQty: 10 });
    const created = await orderRepo.create({
      conversationId: null,
      contactId: 'c1',
      totalAgreed: 10000,
      items: [{ productId: 'p1', productName: 'Product', quantity: 1, listPrice: 10000, agreedPrice: 10000 }],
    });
    if (status !== 'PENDING_CONFIRMATION') {
      created.status = status;
      orders.set(created.id, created);
    }
    return created;
  }

  const allStatuses: OrderStatus[] = ['PENDING_CONFIRMATION', 'CONFIRMED', 'PAID', 'FULFILLED', 'CANCELLED'];
  const legal: Record<OrderStatus, OrderStatus[]> = {
    PENDING_CONFIRMATION: ['CONFIRMED', 'CANCELLED'],
    CONFIRMED: ['PAID', 'FULFILLED', 'CANCELLED'],
    PAID: ['FULFILLED', 'CANCELLED'],
    FULFILLED: [],
    CANCELLED: [],
  };

  it('every allowed edge passes and every other edge throws ValidationError', async () => {
    for (const from of allStatuses) {
      for (const to of allStatuses) {
        const order = await makeOrder(from);
        if (legal[from].includes(to)) {
          const dto = await orderService.setStatus(order.id, to);
          expect(dto.status).toBe(to);
        } else {
          await expect(orderService.setStatus(order.id, to)).rejects.toBeInstanceOf(ValidationError);
        }
      }
    }
  });

  it('throws NotFoundError for an unknown order id', async () => {
    await expect(orderService.setStatus('missing', 'CONFIRMED')).rejects.toBeInstanceOf(NotFoundError);
  });
});

describe('orderService.setStatus: stock and low-stock', () => {
  beforeEach(() => {
    products.clear();
    orders.clear();
    vi.clearAllMocks();
  });

  async function makeOrder(quantity: number): Promise<FakeOrder> {
    return orderRepo.create({
      conversationId: null,
      contactId: 'c1',
      totalAgreed: 10000 * quantity,
      items: [
        { productId: 'p1', productName: 'Product', quantity, listPrice: 10000, agreedPrice: 10000 },
      ],
    });
  }

  it('decrements stock once on CONFIRMED and never again on PAID/FULFILLED', async () => {
    addProduct({ id: 'p1', stockQty: 10, lowStockThreshold: 3 });
    const order = await makeOrder(2);

    await orderService.setStatus(order.id, 'CONFIRMED');
    expect(productRepo.adjustStock).toHaveBeenCalledTimes(1);
    expect(productRepo.adjustStock).toHaveBeenCalledWith('p1', -2);
    expect(products.get('p1')?.stockQty).toBe(8);

    await orderService.setStatus(order.id, 'PAID');
    await orderService.setStatus(order.id, 'FULFILLED');
    expect(productRepo.adjustStock).toHaveBeenCalledTimes(1);
    expect(products.get('p1')?.stockQty).toBe(8);
  });

  it('fires LOW_STOCK exactly once when the decrement crosses the threshold, and not when already below', async () => {
    addProduct({ id: 'p1', stockQty: 5, lowStockThreshold: 3 });
    const crossing = await makeOrder(3); // 5 -> 2: crosses 3

    await orderService.setStatus(crossing.id, 'CONFIRMED');
    expect(notify).toHaveBeenCalledWith('LOW_STOCK', { productId: 'p1', name: 'Product', stockQty: 2 });
    expect(notify.mock.calls.filter((call) => call[0] === 'LOW_STOCK')).toHaveLength(1);

    notify.mockClear();
    addProduct({ id: 'p2', stockQty: 2, lowStockThreshold: 3 }); // already below
    const alreadyLow = await makeOrder(1);

    await orderService.setStatus(alreadyLow.id, 'CONFIRMED');
    const lowStockCalls = notify.mock.calls.filter((call) => call[0] === 'LOW_STOCK');
    expect(lowStockCalls).toHaveLength(0);
  });

  it('cancel after CONFIRMED restores stock; cancel from PENDING_CONFIRMATION does not touch stock', async () => {
    addProduct({ id: 'p1', stockQty: 10, lowStockThreshold: 3 });
    const confirmedOrder = await makeOrder(2);
    await orderService.setStatus(confirmedOrder.id, 'CONFIRMED');
    expect(products.get('p1')?.stockQty).toBe(8);
    productRepo.adjustStock.mockClear();

    await orderService.setStatus(confirmedOrder.id, 'CANCELLED');
    expect(productRepo.adjustStock).toHaveBeenCalledWith('p1', 2);
    expect(products.get('p1')?.stockQty).toBe(10);

    productRepo.adjustStock.mockClear();
    const pendingOrder = await makeOrder(1);
    await orderService.setStatus(pendingOrder.id, 'CANCELLED');
    expect(productRepo.adjustStock).not.toHaveBeenCalled();
    expect(products.get('p1')?.stockQty).toBe(10);
  });

  it('cancel after PAID also restores stock (stock was decremented at CONFIRMED)', async () => {
    addProduct({ id: 'p1', stockQty: 10, lowStockThreshold: 3 });
    const order = await makeOrder(4);
    await orderService.setStatus(order.id, 'CONFIRMED');
    expect(products.get('p1')?.stockQty).toBe(6);
    await orderService.setStatus(order.id, 'PAID');
    productRepo.adjustStock.mockClear();

    await orderService.setStatus(order.id, 'CANCELLED');
    expect(productRepo.adjustStock).toHaveBeenCalledWith('p1', 4);
    expect(products.get('p1')?.stockQty).toBe(10);
  });
});

describe('orderService.list', () => {
  beforeEach(() => {
    products.clear();
    orders.clear();
    vi.clearAllMocks();
  });

  it('delegates to the repository with the optional status filter', async () => {
    addProduct({ id: 'p1', stockQty: 10 });
    const order = await orderRepo.create({
      conversationId: null,
      contactId: 'c1',
      totalAgreed: 10000,
      items: [{ productId: 'p1', productName: 'Product', quantity: 1, listPrice: 10000, agreedPrice: 10000 }],
    });

    const all = await orderService.list();
    expect(all.map((dto) => dto.id)).toEqual([order.id]);

    const filtered = await orderService.list('CONFIRMED');
    expect(filtered).toEqual([]);
  });
});
