import { Router } from 'express';
import * as contactController from '../controllers/contact-controller.js';
import { requireAuth } from '../middleware/auth.js';

export const contactRoutes: Router = Router();

contactRoutes.use(requireAuth);
contactRoutes.get('/', contactController.list);
contactRoutes.post('/:id/opt-in', contactController.optIn);
contactRoutes.patch('/:id', contactController.update);
