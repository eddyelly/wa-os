import type { OrderDto, OrderStatus } from '@waos/shared';
import { NotFoundError, ValidationError } from '../lib/errors.js';
import { logger } from '../lib/logger.js';
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
 * Narrows an order item to one with a live product reference.
 * OrderItem.productId is nullable (SetNull on product deletion): items that
 * fail this check never touch stock, on decrement or restore.
 */
function hasProductId(
  item: OrderWithDetails['items'][number],
): item is OrderWithDetails['items'][number] & { productId: string } {
  return item.productId !== null;
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
        throw new ValidationError(`The price for ${product.name} is too low.`);
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

    try {
      await notificationService.notify('NEW_ORDER', {
        orderId: order.id,
        total: totalAgreed,
        contactName: order.contact.name,
      });
    } catch (error) {
      // Best-effort: the order already committed. An uncaught throw here
      // would poison a successful creation (the agent may retry and
      // duplicate the order), so log ids only and continue.
      logger.warn({ err: error, orderId: order.id }, 'new order notification failed');
    }

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

    // sign is the stock direction for this transition: -1 to decrement on
    // entering CONFIRMED (the only legal edge into CONFIRMED is from
    // PENDING_CONFIRMATION, so this can never run twice for the same
    // order), +1 to restore on cancelling an order whose stock is still
    // live (CONFIRMED or PAID), null when this transition never touches
    // stock.
    let sign: -1 | 1 | null = null;
    if (status === 'CONFIRMED') {
      sign = -1;
    } else if (status === 'CANCELLED' && STOCK_DECREMENTED_STATUSES.includes(order.status)) {
      sign = 1;
    }

    const stockItems = sign === null ? [] : order.items.filter(hasProductId);
    const stockAdjustments = stockItems.map((item) => ({
      productId: item.productId,
      delta: (sign as -1 | 1) * item.quantity,
      quantity: item.quantity,
    }));

    let updated: OrderWithDetails;
    if (stockAdjustments.length > 0) {
      // Stock and status commit inside one repository transaction: see
      // updateStatusWithStock's comment in order-repository.ts for why a
      // partial failure here can never leave stock decremented with the
      // order still on its old status. Passing order.status as
      // expectedFrom lets the repository guard the status write with a
      // conditional updateMany, so two concurrent requests for the same
      // transition can never both commit and double-decrement.
      const results = await orderRepository.updateStatusWithStock(
        id,
        status,
        order.status,
        stockAdjustments.map(({ productId, delta }) => ({ productId, delta })),
      );
      // On a decrement (sign -1), fire LOW_STOCK when the fresh stockQty
      // crosses at or under the threshold from strictly above it, so a
      // sale that starts already at or below threshold never fires again.
      if (sign === -1) {
        for (const [index, result] of results.entries()) {
          const quantity = stockAdjustments[index]?.quantity ?? 0;
          const preDecrement = result.stockQty + quantity;
          if (result.stockQty <= result.lowStockThreshold && preDecrement > result.lowStockThreshold) {
            try {
              await notificationService.notify('LOW_STOCK', {
                productId: result.productId,
                name: result.name,
                stockQty: result.stockQty,
              });
            } catch (error) {
              // Best-effort: the stock decrement and status transition
              // already committed. Log ids only and continue so a
              // confirm retry never hits a bogus transition error.
              logger.warn({ err: error, productId: result.productId }, 'low stock notification failed');
            }
          }
        }
      }
      // The transaction already committed the status change; items and
      // contact are untouched by this transition, so there is no need to
      // re-fetch the order just to build the DTO.
      updated = { ...order, status };
    } else {
      updated = await orderRepository.updateStatus(id, status, order.status);
    }
    return toDto(updated);
  },

  async list(status?: OrderStatus): Promise<OrderDto[]> {
    const rows = await orderRepository.list(status);
    return rows.map(toDto);
  },
};
