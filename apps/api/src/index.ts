import { createServer } from 'node:http';
import { createApp } from './app.js';
import { config } from './lib/config.js';
import { logger } from './lib/logger.js';
import { ensureBucket } from './lib/minio.js';
import { basePrisma } from './lib/prisma.js';
import { closeQueues } from './lib/queues.js';
import { redis } from './lib/redis.js';
import { channelService } from './services/channel-service.js';
import { closeSocketGateway, initSocketGateway } from './sockets/gateway.js';
import { startWorkers, stopWorkers } from './workers/index.js';

const app = createApp();
const server = createServer(app);
initSocketGateway(server);

server.listen(config.PORT, () => {
  logger.info({ port: config.PORT, env: config.NODE_ENV }, 'api listening');
});

startWorkers();
void ensureBucket();
// Sessions survive restarts: reconcile channel statuses on boot (CLAUDE.md 3.4).
void channelService.reconcileAllOnBoot().catch((error: unknown) => {
  logger.warn({ err: error }, 'boot reconcile failed');
});

let shuttingDown = false;
function shutdown(signal: string): void {
  if (shuttingDown) {
    return;
  }
  shuttingDown = true;
  logger.info({ signal }, 'shutting down');
  server.close(() => {
    Promise.allSettled([
      stopWorkers(),
      closeQueues(),
      closeSocketGateway(),
      basePrisma.$disconnect(),
      redis.quit(),
    ])
      .catch(() => undefined)
      .finally(() => {
        process.exit(0);
      });
  });
  // Do not hang forever on stuck connections.
  setTimeout(() => {
    process.exit(0);
  }, 10_000).unref();
}

process.on('SIGTERM', () => {
  shutdown('SIGTERM');
});
process.on('SIGINT', () => {
  shutdown('SIGINT');
});
