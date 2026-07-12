import type { Contact, Order, OrderItem, OrderStatus } from '@prisma/client';
import { NotFoundError, ValidationError } from '../lib/errors.js';
import { requireRequestContext } from '../lib/context.js';
import { prisma } from '../lib/prisma.js';

export type OrderWithDetails = Order & { items: OrderItem[]; contact: Contact };

interface CreateOrderItemData {
  productId: string | null;
  productName: string;
  quantity: number;
  listPrice: number;
  agreedPrice: number;
}

interface CreateOrderData {
  conversationId: string | null;
  contactId: string;
  totalAgreed: number;
  note?: string;
  items: CreateOrderItemData[];
}

export const orderRepository = {
  /**
   * Creates the Order row, then the OrderItem rows in a separate
   * `createMany`, inside one transaction on the tenant client. Nested
   * relation writes (`items: { create: [...] }`) are forbidden by the
   * tenant extension (see lib/tenant.ts), so the two writes are issued
   * directly instead.
   */
  create(data: CreateOrderData): Promise<OrderWithDetails> {
    const { organizationId } = requireRequestContext();
    return prisma.$transaction(async (tx) => {
      const order = await tx.order.create({
        data: {
          conversationId: data.conversationId,
          contactId: data.contactId,
          totalAgreed: data.totalAgreed,
          note: data.note ?? null,
          // Overridden by the tenant extension at runtime; the generated
          // Prisma type still requires it here.
          organizationId,
        },
      });
      await tx.orderItem.createMany({
        data: data.items.map((item) => ({
          orderId: order.id,
          productId: item.productId,
          productName: item.productName,
          quantity: item.quantity,
          listPrice: item.listPrice,
          agreedPrice: item.agreedPrice,
          organizationId,
        })),
      });
      const full = await tx.order.findUnique({
        where: { id: order.id },
        include: { items: true, contact: true },
      });
      if (!full) {
        throw new NotFoundError('This order no longer exists.');
      }
      return full;
    });
  },

  findById(id: string): Promise<OrderWithDetails | null> {
    return prisma.order.findUnique({ where: { id }, include: { items: true, contact: true } });
  },

  list(status?: OrderStatus): Promise<OrderWithDetails[]> {
    return prisma.order.findMany({
      where: status ? { status } : {},
      include: { items: true, contact: true },
      orderBy: { createdAt: 'desc' },
      take: 100,
    });
  },

  updateStatus(id: string, status: OrderStatus): Promise<OrderWithDetails> {
    return prisma.order.update({
      where: { id },
      data: { status },
      include: { items: true, contact: true },
    });
  },

  /**
   * Applies stock adjustments and the order status transition inside one
   * transaction, so a stock-affecting status change (entering CONFIRMED, or
   * cancelling out of CONFIRMED/PAID) commits stock and status together.
   * Without this, a crash or a per-item failure between the stock write and
   * the status write can leave stock decremented with the order still on
   * its old status, and a retry of the same transition would decrement
   * again. Both failure modes are closed by making the whole thing one
   * transaction: either everything commits, or nothing does.
   *
   * The read-validate-increment steps per item mirror
   * `productRepository.adjustStock` (see product-repository.ts) exactly,
   * but are inlined here rather than called: this codebase has no
   * cross-repository transaction handle (the `tx` from one repository's
   * `$transaction` cannot be handed to another repository's function), so
   * whichever repository owns a multi-write transaction must also own
   * every write inside it. Order status and product stock are one atomic
   * unit for this operation, so order-repository performs the product
   * write itself instead of delegating to productRepository.adjustStock.
   */
  updateStatusWithStock(
    id: string,
    status: OrderStatus,
    adjustments: Array<{ productId: string; delta: number }>,
  ): Promise<Array<{ productId: string; name: string; stockQty: number; lowStockThreshold: number }>> {
    return prisma.$transaction(async (tx) => {
      const results: Array<{ productId: string; name: string; stockQty: number; lowStockThreshold: number }> = [];
      for (const adjustment of adjustments) {
        const current = await tx.product.findUnique({ where: { id: adjustment.productId } });
        if (!current) {
          throw new NotFoundError('This product no longer exists.');
        }
        if (current.stockQty + adjustment.delta < 0) {
          throw new ValidationError('stock cannot go negative');
        }
        const updatedProduct = await tx.product.update({
          where: { id: adjustment.productId },
          data: { stockQty: { increment: adjustment.delta } },
        });
        results.push({
          productId: adjustment.productId,
          name: updatedProduct.name,
          stockQty: updatedProduct.stockQty,
          lowStockThreshold: updatedProduct.lowStockThreshold,
        });
      }
      await tx.order.update({ where: { id }, data: { status } });
      return results;
    });
  },
};
