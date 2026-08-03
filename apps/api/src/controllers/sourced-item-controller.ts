import type { Request, Response } from 'express';
import { sourcedItemService } from '../services/sourced-item-service.js';

export const search = async (req: Request, res: Response): Promise<void> => {
  const q = typeof req.query.q === 'string' ? req.query.q : '';
  const items = await sourcedItemService.search(q);
  res.json({ items });
};
