import { Router } from 'express';
import * as webhookController from '../controllers/webhook-controller.js';

// Provider webhooks authenticate with the shared secret in the path, not JWT.
export const webhookRoutes: Router = Router();

webhookRoutes.post('/evolution/:secret', webhookController.evolutionWebhook);
