import { Router } from 'express';
import * as channelController from '../controllers/channel-controller.js';
import { requireAuth } from '../middleware/auth.js';

export const channelRoutes: Router = Router();

channelRoutes.use(requireAuth);
channelRoutes.post('/', channelController.create);
channelRoutes.get('/', channelController.list);
channelRoutes.post('/:id/connect', channelController.connect);
channelRoutes.post('/:id/disconnect', channelController.disconnect);
