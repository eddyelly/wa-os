import type { Contact, Order, OrderItem, OrderStatus } from '@prisma/client';
import { NotFoundError } from '../lib/errors.js';
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
};
