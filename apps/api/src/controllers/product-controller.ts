import type { Request, Response } from 'express';
import { createProductRequestSchema, updateProductRequestSchema } from '@waos/shared';
import { routeParam } from '../lib/http.js';
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
