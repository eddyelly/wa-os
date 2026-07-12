import { beforeEach, describe, expect, it, vi } from 'vitest';
import { runWithRequestContext } from '../lib/context.js';
import { ValidationError } from '../lib/errors.js';

// vi.hoisted is required (see apps/api/src/lib/queues.test.ts) because the
// vi.mock factories below are hoisted above these consts; a plain top-level
// const referenced from inside a factory would throw a temporal-dead-zone
// ReferenceError otherwise.
const { repo, embed, getMediaUrl, putMediaObject, llmComplete } = vi.hoisted(() => ({
  repo: {
    create: vi.fn(),
    findById: vi.fn(),
    list: vi.fn(),
    update: vi.fn(),
    remove: vi.fn(),
    setEmbedding: vi.fn(),
    searchByEmbedding: vi.fn(),
    searchByName: vi.fn(),
    adjustStock: vi.fn(),
    addImage: vi.fn(),
    removeImage: vi.fn(),
  },
  embed: vi.fn(),
  getMediaUrl: vi.fn(),
  putMediaObject: vi.fn(),
  llmComplete: vi.fn(),
}));

vi.mock('../repositories/product-repository.js', () => ({ productRepository: repo }));
vi.mock('../adapters/embeddings/embedding-adapter.js', () => ({
  embeddingPort: { embed },
}));
vi.mock('../lib/minio.js', () => ({ getMediaUrl, putMediaObject }));
vi.mock('../adapters/llm/gemini-adapter.js', () => ({
  llmPort: { complete: llmComplete },
}));

import { describeImage, productService } from './product-service.js';

const ctx = { organizationId: 'org1', userId: 'u1', role: 'OWNER' as const };

const baseProduct = {
  id: 'p1',
  organizationId: 'org1',
  name: 'Mug',
  description: 'A mug',
  price: 5000,
  minPrice: null,
  stockQty: 3,
  lowStockThreshold: 2,
  isActive: true,
  tags: [],
  images: [],
  createdAt: new Date('2026-01-01T00:00:00Z'),
  updatedAt: new Date('2026-01-01T00:00:00Z'),
};

const file = {
  buffer: Buffer.from('fake-image-bytes'),
  mimetype: 'image/png',
  originalname: 'mug.png',
};

describe('productService.addImage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    repo.findById.mockResolvedValue(baseProduct);
    repo.setEmbedding.mockResolvedValue(undefined);
    repo.addImage.mockResolvedValue(undefined);
    repo.removeImage.mockResolvedValue(undefined);
    embed.mockResolvedValue([[0.1, 0.2, 0.3]]);
    putMediaObject.mockImplementation((key: string) => Promise.resolve(key));
    getMediaUrl.mockImplementation((key: string) => Promise.resolve(`https://cdn.example/${key}`));
    llmComplete.mockResolvedValue({ text: 'A blue ceramic mug with a white handle.' });
  });

  it('stores the object under `${organizationId}/products/${productId}/` via putMediaObject', async () => {
    await runWithRequestContext(ctx, () => productService.addImage('p1', file));

    expect(putMediaObject).toHaveBeenCalledTimes(1);
    const [key, buffer, mimeType] = putMediaObject.mock.calls[0] as [string, Buffer, string];
    expect(key).toMatch(/^org1\/products\/p1\/[^/]+$/);
    expect(buffer).toBe(file.buffer);
    expect(mimeType).toBe('image/png');
  });

  it('asks the LLM to describe the image with an image content part and stores the description', async () => {
    await runWithRequestContext(ctx, () => productService.addImage('p1', file));

    expect(llmComplete).toHaveBeenCalledTimes(1);
    const [params] = llmComplete.mock.calls[0] as [
      {
        system: string;
        messages: Array<{ role: string; content: Array<Record<string, unknown>> }>;
        maxTokens: number;
      },
    ];
    expect(params.system).toBe(
      'Describe this product photo for a shop catalog in one short paragraph: what the item is, its colors, materials, and any distinguishing features. Plain text, no lists.',
    );
    expect(params.maxTokens).toBe(200);
    expect(params.messages).toEqual([
      {
        role: 'user',
        content: [{ type: 'image', mimeType: 'image/png', data: file.buffer.toString('base64') }],
      },
    ]);

    expect(repo.addImage).toHaveBeenCalledTimes(1);
    const [productId, data] = repo.addImage.mock.calls[0] as [string, { mediaKey: string; description: string }];
    expect(productId).toBe('p1');
    expect(data.description).toBe('A blue ceramic mug with a white handle.');
  });

  it('rejects non-image mimetypes with ValidationError', async () => {
    const badFile = { ...file, mimetype: 'application/pdf' };

    await expect(
      runWithRequestContext(ctx, () => productService.addImage('p1', badFile)),
    ).rejects.toBeInstanceOf(ValidationError);

    expect(putMediaObject).not.toHaveBeenCalled();
    expect(llmComplete).not.toHaveBeenCalled();
    expect(repo.addImage).not.toHaveBeenCalled();
  });

  it('degrades gracefully on a vision failure: image saved with empty description, embedding refresh still runs', async () => {
    llmComplete.mockRejectedValue(new Error('vision service unavailable'));

    await runWithRequestContext(ctx, () => productService.addImage('p1', file));

    expect(repo.addImage).toHaveBeenCalledTimes(1);
    const [, data] = repo.addImage.mock.calls[0] as [string, { mediaKey: string; description: string }];
    expect(data.description).toBe('');

    expect(embed).toHaveBeenCalledTimes(1);
    expect(repo.setEmbedding).toHaveBeenCalledTimes(1);
  });

  it('refreshes the embedding and returns the product DTO after removeImage', async () => {
    const dto = await runWithRequestContext(ctx, () => productService.removeImage('p1', 'img1'));

    expect(repo.removeImage).toHaveBeenCalledWith('p1', 'img1');
    expect(embed).toHaveBeenCalledTimes(1);
    expect(repo.setEmbedding).toHaveBeenCalledTimes(1);
    expect(dto.id).toBe('p1');
  });
});

describe('describeImage', () => {
  it('returns trimmed text and caps it at 500 chars', async () => {
    const longText = `  ${'a'.repeat(600)}  `;
    const llm = { complete: vi.fn(() => Promise.resolve({ text: longText })) };

    const description = await describeImage(Buffer.from('bytes'), 'image/jpeg', { llm });

    expect(description).toBe('a'.repeat(500));
    expect(description.length).toBe(500);
  });

  it('propagates an LLM failure so the caller can decide how to degrade', async () => {
    const llm = { complete: vi.fn(() => Promise.reject(new Error('vision down'))) };

    await expect(describeImage(Buffer.from('bytes'), 'image/jpeg', { llm })).rejects.toThrow(
      'vision down',
    );
  });
});
