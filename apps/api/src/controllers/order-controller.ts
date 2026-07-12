import type { Request, Response } from 'express';
import { orderStatusSchema, setOrderStatusRequestSchema } from '@waos/shared';
import { routeParam } from '../lib/http.js';
import { orderService } from '../services/order-service.js';

export const list = async (req: Request, res: Response): Promise<void> => {
  const status =
    typeof req.query.status === 'string' ? orderStatusSchema.parse(req.query.status) : undefined;
  const contactId =
    typeof req.query.contactId === 'string' && req.query.contactId.length > 0
      ? req.query.contactId
      : undefined;
  const orders = await orderService.list(status, contactId);
  res.json({ orders });
};

export const setStatus = async (req: Request, res: Response): Promise<void> => {
  const input = setOrderStatusRequestSchema.parse(req.body);
  const order = await orderService.setStatus(routeParam(req.params.id), input.status);
  res.json({ order });
};
