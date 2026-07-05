import { Router } from 'express';

export const healthRoutes: Router = Router();

healthRoutes.get('/', (_req, res) => {
  res.json({ status: 'ok', uptimeSeconds: Math.round(process.uptime()) });
});
