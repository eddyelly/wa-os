import { z } from 'zod';
import {
  sourcedItemSchema,
  supplierSchema,
  type CreateSourcedItemRequest,
  type CreateSupplierRequest,
  type SourcedItemDto,
  type SupplierDto,
  type UpdateSourcedItemRequest,
  type UpdateSupplierRequest,
} from '@waos/shared';
import { apiFetch, apiUpload } from './api';

export async function listSuppliers(): Promise<SupplierDto[]> {
  const raw = await apiFetch<unknown>('/api/v1/suppliers');
  return z.array(supplierSchema).parse((raw as { suppliers: unknown }).suppliers);
}

export async function createSupplier(input: CreateSupplierRequest): Promise<SupplierDto> {
  const raw = await apiFetch<unknown>('/api/v1/suppliers', { method: 'POST', body: input });
  return supplierSchema.parse((raw as { supplier: unknown }).supplier);
}

export async function updateSupplier(
  id: string,
  input: UpdateSupplierRequest,
): Promise<SupplierDto> {
  const raw = await apiFetch<unknown>(`/api/v1/suppliers/${id}`, { method: 'PATCH', body: input });
  return supplierSchema.parse((raw as { supplier: unknown }).supplier);
}

export async function deleteSupplier(id: string): Promise<void> {
  await apiFetch(`/api/v1/suppliers/${id}`, { method: 'DELETE' });
}

export async function listSourcedItems(supplierId: string): Promise<SourcedItemDto[]> {
  const raw = await apiFetch<unknown>(`/api/v1/suppliers/${supplierId}/items`);
  return z.array(sourcedItemSchema).parse((raw as { items: unknown }).items);
}

export async function createSourcedItem(
  supplierId: string,
  input: CreateSourcedItemRequest,
): Promise<SourcedItemDto> {
  const raw = await apiFetch<unknown>(`/api/v1/suppliers/${supplierId}/items`, {
    method: 'POST',
    body: input,
  });
  return sourcedItemSchema.parse((raw as { item: unknown }).item);
}

export async function updateSourcedItem(
  supplierId: string,
  itemId: string,
  input: UpdateSourcedItemRequest,
): Promise<SourcedItemDto> {
  const raw = await apiFetch<unknown>(`/api/v1/suppliers/${supplierId}/items/${itemId}`, {
    method: 'PATCH',
    body: input,
  });
  return sourcedItemSchema.parse((raw as { item: unknown }).item);
}

export async function deleteSourcedItem(supplierId: string, itemId: string): Promise<void> {
  await apiFetch(`/api/v1/suppliers/${supplierId}/items/${itemId}`, { method: 'DELETE' });
}

export async function uploadSourcedItemImage(
  supplierId: string,
  itemId: string,
  file: File,
): Promise<SourcedItemDto> {
  const formData = new FormData();
  formData.append('file', file);
  const raw = await apiUpload<unknown>(
    `/api/v1/suppliers/${supplierId}/items/${itemId}/images`,
    formData,
  );
  return sourcedItemSchema.parse((raw as { item: unknown }).item);
}

export async function removeSourcedItemImage(
  supplierId: string,
  itemId: string,
  imageId: string,
): Promise<SourcedItemDto> {
  const raw = await apiFetch<unknown>(
    `/api/v1/suppliers/${supplierId}/items/${itemId}/images/${imageId}`,
    { method: 'DELETE' },
  );
  return sourcedItemSchema.parse((raw as { item: unknown }).item);
}
