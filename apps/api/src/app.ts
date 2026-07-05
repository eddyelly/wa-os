import cors from 'cors';
import express, { type Express } from 'express';
import { config } from './lib/config.js';
import { errorHandler, notFoundHandler } from './middleware/error-handler.js';
import { requestLogger } from './middleware/request-logger.js';
import { appointmentRoutes } from './routes/appointments.js';
import { authRoutes } from './routes/auth.js';
import { contactRoutes } from './routes/contacts.js';
import { channelRoutes } from './routes/channels.js';
import { conversationRoutes } from './routes/conversations.js';
import { healthRoutes } from './routes/health.js';
import { knowledgeRoutes } from './routes/knowledge.js';
import { organizationRoutes } from './routes/organization.js';
import { webhookRoutes } from './routes/webhooks.js';

export function createApp(): Express {
  const app = express();
  app.disable('x-powered-by');
  app.use(requestLogger);
  app.use(cors({ origin: config.WEB_ORIGIN, credentials: true }));
  app.use(express.json({ limit: '2mb' }));

  app.use('/health', healthRoutes);
  app.use('/api/v1/auth', authRoutes);
  app.use('/api/v1/channels', channelRoutes);
  app.use('/api/v1/conversations', conversationRoutes);
  app.use('/api/v1/organization', organizationRoutes);
  app.use('/api/v1/knowledge', knowledgeRoutes);
  app.use('/api/v1/appointments', appointmentRoutes);
  app.use('/api/v1/contacts', contactRoutes);
  app.use('/api/v1/webhooks', webhookRoutes);

  app.use(notFoundHandler);
  app.use(errorHandler);
  return app;
}
