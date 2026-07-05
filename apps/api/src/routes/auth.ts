import { Router } from 'express';
import * as authController from '../controllers/auth-controller.js';
import { requireAuth } from '../middleware/auth.js';

export const authRoutes: Router = Router();

authRoutes.post('/signup', authController.signup);
authRoutes.post('/login', authController.login);
authRoutes.post('/refresh', authController.refresh);
authRoutes.get('/me', requireAuth, authController.me);
