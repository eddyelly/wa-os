// Unit tests must run without a database or real secrets. Fill in safe
// defaults for anything not already provided by the environment or .env.
// Integration tests are gated separately on INTEGRATION_DATABASE_URL.

// When integration tests run, the app under test must hit the same database.
if (process.env.INTEGRATION_DATABASE_URL && !process.env.DATABASE_URL) {
  process.env.DATABASE_URL = process.env.INTEGRATION_DATABASE_URL;
}

const defaults: Record<string, string> = {
  NODE_ENV: 'test',
  DATABASE_URL: 'postgresql://waos:waos@localhost:5432/waos_test',
  REDIS_URL: 'redis://localhost:6379',
  MINIO_ENDPOINT: 'localhost:9000',
  MINIO_ACCESS_KEY: 'test-access-key',
  MINIO_SECRET_KEY: 'test-secret-key',
  EVOLUTION_API_URL: 'http://localhost:8080',
  EVOLUTION_API_KEY: 'test-evolution-key',
  EVOLUTION_WEBHOOK_SECRET: 'test-webhook-secret',
  JWT_ACCESS_SECRET: 'test-access-secret-0123456789-0123456789',
  JWT_REFRESH_SECRET: 'test-refresh-secret-0123456789-0123456789',
  GEMINI_API_KEY: 'test-gemini-key',
  LLM_MODEL_ID: 'gemini-test-model',
  EMBEDDING_PROVIDER: 'test',
  EMBEDDING_API_KEY: 'test-embedding-key',
  EMBEDDING_MODEL_ID: 'test-embedding-model',
};

for (const [key, value] of Object.entries(defaults)) {
  if (!process.env[key]) {
    process.env[key] = value;
  }
}
