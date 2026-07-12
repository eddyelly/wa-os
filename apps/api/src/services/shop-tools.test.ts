import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { EmbeddingPort } from '@waos/ports';
import { ValidationError } from '../lib/errors.js';

// vi.hoisted is required because vi.mock factories below are hoisted above
// these consts (see order-service.test.ts for the same pattern): a plain
// top-level const referenced from inside a factory would otherwise throw a
// temporal-dead-zone ReferenceError.
const { productRepo, orderSvc, knowledgeRepo } = vi.hoisted(() => ({
  productRepo: {
    searchByEmbedding: vi.fn(),
    searchByName: vi.fn(),
    findById: vi.fn(),
  },
  orderSvc: {
    createFromAgent: vi.fn(),
  },
  knowledgeRepo: {
    searchChunks: vi.fn(),
  },
}));

vi.mock('../repositories/product-repository.js', () => ({ productRepository: productRepo }));
vi.mock('../repositories/knowledge-repository.js', () => ({ knowledgeRepository: knowledgeRepo }));
vi.mock('./order-service.js', () => ({ orderService: orderSvc }));

import { buildShopTools } from './shop-tools.js';

/** Walks the value and fails if `minPrice` appears as a key anywhere, at any depth. */
function assertNoMinPriceKey(value: unknown): void {
  if (Array.isArray(value)) {
    for (const item of value) {
      assertNoMinPriceKey(item);
    }
    return;
  }
  if (value && typeof value === 'object') {
    expect(Object.keys(value)).not.toContain('minPrice');
    for (const nested of Object.values(value)) {
      assertNoMinPriceKey(nested);
    }
  }
}

function fakeEmbeddings(vector: number[] = [0.1, 0.2, 0.3]): EmbeddingPort & { embed: ReturnType<typeof vi.fn> } {
  return { embed: vi.fn((texts: string[]) => Promise.resolve(texts.map(() => vector))) };
}

function makeTools(params: { paymentInstructions?: string; embeddings?: EmbeddingPort } = {}) {
  return buildShopTools({
    organizationId: 'org1',
    conversationId: 'conv1',
    contactId: 'contact1',
    paymentInstructions: params.paymentInstructions,
    embeddings: params.embeddings ?? fakeEmbeddings(),
  });
}

describe('shop-tools: negotiate_price (the clamp)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('below floor returns exactly { accepted: false, counterPrice: floor, isFinal: true }, never labeled as a floor', async () => {
    productRepo.findById.mockResolvedValue({ id: 'p1', price: 10000, minPrice: 8000, isActive: true });
    const tools = makeTools();

    const result = await tools.execute('negotiate_price', { productId: 'p1', proposedPrice: 7000 });

    expect(result).toEqual({ accepted: false, counterPrice: 8000, isFinal: true });
    assertNoMinPriceKey(result);
  });

  it('at or above the floor accepts the proposed price', async () => {
    productRepo.findById.mockResolvedValue({ id: 'p1', price: 10000, minPrice: 8000, isActive: true });
    const tools = makeTools();

    expect(await tools.execute('negotiate_price', { productId: 'p1', proposedPrice: 8000 })).toEqual({
      accepted: true,
      agreedPrice: 8000,
    });
    expect(await tools.execute('negotiate_price', { productId: 'p1', proposedPrice: 9500 })).toEqual({
      accepted: true,
      agreedPrice: 9500,
    });
  });

  it('uses price as the floor when minPrice is null', async () => {
    productRepo.findById.mockResolvedValue({ id: 'p1', price: 10000, minPrice: null, isActive: true });
    const tools = makeTools();

    const result = await tools.execute('negotiate_price', { productId: 'p1', proposedPrice: 9999 });

    expect(result).toEqual({ accepted: false, counterPrice: 10000, isFinal: true });
  });

  it('reports an unknown product for a missing or inactive product id', async () => {
    productRepo.findById.mockResolvedValue(null);
    const tools = makeTools();
    expect(await tools.execute('negotiate_price', { productId: 'missing', proposedPrice: 1000 })).toEqual({
      error: 'unknown product',
    });

    productRepo.findById.mockResolvedValue({ id: 'p1', price: 10000, minPrice: null, isActive: false });
    expect(await tools.execute('negotiate_price', { productId: 'p1', proposedPrice: 1000 })).toEqual({
      error: 'unknown product',
    });
  });
});

