import { beforeEach, describe, expect, it, vi } from 'vitest';

const embedContent = vi.fn();

vi.mock('@google/genai', () => ({
  GoogleGenAI: class {
    models = { embedContent };
  },
}));

import { config } from '../../lib/config.js';
import { GeminiEmbeddingAdapter } from './gemini-embedding-adapter.js';

function fakeVector(dim: number): number[] {
  return Array.from({ length: dim }, () => 0.1);
}

describe('GeminiEmbeddingAdapter', () => {
  beforeEach(() => {
    embedContent.mockReset();
  });

  it('returns [] for empty input without calling the API', async () => {
    const adapter = new GeminiEmbeddingAdapter();
    expect(await adapter.embed([])).toEqual([]);
    expect(embedContent).not.toHaveBeenCalled();
  });

  it('embeds texts with the configured dimension and document task type', async () => {
    embedContent.mockResolvedValue({
      embeddings: [{ values: fakeVector(config.EMBEDDING_DIM) }],
    });
    const adapter = new GeminiEmbeddingAdapter();
    const result = await adapter.embed(['bei ya rasta']);
    expect(result).toHaveLength(1);
    expect(result[0]).toHaveLength(config.EMBEDDING_DIM);
    const call = embedContent.mock.calls[0]?.[0] as {
      contents: string[];
      config: { outputDimensionality: number; taskType: string };
    };
    expect(call.contents).toEqual(['bei ya rasta']);
    expect(call.config.outputDimensionality).toBe(config.EMBEDDING_DIM);
    expect(call.config.taskType).toBe('RETRIEVAL_DOCUMENT');
  });

  it("uses the query task type for intent 'query'", async () => {
    embedContent.mockResolvedValue({
      embeddings: [{ values: fakeVector(config.EMBEDDING_DIM) }],
    });
    const adapter = new GeminiEmbeddingAdapter();
    await adapter.embed(['nywele ngapi?'], 'query');
    const call = embedContent.mock.calls[0]?.[0] as { config: { taskType: string } };
    expect(call.config.taskType).toBe('RETRIEVAL_QUERY');
  });

  it('throws EMBEDDING_DIM_MISMATCH when the provider returns a wrong width', async () => {
    embedContent.mockResolvedValue({ embeddings: [{ values: fakeVector(3) }] });
    const adapter = new GeminiEmbeddingAdapter();
    await expect(adapter.embed(['x'])).rejects.toMatchObject({
      code: 'EMBEDDING_DIM_MISMATCH',
    });
  });
});
