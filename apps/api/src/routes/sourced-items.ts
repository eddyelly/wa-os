import { Router } from 'express';
import * as sourcedItemController from '../controllers/sourced-item-controller.js';
import { requireAuth } from '../middleware/auth.js';
import { requireModule } from '../middleware/require-module.js';

export const sourcedItemRoutes: Router = Router();

sourcedItemRoutes.use(requireAuth);
sourcedItemRoutes.use(requireModule('sourcing'));
sourcedItemRoutes.get('/', sourcedItemController.search);
