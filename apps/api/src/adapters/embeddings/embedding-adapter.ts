import { z } from 'zod';
import type { EmbeddingPort } from '@waos/ports';
import { AppError } from '../../lib/errors.js';
import { config } from '../../lib/config.js';

const PROVIDER_URLS: Record<string, string> = {
  voyage: 'https://api.voyageai.com/v1/embeddings',
  openai: 'https://api.openai.com/v1/embeddings',
};

const embeddingsResponseSchema = z
  .object({
    data: z.array(z.object({ embedding: z.array(z.number()) }).passthrough()),
  })
  .passthrough();

/**
 * Provider-agnostic HTTP EmbeddingPort: voyage and openai share the same
 * request and response shape. Provider, key, model, and dimension all come
 * from env.
 */
export class HttpEmbeddingAdapter implements EmbeddingPort {
  async embed(texts: string[]): Promise<number[][]> {
    if (texts.length === 0) {
      return [];
    }
    const url = PROVIDER_URLS[config.EMBEDDING_PROVIDER];
    if (!url) {
      throw new AppError(`Unknown embedding provider: ${config.EMBEDDING_PROVIDER}`, {
        statusCode: 500,
        code: 'EMBEDDING_PROVIDER_UNKNOWN',
      });
    }
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${config.EMBEDDING_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ model: config.EMBEDDING_MODEL_ID, input: texts }),
    });
    if (!response.ok) {
      throw new AppError('The embedding service rejected the request.', {
        statusCode: 502,
        code: 'EMBEDDING_FAILED',
        details: { status: response.status },
      });
    }
    const parsed = embeddingsResponseSchema.parse((await response.json()));
    const vectors = parsed.data.map((item) => item.embedding);
    for (const vector of vectors) {
      if (vector.length !== config.EMBEDDING_DIM) {
        throw new AppError(
          `Embedding dimension mismatch: expected ${config.EMBEDDING_DIM}, got ${vector.length}. Check EMBEDDING_MODEL_ID and EMBEDDING_DIM.`,
          { statusCode: 500, code: 'EMBEDDING_DIM_MISMATCH' },
        );
      }
    }
    return vectors;
  }
}

export const embeddingPort: EmbeddingPort = new HttpEmbeddingAdapter();
