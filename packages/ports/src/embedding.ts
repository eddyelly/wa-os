/**
 * EmbeddingPort: provider and model come from env (EMBEDDING_PROVIDER,
 * EMBEDDING_MODEL_ID, EMBEDDING_DIM). Vectors are stored in pgvector.
 */

export interface EmbeddingPort {
  /** Embeds each input text; the result array is index-aligned with the input. */
  embed(texts: string[]): Promise<number[][]>;
}
