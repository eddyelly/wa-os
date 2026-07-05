import { Router } from 'express';
import * as settingsController from '../controllers/settings-controller.js';
import { requireAuth } from '../middleware/auth.js';

export const dashboardRoutes: Router = Router();

dashboardRoutes.use(requireAuth);
dashboardRoutes.get('/', settingsController.dashboard);
