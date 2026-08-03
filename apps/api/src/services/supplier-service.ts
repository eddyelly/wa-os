import type { CreateSupplierRequest, SupplierDto, UpdateSupplierRequest } from '@waos/shared';
import { NotFoundError } from '../lib/errors.js';
import {
  supplierRepository,
  type SupplierWithCount,
} from '../repositories/supplier-repository.js';

export const supplierService = {
  toDto(supplier: SupplierWithCount): SupplierDto {
    return {
      id: supplier.id,
      name: supplier.name,
      country: supplier.country,
      city: supplier.city,
      market: supplier.market,
      address: supplier.address,
      contactName: supplier.contactName,
      contactPhone: supplier.contactPhone,
      contactNote: supplier.contactNote,
      notes: supplier.notes,
      itemCount: supplier._count.items,
      createdAt: supplier.createdAt.toISOString(),
      updatedAt: supplier.updatedAt.toISOString(),
    };
  },

  async create(input: CreateSupplierRequest): Promise<SupplierDto> {
    return this.toDto(await supplierRepository.create(input));
  },

  async list(): Promise<SupplierDto[]> {
    const rows = await supplierRepository.list();
    return rows.map((row) => this.toDto(row));
  },

  async findById(id: string): Promise<SupplierDto> {
    const supplier = await supplierRepository.findById(id);
    if (!supplier) {
      throw new NotFoundError('This supplier no longer exists.');
    }
    return this.toDto(supplier);
  },

  async update(id: string, input: UpdateSupplierRequest): Promise<SupplierDto> {
    const existing = await supplierRepository.findById(id);
    if (!existing) {
      throw new NotFoundError('This supplier no longer exists.');
    }
    return this.toDto(await supplierRepository.update(id, input));
  },

  async remove(id: string): Promise<void> {
    const existing = await supplierRepository.findById(id);
    if (!existing) {
      throw new NotFoundError('This supplier no longer exists.');
    }
    await supplierRepository.remove(id);
  },
};
