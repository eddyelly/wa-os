import { Router } from 'express';
import * as conversationController from '../controllers/conversation-controller.js';
import { requireAuth } from '../middleware/auth.js';

export const conversationRoutes: Router = Router();

conversationRoutes.use(requireAuth);
conversationRoutes.get('/', conversationController.list);
conversationRoutes.get('/:id/messages', conversationController.messages);
conversationRoutes.post('/:id/messages', conversationController.send);
conversationRoutes.post('/:id/assign', conversationController.assign);
conversationRoutes.post('/:id/status', conversationController.setStatus);
conversationRoutes.post('/:id/ai', conversationController.setAi);
