import type { Worker } from 'bullmq';
import { logger } from '../lib/logger.js';
import { startOutboundWorker } from './outbound-worker.js';

const workers: Worker[] = [];

export function startWorkers(): void {
  workers.push(startOutboundWorker());
  logger.info({ count: workers.length }, 'workers started');
}

export async function stopWorkers(): Promise<void> {
  await Promise.all(workers.map((worker) => worker.close()));
  workers.length = 0;
}

export function registerWorker(worker: Worker): void {
  workers.push(worker);
}
