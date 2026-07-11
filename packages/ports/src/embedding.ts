/**
 * EmbeddingPort: provider and model come from env (EMBEDDING_PROVIDER,
 * EMBEDDING_MODEL_ID, EMBEDDING_DIM). Vectors are stored in pgvector.
 */

/** Retrieval role of the texts being embedded; providers may optimize. */
export type EmbeddingIntent = 'document' | 'query';

export interface EmbeddingPort {
  /**
   * Embed each text; result is index-aligned with the input.
   * `intent` defaults to 'document'.
   */
  embed(texts: string[], intent?: EmbeddingIntent): Promise<number[][]>;
}
