import { z } from 'zod';
import {
  supplierSchema,
  type CreateSupplierRequest,
  type SupplierDto,
  type UpdateSupplierRequest,
} from '@waos/shared';
import { apiFetch } from './api';

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
