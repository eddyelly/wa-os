import type { Request, Response } from 'express';
import { routeParam } from '../lib/http.js';
import { notificationService } from '../services/notification-service.js';

export const list = async (req: Request, res: Response): Promise<void> => {
  const unreadOnly = req.query.unread === '1' || req.query.unread === 'true';
  const notifications = await notificationService.list(unreadOnly);
  res.json({ notifications });
};

export const markRead = async (req: Request, res: Response): Promise<void> => {
  await notificationService.markRead(routeParam(req.params.id));
  res.json({ ok: true });
};

export const markAllRead = async (_req: Request, res: Response): Promise<void> => {
  await notificationService.markAllRead();
  res.json({ ok: true });
};
