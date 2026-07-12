// Full order flow (negotiate -> record -> confirm -> stock -> notify)
// against a live database. Only the LLM and embeddings are mocked; every
// other moving part (runAgentLoop, buildShopTools, orderService,
// notificationRepository, productRepository, the tenant extension) runs for
// real. Gated on INTEGRATION_DATABASE_URL; setup/teardown idioms copied from
// webhook.integration.test.ts.
import type { EmbeddingPort, LLMPort, LlmCompletion, LlmCompletionParams } from '@waos/ports';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { runWithRequestContext } from './lib/context.js';
import { NotFoundError, ValidationError } from './lib/errors.js';
import { basePrisma } from './lib/prisma.js';
import { notificationRepository } from './repositories/notification-repository.js';
import { productRepository } from './repositories/product-repository.js';
import { runAgentLoop } from './services/ai-agent.js';
import { orderService } from './services/order-service.js';
import { buildShopTools } from './services/shop-tools.js';

const databaseUrl = process.env.INTEGRATION_DATABASE_URL;

/**
 * Scripted fake LLM: same idiom as ai-agent.test.ts's `scriptedLlm`.
 * `complete` pops the next queued response in order.
 */
function scriptedLlm(responses: LlmCompletion[]): LLMPort & { calls: LlmCompletionParams[] } {
  const queue = [...responses];
  const calls: LlmCompletionParams[] = [];
  return {
    calls,
    complete(params: LlmCompletionParams) {
      calls.push(params);
      const next = queue.shift();
      if (!next) {
        throw new Error('scriptedLlm: ran out of queued responses');
      }
      return Promise.resolve(next);
    },
  };
}

// Fixed vector: this flow never relies on similarity search (the scripted
// LLM calls negotiate_price/record_order with the real product id created
// below), so the exact values here are irrelevant.
const fakeEmbeddings: EmbeddingPort = {
  embed(texts: string[]) {
    return Promise.resolve(texts.map(() => new Array<number>(1536).fill(0.01)));
  },
};

