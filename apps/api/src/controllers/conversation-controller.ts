import type { Request, Response } from 'express';
import { routeParam } from '../lib/http.js';
import {
  assignConversationRequestSchema,
  conversationStatusSchema,
  sendMessageRequestSchema,
  toggleAiRequestSchema,
  updateConversationStatusRequestSchema,
} from '@waos/shared';
import { conversationService } from '../services/conversation-service.js';

export const list = async (req: Request, res: Response): Promise<void> => {
  const status =
    typeof req.query.status === 'string'
      ? conversationStatusSchema.parse(req.query.status)
      : undefined;
  const conversations = await conversationService.list(status);
  res.json({ conversations });
};

export const messages = async (req: Request, res: Response): Promise<void> => {
  const items = await conversationService.messages(routeParam(req.params.id));
  res.json({ messages: items });
};

export const send = async (req: Request, res: Response): Promise<void> => {
  const input = sendMessageRequestSchema.parse(req.body);
  const message = await conversationService.sendFromAgent(
    routeParam(req.params.id),
    input.body,
    input.replyToMessageId,
  );
  res.status(201).json({ message });
};

export const assign = async (req: Request, res: Response): Promise<void> => {
  const input = assignConversationRequestSchema.parse(req.body);
  await conversationService.assign(routeParam(req.params.id), input.assigneeId);
  res.json({ ok: true });
};

export const setStatus = async (req: Request, res: Response): Promise<void> => {
  const input = updateConversationStatusRequestSchema.parse(req.body);
  await conversationService.setStatus(routeParam(req.params.id), input.status);
  res.json({ ok: true });
};

export const setAi = async (req: Request, res: Response): Promise<void> => {
  const input = toggleAiRequestSchema.parse(req.body);
  await conversationService.setAiEnabled(routeParam(req.params.id), input.aiEnabled);
  res.json({ ok: true });
};
