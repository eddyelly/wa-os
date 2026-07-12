import { Router } from 'express';
import * as notificationController from '../controllers/notification-controller.js';
import { requireAuth } from '../middleware/auth.js';

// Not module-gated (unlike products/orders): a HANDOFF notification matters
// to appointment-only organizations too, not just shop-enabled ones.
export const notificationRoutes: Router = Router();

notificationRoutes.use(requireAuth);
notificationRoutes.get('/', notificationController.list);
notificationRoutes.post('/read-all', notificationController.markAllRead);
notificationRoutes.post('/:id/read', notificationController.markRead);