describe.skipIf(!databaseUrl)('shop order flow (live database)', () => {
  let organizationId = '';
  let contactId = '';
  let conversationId = '';
  let productId = '';
  let orderId = '';

  // Prisma queries are lazy: they execute when awaited. The await must
  // happen inside the AsyncLocalStorage scope, exactly like a real request
  // where the whole handler chain runs inside runWithRequestContext.
  const asOrg = <T>(fn: () => Promise<T>): Promise<T> =>
    runWithRequestContext({ organizationId, userId: 'owner-1', role: 'OWNER' }, () =>
      fn().then((value) => value),
    );

  beforeAll(async () => {
    const organization = await basePrisma.organization.create({
      data: { name: 'Shop Flow Test Org', modules: ['appointments', 'shop'] },
    });
    organizationId = organization.id;

    const channel = await basePrisma.channel.create({
      data: { organizationId, provider: 'evolution', status: 'CONNECTED' },
    });

    const contact = await basePrisma.contact.create({
      data: { organizationId, phone: '+255744000222', name: 'Shop Customer' },
    });
    contactId = contact.id;

    const conversation = await basePrisma.conversation.create({
      data: { organizationId, channelId: channel.id, contactId },
    });
    conversationId = conversation.id;

    const product = await asOrg(() =>
      productRepository.create({
        name: 'Kanga set',
        description: 'A pair of matching kangas',
        price: 10000,
        minPrice: 8000,
        stockQty: 3,
        lowStockThreshold: 2,
        tags: [],
      }),
    );
    productId = product.id;
  });

  afterAll(async () => {
    await basePrisma.organization.delete({ where: { id: organizationId } });
    await basePrisma.$disconnect();
  });

  it('agent flow: negotiates to the floor, then records the order with a NEW_ORDER notification', async () => {
    const llm = scriptedLlm([
      {
        text: '',
        toolCalls: [{ name: 'negotiate_price', args: { productId, proposedPrice: 7000 } }],
      },
      {
        text: '',
        toolCalls: [
          {
            name: 'record_order',
            args: { items: [{ productId, quantity: 2, agreedPrice: 8000 }] },
          },
        ],
      },
      { text: '{"reply": "Nimeweka oda yako.", "confidence": 0.9, "intent": "other"}' },
    ]);

    const tools = buildShopTools({
      organizationId,
      conversationId,
      contactId,
      paymentInstructions: undefined,
      embeddings: fakeEmbeddings,
    });

    const result = await asOrg(() =>
      runAgentLoop({
        llm,
        system: 'You are a shop selling assistant.',
        messages: [{ role: 'user', content: 'Naomba kanga mbili kwa bei nzuri.' }],
        tools,
      }),
    );

    expect(result.output?.reply).toBe('Nimeweka oda yako.');
    expect(result.toolsUsed).toEqual(['negotiate_price', 'record_order']);

    // Assert the tool_result that drove the recorded order
    const secondCall = llm.calls[1];
    expect(secondCall).toBeDefined();
    const lastMessage = secondCall?.messages[secondCall.messages.length - 1];
    expect(lastMessage?.role).toBe('user');
    const messageContent = lastMessage?.content;
    expect(Array.isArray(messageContent)).toBe(true);
    if (Array.isArray(messageContent)) {
      const negotiatePricePart = messageContent.find(
        (part): part is { type: 'tool_result'; name: string; response: unknown } =>
          part.type === 'tool_result'
      );
      expect(negotiatePricePart?.name).toBe('negotiate_price');
      expect(negotiatePricePart?.response).toEqual({ accepted: false, counterPrice: 8000, isFinal: true });
    }

    const order = await asOrg(() =>
      basePrisma.order.findFirst({
        where: { organizationId, contactId },
        include: { items: true },
      }),
    );
    expect(order?.status).toBe('PENDING_CONFIRMATION');
    expect(order?.totalAgreed).toBe(16000);
    expect(order?.items).toHaveLength(1);
    expect(order?.items[0]?.productName).toBe('Kanga set');
    orderId = order?.id ?? '';

    const notifications = await asOrg(() => notificationRepository.list());
    const newOrderNotification = notifications.find((n) => n.type === 'NEW_ORDER');
    expect(newOrderNotification).toBeDefined();
    const newOrderPayload = newOrderNotification?.payload as Record<string, unknown> | undefined;
    expect(newOrderPayload?.orderId).toBe(orderId);
    expect(newOrderPayload?.total).toBe(16000);
  });

  it('confirm: CONFIRMED decrements stock and fires LOW_STOCK once the threshold is crossed', async () => {
    const dto = await asOrg(() => orderService.setStatus(orderId, 'CONFIRMED'));
    expect(dto.status).toBe('CONFIRMED');

    const product = await asOrg(() => productRepository.findById(productId));
    expect(product?.stockQty).toBe(1);

    const notifications = await asOrg(() => notificationRepository.list());
    const lowStockNotification = notifications.find((n) => n.type === 'LOW_STOCK');
    expect(lowStockNotification).toBeDefined();
    const lowStockPayload = lowStockNotification?.payload as Record<string, unknown> | undefined;
    expect(lowStockPayload?.productId).toBe(productId);
    expect(lowStockPayload?.stockQty).toBe(1);
  });

  it('stock idempotency: PAID then FULFILLED leave stockQty unchanged at 1', async () => {
    await asOrg(() => orderService.setStatus(orderId, 'PAID'));
    let product = await asOrg(() => productRepository.findById(productId));
    expect(product?.stockQty).toBe(1);

    await asOrg(() => orderService.setStatus(orderId, 'FULFILLED'));
    product = await asOrg(() => productRepository.findById(productId));
    expect(product?.stockQty).toBe(1);
  });

  it('floor safety net: createFromAgent rejects an agreed price below the floor even called directly', async () => {
    await expect(
      asOrg(() =>
        orderService.createFromAgent({
          conversationId,
          contactId,
          items: [{ productId, quantity: 1, agreedPrice: 7000 }],
        }),
      ),
    ).rejects.toBeInstanceOf(ValidationError);
  });

  it('removeImage ownership: cannot remove another product own image, even within the same org', async () => {
    const productA = await asOrg(() =>
      productRepository.create({
        name: 'Product A',
        price: 5000,
        stockQty: 1,
        lowStockThreshold: 1,
        tags: [],
      }),
    );
    const productB = await asOrg(() =>
      productRepository.create({
        name: 'Product B',
        price: 5000,
        stockQty: 1,
        lowStockThreshold: 1,
        tags: [],
      }),
    );

    await asOrg(() =>
      productRepository.addImage(productA.id, { mediaKey: 'products/a/photo.jpg', description: 'A photo' }),
    );
    const imageA = await basePrisma.productImage.findFirst({ where: { productId: productA.id } });
    expect(imageA).not.toBeNull();

    await expect(
      asOrg(() => productRepository.removeImage(productB.id, imageA?.id ?? '')),
    ).rejects.toBeInstanceOf(NotFoundError);

    const survived = await basePrisma.productImage.findUnique({ where: { id: imageA?.id ?? '' } });
    expect(survived).not.toBeNull();
  });

  it('tenant isolation: a second org sees zero products, orders, and notifications from the first', async () => {
    const otherOrganization = await basePrisma.organization.create({
      data: { name: 'Shop Flow Test Org (Other Tenant)', modules: ['shop'] },
    });

    try {
      const asOtherOrg = <T>(fn: () => Promise<T>): Promise<T> =>
        runWithRequestContext(
          { organizationId: otherOrganization.id, userId: 'owner-2', role: 'OWNER' },
          () => fn().then((value) => value),
        );

      const products = await asOtherOrg(() => productRepository.list({ includeInactive: true }));
      expect(products).toEqual([]);

      const orders = await asOtherOrg(() => orderService.list());
      expect(orders).toEqual([]);

      const notifications = await asOtherOrg(() => notificationRepository.list());
      expect(notifications).toEqual([]);
    } finally {
      await basePrisma.organization.delete({ where: { id: otherOrganization.id } });
    }
  });
});
