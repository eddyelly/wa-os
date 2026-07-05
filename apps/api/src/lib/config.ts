import fs from 'node:fs';
import path from 'node:path';
import dotenv from 'dotenv';
import { z } from 'zod';

// Load .env from the app dir first, then the repo root. dotenv never
// overrides variables that are already set in the environment.
for (const candidate of ['.env', '../../.env']) {
  const envPath = path.resolve(process.cwd(), candidate);
  if (fs.existsSync(envPath)) {
    dotenv.config({ path: envPath });
  }
}

const warmupCapsSchema = z
  .string()
  .transform((value) => value.split(',').map((part) => Number(part.trim())))
  .pipe(z.array(z.number().int().positive()).min(1));

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().default(4000),

  DATABASE_URL: z.string().min(1),
  REDIS_URL: z.string().min(1),

  MINIO_ENDPOINT: z.string().min(1),
  MINIO_ACCESS_KEY: z.string().min(1),
  MINIO_SECRET_KEY: z.string().min(1),
  MINIO_BUCKET: z.string().min(1).default('waos-media'),

  EVOLUTION_API_URL: z.string().url(),
  EVOLUTION_API_KEY: z.string().min(1),
  EVOLUTION_WEBHOOK_SECRET: z.string().min(1),

  JWT_ACCESS_SECRET: z.string().min(32, 'must be at least 32 characters'),
  JWT_REFRESH_SECRET: z.string().min(32, 'must be at least 32 characters'),

  ANTHROPIC_API_KEY: z.string().min(1),
  LLM_MODEL_ID: z.string().min(1),

  EMBEDDING_PROVIDER: z.string().min(1),
  EMBEDDING_API_KEY: z.string().min(1),
  EMBEDDING_MODEL_ID: z.string().min(1),
  EMBEDDING_DIM: z.coerce.number().int().positive().default(1536),

  AI_CONFIDENCE_THRESHOLD: z.coerce.number().min(0).max(1).default(0.7),

  SEND_RATE_PER_MINUTE: z.coerce.number().int().positive().default(6),
  WARMUP_DAILY_CAPS: warmupCapsSchema.default('20,40,60,80,120,160,200,250,300,350,400,450,500,600'),
});

export type AppConfig = z.infer<typeof envSchema>;

// Exported for unit tests of parsing and defaults.
export { envSchema };

function loadConfig(): AppConfig {
  const parsed = envSchema.safeParse(process.env);
  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((issue) => `  - ${issue.path.join('.') || '(root)'}: ${issue.message}`)
      .join('\n');
    // The logger depends on config, so this startup failure uses stderr directly.
    console.error(
      `Invalid environment configuration:\n${issues}\n` +
        'Copy .env.example to .env at the repo root and fill in the missing values.',
    );
    process.exit(1);
  }
  return parsed.data;
}

export const config = loadConfig();
