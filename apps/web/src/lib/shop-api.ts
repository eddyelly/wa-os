import { z } from 'zod';
import {
  productSchema,
  orderSchema,
  notificationSchema,
  type ProductDto,
  type OrderDto,
  type NotificationDto,
  type OrderStatus,
} from '@waos/shared';
import { apiFetch, apiUpload } from './api';

export async function listProducts(includeInactive = false): Promise<ProductDto[]> {
  const raw = await apiFetch<unknown>(
    `/api/v1/products${includeInactive ? '?includeInactive=1' : ''}`,
  );
  return z.array(productSchema).parse((raw as { products: unknown }).products);
}

export async function createProduct(input: {
  name: string;
  description?: string;
  price: number;
  minPrice?: number;
  stockQty: number;
  lowStockThreshold: number;
}): Promise<ProductDto> {
  const raw = await apiFetch<unknown>('/api/v1/products', {
    method: 'POST',
    body: input,
  });
  return productSchema.parse((raw as { product: unknown }).product);
}

export async function updateProduct(
  id: string,
  input: Partial<{
    name: string;
    description: string | null;
    price: number;
    minPrice: number | null;
    stockQty: number;
    lowStockThreshold: number;
    isActive: boolean;
  }>,
): Promise<ProductDto> {
  const raw = await apiFetch<unknown>(`/api/v1/products/${id}`, {
    method: 'PATCH',
    body: input,
  });
  return productSchema.parse((raw as { product: unknown }).product);
}

export async function deleteProduct(id: string): Promise<void> {
  await apiFetch<unknown>(`/api/v1/products/${id}`, {
    method: 'DELETE',
  });
}

export async function uploadProductImage(id: string, file: File): Promise<ProductDto> {
  const formData = new FormData();
  formData.append('file', file);
  const raw = await apiUpload<unknown>(`/api/v1/products/${id}/images`, formData);
  return productSchema.parse((raw as { product: unknown }).product);
}

export async function removeProductImage(id: string, imageId: string): Promise<ProductDto> {
  const raw = await apiFetch<unknown>(`/api/v1/products/${id}/images/${imageId}`, {
    method: 'DELETE',
  });
  return productSchema.parse((raw as { product: unknown }).product);
}

export async function listOrders(
  filter?: { status?: OrderStatus; contactId?: string },
): Promise<OrderDto[]> {
  const params = new URLSearchParams();
  if (filter?.status) {
    params.append('status', filter.status);
  }
  if (filter?.contactId) {
    params.append('contactId', filter.contactId);
  }
  const query = params.toString();
  const raw = await apiFetch<unknown>(`/api/v1/orders${query ? `?${query}` : ''}`);
  return z.array(orderSchema).parse((raw as { orders: unknown }).orders);
}

export async function setOrderStatus(id: string, status: OrderStatus): Promise<OrderDto> {
  const raw = await apiFetch<unknown>(`/api/v1/orders/${id}`, {
    method: 'PATCH',
    body: { status },
  });
  return orderSchema.parse((raw as { order: unknown }).order);
}

export async function listNotifications(unreadOnly = false): Promise<NotificationDto[]> {
  const raw = await apiFetch<unknown>(
    `/api/v1/notifications${unreadOnly ? '?unreadOnly=1' : ''}`,
  );
  return z.array(notificationSchema).parse((raw as { notifications: unknown }).notifications);
}

export async function markNotificationRead(id: string): Promise<void> {
  await apiFetch<unknown>(`/api/v1/notifications/${id}/read`, {
    method: 'PATCH',
  });
}

export async function markAllNotificationsRead(): Promise<void> {
  await apiFetch<unknown>('/api/v1/notifications/read-all', {
    method: 'PATCH',
  });
}

export async function updateShopSettings(input: {
  paymentInstructions?: string;
  ownerAlertPhone?: string | null;
  ownerAlertsEnabled?: boolean;
}): Promise<void> {
  await apiFetch<unknown>('/api/v1/shop/settings', {
    method: 'PATCH',
    body: input,
  });
}
