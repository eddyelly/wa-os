import type { Request, Response } from 'express';
import { createProductRequestSchema, updateProductRequestSchema } from '@waos/shared';
import { ValidationError } from '../lib/errors.js';
import { routeParam } from '../lib/http.js';
import { importProductsCsv } from '../services/product-import.js';
import { productService } from '../services/product-service.js';

export const create = async (req: Request, res: Response): Promise<void> => {
  const input = createProductRequestSchema.parse(req.body);
  const product = await productService.create(input);
  res.status(201).json({ product });
};

export const list = async (req: Request, res: Response): Promise<void> => {
  const includeInactive = req.query.includeInactive === '1' || req.query.includeInactive === 'true';
  const products = await productService.list(includeInactive);
  res.json({ products });
};

export const update = async (req: Request, res: Response): Promise<void> => {
  const input = updateProductRequestSchema.parse(req.body);
  const product = await productService.update(routeParam(req.params.id), input);
  res.json({ product });
};

export const remove = async (req: Request, res: Response): Promise<void> => {
  await productService.remove(routeParam(req.params.id));
  res.json({ ok: true });
};

export const addImage = async (req: Request, res: Response): Promise<void> => {
  const file = req.file;
  if (!file) {
    throw new ValidationError('Attach an image file.');
  }
  const product = await productService.addImage(routeParam(req.params.id), {
    buffer: file.buffer,
    mimetype: file.mimetype,
    originalname: file.originalname,
  });
  res.status(201).json({ product });
};

export const removeImage = async (req: Request, res: Response): Promise<void> => {
  const product = await productService.removeImage(
    routeParam(req.params.id),
    routeParam(req.params.imageId),
  );
  res.json({ product });
};

export const importCsv = async (req: Request, res: Response): Promise<void> => {
  const file = req.file;
  if (!file) {
    throw new ValidationError('Attach a .csv file.');
  }
  const result = await importProductsCsv(file.buffer.toString('utf8'));
  res.json(result);
};
