import { Router } from 'express';
import * as appointmentController from '../controllers/appointment-controller.js';
import { requireAuth } from '../middleware/auth.js';

export const appointmentRoutes: Router = Router();

appointmentRoutes.use(requireAuth);
appointmentRoutes.post('/', appointmentController.create);
appointmentRoutes.get('/', appointmentController.list);
appointmentRoutes.get('/stats/weekly', appointmentController.weeklyStats);
appointmentRoutes.patch('/:id', appointmentController.update);
appointmentRoutes.post('/:id/status', appointmentController.setStatus);
