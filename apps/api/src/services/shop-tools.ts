import { z } from 'zod';
import type { EmbeddingPort, LlmToolDefinition } from '@waos/ports';
import { ValidationError } from '../lib/errors.js';
import { knowledgeRepository } from '../repositories/knowledge-repository.js';
import { productRepository } from '../repositories/product-repository.js';
import type { AgentTools } from './ai-agent.js';
import { orderService } from './order-service.js';

const searchArgsSchema = z.object({ query: z.string() });

const negotiateArgsSchema = z.object({
  productId: z.string(),
  proposedPrice: z.number().int(),
});

const recordOrderArgsSchema = z.object({
  items: z.array(
    z.object({
      productId: z.string(),
      quantity: z.number().int(),
      agreedPrice: z.number().int(),
    }),
  ),
  note: z.string().optional(),
});

const searchProductsParameters = {
  type: 'object',
  properties: { query: { type: 'string' } },
  required: ['query'],
};

const TOOL_DEFINITIONS: LlmToolDefinition[] = [
  {
    name: 'search_products',
    description: 'Search the shop catalog by text. Returns matches with price and availability.',
    parameters: searchProductsParameters,
  },
  {
    name: 'negotiate_price',
    description:
      "Propose a discounted price for one product on the customer's behalf. Returns whether the shop accepts.",
    parameters: {
      type: 'object',
      properties: {
        productId: { type: 'string' },
        proposedPrice: { type: 'integer' },
      },
      required: ['productId', 'proposedPrice'],
    },
  },
  {
    name: 'record_order',
    description:
      'Record the order once the customer has clearly agreed to buy at an agreed price. Returns payment instructions to relay.',
    parameters: {
      type: 'object',
      properties: {
        items: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              productId: { type: 'string' },
              quantity: { type: 'integer' },
              agreedPrice: { type: 'integer' },
            },
            required: ['productId', 'quantity', 'agreedPrice'],
          },
        },
        note: { type: 'string' },
      },
      required: ['items'],
    },
  },
  {
    name: 'search_knowledge',
    description: "Search the business's own information (services, hours, policies).",
    parameters: searchProductsParameters,
  },
];

/**
 * Builds the selling-agent tools for one conversation. Every executor here
 * is the boundary between the model and the real repositories/services: the
 * price floor (`Product.minPrice`) is read here and in orderService, never
 * sent to the model and never named as a "floor" in any tool result, per
 * the Task 8 brief's hard security property. `negotiate_price`'s decline
 * path returns the floor value itself as `counterPrice`, indistinguishable
 * from any other number to the model.
 */
export function buildShopTools(params: {
  organizationId: string;
  conversationId: string | null;
  contactId: string;
  paymentInstructions: string | undefined;
  embeddings: EmbeddingPort;
}): AgentTools {
  const { conversationId, contactId, paymentInstructions, embeddings } = params;

  async function searchProducts(query: string): Promise<unknown> {
    const [queryEmbedding] = await embeddings.embed([query], 'query');
    const byEmbedding = queryEmbedding ? await productRepository.searchByEmbedding(queryEmbedding) : [];
    const matches = byEmbedding.length > 0 ? byEmbedding : await productRepository.searchByName(query);
    return {
      products: matches.map((product) => ({
        productId: product.id,
        name: product.name,
        description: product.description,
        price: product.price,
        inStock: product.stockQty > 0,
      })),
    };
  }

  async function negotiatePrice(productId: string, proposedPrice: number): Promise<unknown> {
    const product = await productRepository.findById(productId);
    if (!product || !product.isActive) {
      return { error: 'unknown product' };
    }
    const floor = product.minPrice ?? product.price;
    if (proposedPrice >= floor) {
      return { accepted: true, agreedPrice: proposedPrice };
    }
    // The floor value itself is the counter: it is never labeled as a
    // floor and no lower bound is ever revealed as such.
    return { accepted: false, counterPrice: floor, isFinal: true };
  }

  async function recordOrder(
    items: Array<{ productId: string; quantity: number; agreedPrice: number }>,
    note: string | undefined,
  ): Promise<unknown> {
    try {
      const result = await orderService.createFromAgent({
        conversationId,
        contactId,
        items,
        note,
      });
      return {
        orderId: result.orderId,
        totalAgreed: result.totalAgreed,
        paymentInstructions: paymentInstructions ?? 'Ask the shop for payment details.',
      };
    } catch (error) {
      if (error instanceof ValidationError) {
        // Re-validated in code against the live floor and stock: surfaced
        // as data, not a crash, so the model can renegotiate.
        return { error: error.message };
      }
      throw error;
    }
  }

  async function searchKnowledge(query: string): Promise<unknown> {
    const [queryEmbedding] = await embeddings.embed([query], 'query');
    const snippets = queryEmbedding ? await knowledgeRepository.searchChunks(queryEmbedding) : [];
    return { snippets: snippets.map((chunk) => chunk.content) };
  }

  return {
    definitions: TOOL_DEFINITIONS,
    async execute(name: string, args: Record<string, unknown>): Promise<unknown> {
      switch (name) {
        case 'search_products': {
          const { query } = searchArgsSchema.parse(args);
          return searchProducts(query);
        }
        case 'negotiate_price': {
          const { productId, proposedPrice } = negotiateArgsSchema.parse(args);
          return negotiatePrice(productId, proposedPrice);
        }
        case 'record_order': {
          const { items, note } = recordOrderArgsSchema.parse(args);
          return recordOrder(items, note);
        }
        case 'search_knowledge': {
          const { query } = searchArgsSchema.parse(args);
          return searchKnowledge(query);
        }
        default:
          throw new Error(`Unknown tool: ${name}`);
      }
    },
  };
}
