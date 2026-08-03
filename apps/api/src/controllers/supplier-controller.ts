import type { Request, Response } from 'express';
import {
  createSourcedItemRequestSchema,
  createSupplierRequestSchema,
  updateSourcedItemRequestSchema,
  updateSupplierRequestSchema,
} from '@waos/shared';
import { ValidationError } from '../lib/errors.js';
import { routeParam } from '../lib/http.js';
import { sourcedItemService } from '../services/sourced-item-service.js';
import { importSourcedItemsCsv, importSuppliersCsv } from '../services/sourcing-import.js';
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

export const listItems = async (req: Request, res: Response): Promise<void> => {
  const items = await sourcedItemService.listBySupplier(routeParam(req.params.supplierId));
  res.json({ items });
};

export const createItem = async (req: Request, res: Response): Promise<void> => {
  const input = createSourcedItemRequestSchema.parse(req.body);
  const item = await sourcedItemService.create(routeParam(req.params.supplierId), input);
  res.status(201).json({ item });
};

export const updateItem = async (req: Request, res: Response): Promise<void> => {
  const input = updateSourcedItemRequestSchema.parse(req.body);
  const item = await sourcedItemService.update(
    routeParam(req.params.supplierId),
    routeParam(req.params.itemId),
    input,
  );
  res.json({ item });
};

export const removeItem = async (req: Request, res: Response): Promise<void> => {
  await sourcedItemService.remove(routeParam(req.params.supplierId), routeParam(req.params.itemId));
  res.json({ ok: true });
};

export const addItemImage = async (req: Request, res: Response): Promise<void> => {
  const file = req.file;
  if (!file) {
    throw new ValidationError('Attach an image file.');
  }
  const item = await sourcedItemService.addImage(
    routeParam(req.params.supplierId),
    routeParam(req.params.itemId),
    { buffer: file.buffer, mimeType: file.mimetype },
  );
  res.json({ item });
};

export const removeItemImage = async (req: Request, res: Response): Promise<void> => {
  const item = await sourcedItemService.removeImage(
    routeParam(req.params.supplierId),
    routeParam(req.params.itemId),
    routeParam(req.params.imageId),
  );
  res.json({ item });
};

export const importSuppliers = async (req: Request, res: Response): Promise<void> => {
  const file = req.file;
  if (!file) {
    throw new ValidationError('Attach a .csv file.');
  }
  res.json(await importSuppliersCsv(file.buffer.toString('utf8')));
};

export const importItems = async (req: Request, res: Response): Promise<void> => {
  const file = req.file;
  if (!file) {
    throw new ValidationError('Attach a .csv file.');
  }
  res.json(
    await importSourcedItemsCsv(routeParam(req.params.supplierId), file.buffer.toString('utf8')),
  );
};
