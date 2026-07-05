import type { Request, Response } from 'express';
import { routeParam } from '../lib/http.js';
import { channelService } from '../services/channel-service.js';

export const create = async (_req: Request, res: Response): Promise<void> => {
  const result = await channelService.createAndConnect();
  res.status(201).json(result);
};

export const list = async (_req: Request, res: Response): Promise<void> => {
  const channels = await channelService.list();
  res.json({ channels: channels.map((channel) => channelService.toDto(channel)) });
};

export const connect = async (req: Request, res: Response): Promise<void> => {
  const result = await channelService.connect(routeParam(req.params.id));
  res.json(result);
};

export const disconnect = async (req: Request, res: Response): Promise<void> => {
  const channel = await channelService.disconnect(routeParam(req.params.id));
  res.json({ channel: channelService.toDto(channel) });
};
