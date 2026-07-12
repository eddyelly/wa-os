import { Router } from 'express';
import * as orderController from '../controllers/order-controller.js';
import { requireAuth } from '../middleware/auth.js';
import { requireModule } from '../middleware/require-module.js';

export const orderRoutes: Router = Router();

orderRoutes.use(requireAuth);
orderRoutes.use(requireModule('shop'));
orderRoutes.get('/', orderController.list);
orderRoutes.post('/:id/status', orderController.setStatus);
