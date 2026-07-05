import { describe, expect, it } from 'vitest';
import { envSchema } from './config.js';

const minimalEnv = {
  DATABASE_URL: 'postgresql://waos:waos@localhost:5432/waos_test',
  REDIS_URL: 'redis://localhost:6379',
  MINIO_ENDPOINT: 'localhost:9000',
  MINIO_ACCESS_KEY: 'key',
  MINIO_SECRET_KEY: 'secret',
  EVOLUTION_API_URL: 'http://localhost:8080',
  EVOLUTION_API_KEY: 'evo-key',
  EVOLUTION_WEBHOOK_SECRET: 'evo-secret',
  JWT_ACCESS_SECRET: 'a'.repeat(32),
  JWT_REFRESH_SECRET: 'b'.repeat(32),
  ANTHROPIC_API_KEY: 'anthropic-key',
  LLM_MODEL_ID: 'claude-sonnet-5',
  EMBEDDING_PROVIDER: 'voyage',
  EMBEDDING_API_KEY: 'embed-key',
  EMBEDDING_MODEL_ID: 'voyage-3',
};

describe('env config schema', () => {
  it('applies documented defaults', () => {
    const parsed = envSchema.parse(minimalEnv);
    expect(parsed.PORT).toBe(4000);
    expect(parsed.MINIO_BUCKET).toBe('waos-media');
    expect(parsed.EMBEDDING_DIM).toBe(1536);
    expect(parsed.AI_CONFIDENCE_THRESHOLD).toBe(0.7);
    expect(parsed.SEND_RATE_PER_MINUTE).toBe(6);
    expect(parsed.WARMUP_DAILY_CAPS).toEqual([
      20, 40, 60, 80, 120, 160, 200, 250, 300, 350, 400, 450, 500, 600,
    ]);
  });

  it('parses WARMUP_DAILY_CAPS into a number array', () => {
    const parsed = envSchema.parse({ ...minimalEnv, WARMUP_DAILY_CAPS: '5, 10,15' });
    expect(parsed.WARMUP_DAILY_CAPS).toEqual([5, 10, 15]);
  });

  it('rejects malformed WARMUP_DAILY_CAPS', () => {
    expect(() => envSchema.parse({ ...minimalEnv, WARMUP_DAILY_CAPS: '5,ten,15' })).toThrow();
  });

  it('rejects a missing required variable with a pointable path', () => {
    const { DATABASE_URL: _omitted, ...withoutDb } = minimalEnv;
    const result = envSchema.safeParse(withoutDb);
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues.some((issue) => issue.path[0] === 'DATABASE_URL')).toBe(true);
    }
  });

  it('rejects short JWT secrets', () => {
    expect(() => envSchema.parse({ ...minimalEnv, JWT_ACCESS_SECRET: 'short' })).toThrow();
  });

  it('rejects an out-of-range confidence threshold', () => {
    expect(() => envSchema.parse({ ...minimalEnv, AI_CONFIDENCE_THRESHOLD: '1.5' })).toThrow();
  });
});
