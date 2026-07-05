import { Router } from 'express';
import * as organizationController from '../controllers/organization-controller.js';
import * as settingsController from '../controllers/settings-controller.js';
import { requireOwner } from '../middleware/require-owner.js';
import { requireAuth } from '../middleware/auth.js';

export const organizationRoutes: Router = Router();

organizationRoutes.use(requireAuth);
organizationRoutes.get('/', organizationController.get);
organizationRoutes.patch('/', organizationController.update);
organizationRoutes.get('/users', organizationController.listUsers);
organizationRoutes.post('/users', requireOwner, settingsController.invite);
organizationRoutes.patch('/ai-settings', requireOwner, settingsController.updateAiSettings);