describe('shop-tools: search_products', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('result contains no minPrice key, even though the ILIKE fallback returns full product rows', async () => {
    productRepo.searchByEmbedding.mockResolvedValue([]);
    productRepo.searchByName.mockResolvedValue([
      {
        id: 'p1',
        name: 'Wig',
        description: 'Nice wig',
        price: 85000,
        minPrice: 70000,
        stockQty: 4,
        isActive: true,
        images: [],
      },
    ]);
    const embeddings = fakeEmbeddings();
    const tools = makeTools({ embeddings });

    const result = await tools.execute('search_products', { query: 'wig' });

    expect(result).toEqual({
      products: [{ productId: 'p1', name: 'Wig', description: 'Nice wig', price: 85000, inStock: true }],
    });
    assertNoMinPriceKey(result);
    expect(embeddings.embed).toHaveBeenCalledWith(['wig'], 'query');
  });

  it('reports out of stock when stockQty is 0, using the embedding search path directly', async () => {
    productRepo.searchByEmbedding.mockResolvedValue([
      { id: 'p2', name: 'Comb', description: null, price: 2000, stockQty: 0, isActive: true, score: 0.8 },
    ]);
    const tools = makeTools();

    const result = await tools.execute('search_products', { query: 'comb' });

    expect(result).toEqual({
      products: [{ productId: 'p2', name: 'Comb', description: null, price: 2000, inStock: false }],
    });
    expect(productRepo.searchByName).not.toHaveBeenCalled();
    assertNoMinPriceKey(result);
  });

  it('accumulates productIdsSeen across calls, deduped, in order of first appearance', async () => {
    productRepo.searchByEmbedding.mockResolvedValueOnce([
      { id: 'p1', name: 'Wig', description: null, price: 85000, stockQty: 4, isActive: true, score: 0.9 },
      { id: 'p2', name: 'Comb', description: null, price: 2000, stockQty: 5, isActive: true, score: 0.7 },
    ]);
    productRepo.searchByEmbedding.mockResolvedValueOnce([
      { id: 'p2', name: 'Comb', description: null, price: 2000, stockQty: 5, isActive: true, score: 0.9 },
      { id: 'p3', name: 'Brush', description: null, price: 3000, stockQty: 2, isActive: true, score: 0.6 },
    ]);
    const tools = makeTools();

    await tools.execute('search_products', { query: 'wig' });
    await tools.execute('search_products', { query: 'comb' });

    expect(tools.productIdsSeen).toEqual(['p1', 'p2', 'p3']);
  });

  it('starts with an empty productIdsSeen when search_products has never run', () => {
    const tools = makeTools();
    expect(tools.productIdsSeen).toEqual([]);
  });
});

describe('shop-tools: record_order', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('passes through to createFromAgent and returns payment instructions', async () => {
    orderSvc.createFromAgent.mockResolvedValue({ orderId: 'o1', totalAgreed: 12000 });
    const tools = makeTools({ paymentInstructions: 'Pay via M-Pesa to 0700 000 000.' });

    const result = await tools.execute('record_order', {
      items: [{ productId: 'p1', quantity: 1, agreedPrice: 12000 }],
      note: 'gift wrap',
    });

    expect(orderSvc.createFromAgent).toHaveBeenCalledWith({
      conversationId: 'conv1',
      contactId: 'contact1',
      items: [{ productId: 'p1', quantity: 1, agreedPrice: 12000 }],
      note: 'gift wrap',
    });
    expect(result).toEqual({
      orderId: 'o1',
      totalAgreed: 12000,
      paymentInstructions: 'Pay via M-Pesa to 0700 000 000.',
    });
  });

  it('falls back to a generic payment message when the org has none configured', async () => {
    orderSvc.createFromAgent.mockResolvedValue({ orderId: 'o1', totalAgreed: 12000 });
    const tools = makeTools({ paymentInstructions: undefined });

    const result = await tools.execute('record_order', {
      items: [{ productId: 'p1', quantity: 1, agreedPrice: 12000 }],
    });

    expect(result).toEqual({
      orderId: 'o1',
      totalAgreed: 12000,
      paymentInstructions: 'Ask the shop for payment details.',
    });
  });

  it('surfaces a ValidationError as { error } so the model can renegotiate', async () => {
    orderSvc.createFromAgent.mockRejectedValue(
      new ValidationError('The agreed price for Wig is below the floor.'),
    );
    const tools = makeTools();

    const result = await tools.execute('record_order', {
      items: [{ productId: 'p1', quantity: 1, agreedPrice: 100 }],
    });

    expect(result).toEqual({ error: 'The agreed price for Wig is below the floor.' });
  });
});

describe('shop-tools: search_knowledge', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('embeds the query and returns matched snippets', async () => {
    knowledgeRepo.searchChunks.mockResolvedValue([
      { id: 'c1', docId: 'd1', content: 'Tunafungua saa tatu.', score: 0.8 },
    ]);
    const embeddings = fakeEmbeddings([0.4, 0.5]);
    const tools = makeTools({ embeddings });

    const result = await tools.execute('search_knowledge', { query: 'saa ngapi?' });

    expect(embeddings.embed).toHaveBeenCalledWith(['saa ngapi?'], 'query');
    expect(knowledgeRepo.searchChunks).toHaveBeenCalledWith([0.4, 0.5]);
    expect(result).toEqual({ snippets: ['Tunafungua saa tatu.'] });
  });
});
