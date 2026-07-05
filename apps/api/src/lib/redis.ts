import { Redis } from 'ioredis';
import { config } from './config.js';

export interface RedisConnectionOptions {
  host: string;
  port: number;
  password?: string;
  db?: number;
  maxRetriesPerRequest: null;
}

// BullMQ requires maxRetriesPerRequest: null on its connections; passing
// plain options (not a client) keeps the types aligned across packages.
export function redisConnectionOptions(): RedisConnectionOptions {
  const url = new URL(config.REDIS_URL);
  return {
    host: url.hostname,
    port: url.port ? Number(url.port) : 6379,
    ...(url.password ? { password: url.password } : {}),
    ...(url.pathname.length > 1 ? { db: Number(url.pathname.slice(1)) } : {}),
    maxRetriesPerRequest: null,
  };
}

/** Shared connection for app-level reads and writes (counters, locks). */
export const redis = new Redis(config.REDIS_URL, { lazyConnect: false });
