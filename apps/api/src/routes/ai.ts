import { Router } from 'express';
import * as settingsController from '../controllers/settings-controller.js';
import { requireAuth } from '../middleware/auth.js';

export const aiRoutes: Router = Router();

aiRoutes.use(requireAuth);
aiRoutes.post('/test', settingsController.aiTest);
