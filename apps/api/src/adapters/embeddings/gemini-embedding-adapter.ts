import { GoogleGenAI } from '@google/genai';
import type { EmbeddingIntent, EmbeddingPort } from '@waos/ports';
import { AppError } from '../../lib/errors.js';
import { config } from '../../lib/config.js';

/**
 * Gemini EmbeddingPort. Uses the same GEMINI_API_KEY as the LLM adapter and
 * requests EMBEDDING_DIM-wide vectors so the pgvector column never changes.
 * Cosine distance is scale invariant, so truncated vectors need no
 * re-normalization for our retrieval query.
 */
export class GeminiEmbeddingAdapter implements EmbeddingPort {
  private readonly client = new GoogleGenAI({ apiKey: config.GEMINI_API_KEY });

  async embed(texts: string[], intent: EmbeddingIntent = 'document'): Promise<number[][]> {
    if (texts.length === 0) {
      return [];
    }
    const response = await this.client.models.embedContent({
      model: config.EMBEDDING_MODEL_ID,
      contents: texts,
      config: {
        outputDimensionality: config.EMBEDDING_DIM,
        taskType: intent === 'query' ? 'RETRIEVAL_QUERY' : 'RETRIEVAL_DOCUMENT',
      },
    });
    const vectors = (response.embeddings ?? []).map((item) => item.values ?? []);
    if (vectors.length !== texts.length) {
      throw new AppError('The embedding service returned the wrong number of vectors.', {
        statusCode: 502,
        code: 'EMBEDDING_FAILED',
        details: { expected: texts.length, got: vectors.length },
      });
    }
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
