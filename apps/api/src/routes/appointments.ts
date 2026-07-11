import { Router } from 'express';
import * as appointmentController from '../controllers/appointment-controller.js';
import { requireAuth } from '../middleware/auth.js';
import { requireModule } from '../middleware/require-module.js';

export const appointmentRoutes: Router = Router();

appointmentRoutes.use(requireAuth);
appointmentRoutes.use(requireModule('appointments'));
appointmentRoutes.post('/', appointmentController.create);
appointmentRoutes.get('/', appointmentController.list);
appointmentRoutes.get('/stats/weekly', appointmentController.weeklyStats);
appointmentRoutes.patch('/:id', appointmentController.update);
appointmentRoutes.post('/:id/status', appointmentController.setStatus);
