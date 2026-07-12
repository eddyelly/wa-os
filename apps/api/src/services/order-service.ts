import type { OrderDto, OrderStatus } from '@waos/shared';
import { NotFoundError, ValidationError } from '../lib/errors.js';
import { orderRepository, type OrderWithDetails } from '../repositories/order-repository.js';
import { productRepository } from '../repositories/product-repository.js';
import { notificationService } from './notification-service.js';

interface CreateFromAgentItem {
  productId: string;
  quantity: number;
  agreedPrice: number;
}

interface CreateFromAgentParams {
  conversationId: string | null;
  contactId: string;
  items: CreateFromAgentItem[];
  note?: string;
}

/**
 * The legal order state machine (CLAUDE.md-adjacent shop rules, task 5
 * brief). FULFILLED and CANCELLED are terminal. Kept as a lookup so
 * setStatus can both validate and, for CANCELLED, know whether stock was
 * ever decremented for this order.
 */
const LEGAL_TRANSITIONS: Record<OrderStatus, OrderStatus[]> = {
  PENDING_CONFIRMATION: ['CONFIRMED', 'CANCELLED'],
  CONFIRMED: ['PAID', 'FULFILLED', 'CANCELLED'],
  PAID: ['FULFILLED', 'CANCELLED'],
  FULFILLED: [],
  CANCELLED: [],
};

// Once stock has been decremented (on entering CONFIRMED), it stays
// decremented through PAID; cancelling from either of those must restore it.
// Cancelling from PENDING_CONFIRMATION must not touch stock: it was never
// decremented.
const STOCK_DECREMENTED_STATUSES: OrderStatus[] = ['CONFIRMED', 'PAID'];

function toDto(order: OrderWithDetails): OrderDto {
  return {
    id: order.id,
    status: order.status,
    totalAgreed: order.totalAgreed,
    note: order.note,
    conversationId: order.conversationId,
    contact: {
      id: order.contact.id,
      name: order.contact.name,
      phone: order.contact.phone,
    },
    items: order.items.map((item) => ({
      id: item.id,
      productId: item.productId,
      productName: item.productName,
      quantity: item.quantity,
      listPrice: item.listPrice,
      agreedPrice: item.agreedPrice,
    })),
    createdAt: order.createdAt.toISOString(),
  };
}

/**
 * Adjusts stock for every item that still references a live product
 * (OrderItem.productId is nullable: SetNull on product deletion), applying
 * `sign * quantity` per item. On a decrement (sign -1), fires LOW_STOCK when
 * the fresh stockQty crosses at or under the threshold from strictly above
 * it, so a sale that starts already at or below threshold never fires again.
 */
async function adjustStockForItems(items: OrderWithDetails['items'], sign: 1 | -1): Promise<void> {
  for (const item of items) {
    if (!item.productId) {
      continue;
    }
    const delta = sign * item.quantity;
    const result = await productRepository.adjustStock(item.productId, delta);
    if (sign === -1) {
      const preDecrement = result.stockQty + item.quantity;
      if (result.stockQty <= result.lowStockThreshold && preDecrement > result.lowStockThreshold) {
        await notificationService.notify('LOW_STOCK', {
          productId: item.productId,
          name: result.name,
          stockQty: result.stockQty,
        });
      }
    }
  }
}

export const orderService = {
  toDto,

  /**
   * Called by the AI agent (Task 7) once a deal is struck in chat. This is
   * the safety net: it re-validates every item against the product's
   * current floor and stock, independent of whatever the agent believed
   * while negotiating, before any row is written.
   */
  async createFromAgent(
    params: CreateFromAgentParams,
  ): Promise<{ orderId: string; totalAgreed: number }> {
    if (params.items.length === 0) {
      throw new ValidationError('An order needs at least one item.');
    }

    const items: Array<{
      productId: string;
      productName: string;
      quantity: number;
      listPrice: number;
      agreedPrice: number;
    }> = [];
    let totalAgreed = 0;

    for (const item of params.items) {
      const product = await productRepository.findById(item.productId);
      if (!product || !product.isActive) {
        throw new ValidationError('One of these products is no longer available.');
      }
      if (item.quantity < 1) {
        throw new ValidationError('Quantity must be at least 1.');
      }
      if (item.quantity > product.stockQty) {
        throw new ValidationError(`Not enough stock for ${product.name}.`);
      }
      const floor = product.minPrice ?? product.price;
      if (item.agreedPrice < floor) {
        throw new ValidationError(`The agreed price for ${product.name} is below the floor.`);
      }
      items.push({
        productId: product.id,
        productName: product.name,
        quantity: item.quantity,
        listPrice: product.price,
        agreedPrice: item.agreedPrice,
      });
      totalAgreed += item.agreedPrice * item.quantity;
    }

    const order = await orderRepository.create({
      conversationId: params.conversationId,
      contactId: params.contactId,
      totalAgreed,
      note: params.note,
      items,
    });

    await notificationService.notify('NEW_ORDER', {
      orderId: order.id,
      total: totalAgreed,
      contactName: order.contact.name,
    });

    return { orderId: order.id, totalAgreed };
  },

  async setStatus(id: string, status: OrderStatus): Promise<OrderDto> {
    const order = await orderRepository.findById(id);
    if (!order) {
      throw new NotFoundError('This order no longer exists.');
    }

    const allowed = LEGAL_TRANSITIONS[order.status];
    if (!allowed.includes(status)) {
      throw new ValidationError(`An order cannot move from ${order.status} to ${status}.`);
    }

    if (status === 'CONFIRMED') {
      // The only legal edge into CONFIRMED is from PENDING_CONFIRMATION, so
      // this runs exactly once per order: the decrement never repeats on the
      // later CONFIRMED -> PAID -> FULFILLED edges.
      await adjustStockForItems(order.items, -1);
    } else if (status === 'CANCELLED' && STOCK_DECREMENTED_STATUSES.includes(order.status)) {
      await adjustStockForItems(order.items, 1);
    }

    const updated = await orderRepository.updateStatus(id, status);
    return toDto(updated);
  },

  async list(status?: OrderStatus): Promise<OrderDto[]> {
    const rows = await orderRepository.list(status);
    return rows.map(toDto);
  },
};
