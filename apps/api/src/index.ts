import { createApp } from './app.js';
import { config } from './lib/config.js';
import { logger } from './lib/logger.js';
import { basePrisma } from './lib/prisma.js';

const app = createApp();

const server = app.listen(config.PORT, () => {
  logger.info({ port: config.PORT, env: config.NODE_ENV }, 'api listening');
});

function shutdown(signal: string): void {
  logger.info({ signal }, 'shutting down');
  server.close(() => {
    basePrisma
      .$disconnect()
      .catch((error: unknown) => {
        logger.error({ err: error }, 'error disconnecting prisma');
      })
      .finally(() => {
        process.exit(0);
      });
  });
}

process.on('SIGTERM', () => {
  shutdown('SIGTERM');
});
process.on('SIGINT', () => {
  shutdown('SIGINT');
});
