import type { Request, Response } from 'express';
import { createSupplierRequestSchema, updateSupplierRequestSchema } from '@waos/shared';
import { routeParam } from '../lib/http.js';
import { supplierService } from '../services/supplier-service.js';

export const create = async (req: Request, res: Response): Promise<void> => {
  const input = createSupplierRequestSchema.parse(req.body);
  const supplier = await supplierService.create(input);
  res.status(201).json({ supplier });
};

export const list = async (_req: Request, res: Response): Promise<void> => {
  const suppliers = await supplierService.list();
  res.json({ suppliers });
};

export const update = async (req: Request, res: Response): Promise<void> => {
  const input = updateSupplierRequestSchema.parse(req.body);
  const supplier = await supplierService.update(routeParam(req.params.id), input);
  res.json({ supplier });
};

export const remove = async (req: Request, res: Response): Promise<void> => {
  await supplierService.remove(routeParam(req.params.id));
  res.json({ ok: true });
};
