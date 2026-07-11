# Revamp Phase B1: Shop Backend Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the shop module's backend: catalog with photo understanding, orders with inventory, notifications, and a Gemini tool-loop selling agent whose price floors are enforced by code.

**Architecture:** Five new tenant-scoped Prisma models (Product, ProductImage, Order, OrderItem, Notification) behind the existing layering (routes -> controllers -> services -> repositories). The ai-reply worker upgrades from single-shot JSON to a bounded tool loop in a new pure `ai-agent` service; shop tools (`searchProducts`, `negotiate`, `recordOrder`) execute server-side and clamp every price against the floor, which never enters the prompt. Product photos are described by Gemini vision at upload and folded into a per-product pgvector embedding, so text questions and customer photos search one space. Confirming an order decrements stock and fires notifications over the existing Socket.IO gateway, optionally relayed to the owner's own WhatsApp through the policy engine's new OWNER_ALERT action.

**Tech Stack:** Express 5, TypeScript strict, Prisma + Postgres 16 (pgvector), BullMQ, Zod, `@google/genai` behind `LLMPort`/`EmbeddingPort`, MinIO, Socket.IO, Vitest.

**Spec:** `docs/superpowers/specs/2026-07-11-waos-revamp-master-design.md` sections 4, 5, 6, 10, 11. Phase B2 (web screens) follows in a separate plan; this plan is backend-only and independently testable via the API.

## Global Constraints

- TypeScript `strict: true`; `any` is forbidden (use `unknown` + narrowing).
- No em dashes anywhere: code, comments, docs, or copy.
- Conventional commits (`feat:`, `fix:`, `test:` with scope).
- No floating promises; ESLint layering rules: controllers/routes/middleware/sockets/workers never import `@prisma/client` or `lib/prisma.js`.
- Provider SDKs never imported outside `apps/api/src/adapters/`.
- Boundary Zod schemas for NEW endpoints live in `packages/shared` (CLAUDE.md 6.4).
- Every new tenant table carries `organizationId`, is indexed on it, is registered in `TENANT_MODELS` AND `TENANT_RELATION_FIELDS` in `apps/api/src/lib/tenant.ts`, and repository raw SQL passes `organizationId` explicitly.
- Money is whole TZS as `Int`. The platform never processes payments; the AI only relays `paymentInstructions` text.
- THE FLOOR RULE: a product's `minPrice` (or `price` when `minPrice` is null) is never written into any prompt, never returned by any tool, and every model-proposed price is validated in code.
- Never log message bodies, media contents, or keys; ids and metadata only.
- Jobs stay idempotent; the ai-reply double-send guard (Task 8) is mandatory.
- `pnpm typecheck && pnpm lint && pnpm -F @waos/api test` green at every commit.
- Local env: Postgres host port 5433, Redis 6380 (root `.env` points there); Docker infra is already running.

## Existing signatures tasks rely on (verified)

- `putMediaObject(key: string, data: Buffer, mimeType: string): Promise<string>` and `getMediaUrl(key: string): Promise<string>` in `apps/api/src/lib/minio.ts`.
- `outboundService.sendText(params: { conversationId; body; authorType; action? }): Promise<Message>`.
- `contactRepository.upsertByPhone(phone: string, name?: string): Promise<Contact>`; `conversationRepository.upsertForContact(channelId, contactId): Promise<Conversation>`.
- `knowledgeRepository.searchChunks(queryEmbedding: number[], k = 6, floor = 0.35): Promise<RetrievedChunk[]>` (raw SQL pattern to copy for products).
- Ports: `LlmContentPart` includes `{type:'tool_call';name;args}` and `{type:'tool_result';name;response}`; `LlmCompletionParams.tools?: LlmToolDefinition[]`; `LlmCompletion.toolCalls?: LlmToolCall[]`; `EmbeddingPort.embed(texts, intent?: 'document'|'query')`.
- `parseOrgAiSettings(settings: unknown): { aiEnabled: boolean; aiConfidenceThreshold?: number; toneNotes?: string }` in `apps/api/src/services/ai-reply.ts`.
- `requireModule('shop')` middleware; `emitToOrg(organizationId, event, payload)` in `apps/api/src/sockets/gateway.ts` (extend its `SocketEvent` union when adding events).
- Multer memory-storage pattern: `apps/api/src/routes/knowledge.ts`.

---

### Task 1: Shared schemas for products, orders, notifications, and shop settings

**Files:**
- Create: `packages/shared/src/schemas/product.ts`
- Create: `packages/shared/src/schemas/order.ts`
- Create: `packages/shared/src/schemas/notification.ts`
- Modify: `packages/shared/src/schemas/organization.ts` (shop settings request)
- Modify: `packages/shared/src/index.ts` (barrel exports)
- Test: `apps/api/src/services/shop-schemas.test.ts`

**Interfaces:**
- Consumes: `businessModuleSchema` conventions from `packages/shared/src/schemas/modules.ts` (style reference only).
- Produces (later tasks import these EXACT names from `@waos/shared`):
  - `createProductRequestSchema`, `updateProductRequestSchema`, `productSchema`, `productImageSchema`, `ProductDto`, `CreateProductRequest`, `UpdateProductRequest`
  - `orderStatusSchema`, `OrderStatus` (type), `orderSchema`, `orderItemSchema`, `OrderDto`, `setOrderStatusRequestSchema`
  - `notificationTypeSchema`, `notificationSchema`, `NotificationDto`
  - `updateShopSettingsRequestSchema`, `UpdateShopSettingsRequest`

- [ ] **Step 1: Write the failing test**

Create `apps/api/src/services/shop-schemas.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import {
  createProductRequestSchema,
  orderStatusSchema,
  setOrderStatusRequestSchema,
  updateShopSettingsRequestSchema,
} from '@waos/shared';

describe('shop schemas', () => {
  it('accepts a minimal product and applies defaults', () => {
    const parsed = createProductRequestSchema.parse({ name: 'Hair oil', price: 12000 });
    expect(parsed).toMatchObject({ name: 'Hair oil', price: 12000, stockQty: 0, lowStockThreshold: 5, tags: [] });
  });

  it('rejects a floor above the list price', () => {
    expect(() =>
      createProductRequestSchema.parse({ name: 'Hair oil', price: 10000, minPrice: 12000 }),
    ).toThrow();
  });

  it('rejects non-integer or non-positive prices', () => {
    expect(() => createProductRequestSchema.parse({ name: 'X', price: 99.5 })).toThrow();
    expect(() => createProductRequestSchema.parse({ name: 'X', price: 0 })).toThrow();
  });

  it('order status enum is exactly the five states', () => {
    expect(orderStatusSchema.options).toEqual([
      'PENDING_CONFIRMATION',
      'CONFIRMED',
      'PAID',
      'FULFILLED',
      'CANCELLED',
    ]);
    expect(setOrderStatusRequestSchema.parse({ status: 'CONFIRMED' }).status).toBe('CONFIRMED');
  });

  it('shop settings accepts payment instructions and an E.164 owner phone', () => {
    const parsed = updateShopSettingsRequestSchema.parse({
      paymentInstructions: 'Lipa Namba 555111, jina WaOS Demo',
      ownerAlertPhone: '+255700000001',
      ownerAlertsEnabled: true,
    });
    expect(parsed.ownerAlertPhone).toBe('+255700000001');
    expect(() => updateShopSettingsRequestSchema.parse({ ownerAlertPhone: '0712345678' })).toThrow();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm -F @waos/api test -- shop-schemas`
Expected: FAIL (`createProductRequestSchema` is not exported from `@waos/shared`).

- [ ] **Step 3: Implement the schemas**

`packages/shared/src/schemas/product.ts`:

```ts
import { z } from 'zod';

const price = z.number().int().positive();

export const createProductRequestSchema = z
  .object({
    name: z.string().trim().min(2).max(120),
    description: z.string().trim().max(2000).optional(),
    price,
    minPrice: price.optional(),
    stockQty: z.number().int().min(0).default(0),
    lowStockThreshold: z.number().int().min(0).default(5),
    tags: z.array(z.string().trim().min(1).max(40)).max(20).default([]),
  })
  .refine((p) => p.minPrice === undefined || p.minPrice <= p.price, {
    message: 'minPrice cannot exceed price',
    path: ['minPrice'],
  });
export type CreateProductRequest = z.infer<typeof createProductRequestSchema>;

export const updateProductRequestSchema = z
  .object({
    name: z.string().trim().min(2).max(120).optional(),
    description: z.string().trim().max(2000).nullable().optional(),
    price: price.optional(),
    minPrice: price.nullable().optional(),
    stockQty: z.number().int().min(0).optional(),
    lowStockThreshold: z.number().int().min(0).optional(),
    isActive: z.boolean().optional(),
    tags: z.array(z.string().trim().min(1).max(40)).max(20).optional(),
  })
  .refine((p) => p.minPrice == null || p.price === undefined || p.minPrice <= p.price, {
    message: 'minPrice cannot exceed price',
    path: ['minPrice'],
  });
export type UpdateProductRequest = z.infer<typeof updateProductRequestSchema>;

export const productImageSchema = z.object({
  id: z.string(),
  mediaUrl: z.string().nullable(),
  description: z.string(),
});

export const productSchema = z.object({
  id: z.string(),
  name: z.string(),
  description: z.string().nullable(),
  price: z.number().int(),
  minPrice: z.number().int().nullable(),
  stockQty: z.number().int(),
  lowStockThreshold: z.number().int(),
  isActive: z.boolean(),
  tags: z.array(z.string()),
  images: z.array(productImageSchema),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type ProductDto = z.infer<typeof productSchema>;
```

`packages/shared/src/schemas/order.ts`:

```ts
import { z } from 'zod';

export const orderStatusSchema = z.enum([
  'PENDING_CONFIRMATION',
  'CONFIRMED',
  'PAID',
  'FULFILLED',
  'CANCELLED',
]);
export type OrderStatus = z.infer<typeof orderStatusSchema>;

export const orderItemSchema = z.object({
  id: z.string(),
  productId: z.string().nullable(),
  productName: z.string(),
  quantity: z.number().int().positive(),
  listPrice: z.number().int(),
  agreedPrice: z.number().int(),
});

export const orderSchema = z.object({
  id: z.string(),
  status: orderStatusSchema,
  totalAgreed: z.number().int(),
  note: z.string().nullable(),
  conversationId: z.string().nullable(),
  contact: z.object({
    id: z.string(),
    name: z.string().nullable(),
    phone: z.string(),
  }),
  items: z.array(orderItemSchema),
  createdAt: z.string(),
});
export type OrderDto = z.infer<typeof orderSchema>;

export const setOrderStatusRequestSchema = z.object({ status: orderStatusSchema });
```

`packages/shared/src/schemas/notification.ts`:

```ts
import { z } from 'zod';

export const notificationTypeSchema = z.enum(['NEW_ORDER', 'LOW_STOCK', 'HANDOFF']);

export const notificationSchema = z.object({
  id: z.string(),
  type: notificationTypeSchema,
  payload: z.record(z.unknown()),
  readAt: z.string().nullable(),
  createdAt: z.string(),
});
export type NotificationDto = z.infer<typeof notificationSchema>;
```

Append to `packages/shared/src/schemas/organization.ts`:

```ts
export const updateShopSettingsRequestSchema = z.object({
  paymentInstructions: z.string().trim().max(500).optional(),
  ownerAlertPhone: z
    .string()
    .regex(/^\+[1-9]\d{6,14}$/, 'must be E.164, e.g. +2557...')
    .nullable()
    .optional(),
  ownerAlertsEnabled: z.boolean().optional(),
});
export type UpdateShopSettingsRequest = z.infer<typeof updateShopSettingsRequestSchema>;
```

Add `export * from './schemas/product.js';` etc. to `packages/shared/src/index.ts` following its existing style (explicit lines per module file).

- [ ] **Step 4: Run test to verify it passes, then all checks**

Run: `pnpm -F @waos/api test -- shop-schemas && pnpm typecheck && pnpm lint`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add -A && git commit -m "feat(shared): add product, order, notification, and shop settings schemas"
```

---

### Task 2: Prisma models, migration, tenant registration, seed products

**Files:**
- Modify: `apps/api/prisma/schema.prisma`
- Create: migration `add_shop_models` via `pnpm db:migrate`
- Modify: `apps/api/src/lib/tenant.ts` (`TENANT_MODELS`, `TENANT_RELATION_FIELDS`)
- Modify: `apps/api/prisma/seed.ts` (two demo products for Nuru Salon)
- Test: `apps/api/src/lib/tenant.test.ts` (model-coverage assertion updates)

**Interfaces:**
- Consumes: existing Organization/Contact/Conversation models.
- Produces: Prisma models `Product`, `ProductImage`, `Order`, `OrderItem`, `Notification`; enums `OrderStatus`, `NotificationType`; `AiReplyLog.toolsUsed String[] @default([])`. Exact fields below; later tasks depend on every name.

- [ ] **Step 1: Add enums and models to `apps/api/prisma/schema.prisma`**

Add enums after the existing ones:

```prisma
enum OrderStatus {
  PENDING_CONFIRMATION
  CONFIRMED
  PAID
  FULFILLED
  CANCELLED
}

enum NotificationType {
  NEW_ORDER
  LOW_STOCK
  HANDOFF
}
```

Add models (follow the file's field ordering conventions; every model gets `createdAt`/`updatedAt` like its siblings):

```prisma
model Product {
  id             String  @id @default(cuid())
  organizationId String
  organization   Organization @relation(fields: [organizationId], references: [id], onDelete: Cascade)

  name              String
  description       String?
  // Whole TZS. The platform never processes payments.
  price             Int
  // Bargaining floor; null means fixed price. NEVER exposed to the model.
  minPrice          Int?
  stockQty          Int     @default(0)
  lowStockThreshold Int     @default(5)
  isActive          Boolean @default(true)
  tags              String[] @default([])
  // Built from name + description + image descriptions; null until embedded.
  embedding         Unsupported("vector(1536)")?

  images     ProductImage[]
  orderItems OrderItem[]

  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt

  @@index([organizationId])
}

model ProductImage {
  id             String  @id @default(cuid())
  organizationId String
  organization   Organization @relation(fields: [organizationId], references: [id], onDelete: Cascade)
  productId      String
  product        Product @relation(fields: [productId], references: [id], onDelete: Cascade)

  mediaKey    String
  // Gemini vision writes this at upload; feeds the product embedding.
  description String @default("")

  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt

  @@index([organizationId])
  @@index([productId])
}

model Order {
  id             String  @id @default(cuid())
  organizationId String
  organization   Organization @relation(fields: [organizationId], references: [id], onDelete: Cascade)
  conversationId String?
  conversation   Conversation? @relation(fields: [conversationId], references: [id], onDelete: SetNull)
  contactId      String
  contact        Contact @relation(fields: [contactId], references: [id], onDelete: Cascade)

  status      OrderStatus @default(PENDING_CONFIRMATION)
  totalAgreed Int
  note        String?

  items OrderItem[]

  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt

  @@index([organizationId])
  @@index([organizationId, status])
}

model OrderItem {
  id             String  @id @default(cuid())
  organizationId String
  organization   Organization @relation(fields: [organizationId], references: [id], onDelete: Cascade)
  orderId        String
  order          Order @relation(fields: [orderId], references: [id], onDelete: Cascade)
  productId      String?
  product        Product? @relation(fields: [productId], references: [id], onDelete: SetNull)

  // Snapshot fields survive product deletion or edits.
  productName String
  quantity    Int
  listPrice   Int
  agreedPrice Int

  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt

  @@index([organizationId])
  @@index([orderId])
}

model Notification {
  id             String  @id @default(cuid())
  organizationId String
  organization   Organization @relation(fields: [organizationId], references: [id], onDelete: Cascade)

  type    NotificationType
  payload Json    @default("{}")
  readAt  DateTime?

  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt

  @@index([organizationId, readAt])
}
```

Wire the back-relations: `Organization` gains `products Product[]`, `productImages ProductImage[]`, `orders Order[]`, `orderItems OrderItem[]`, `notifications Notification[]`; `Contact` gains `orders Order[]`; `Conversation` gains `orders Order[]`. `AiReplyLog` gains `toolsUsed String[] @default([])` (comment: names of agent tools invoked for this decision).

- [ ] **Step 2: Create the migration and verify**

Run: `pnpm db:migrate` with name `add_shop_models`.
Expected: migration SQL contains the two `CREATE TYPE` enums, five `CREATE TABLE`s with `vector(1536)` on `Product.embedding`, and `ALTER TABLE "AiReplyLog" ADD COLUMN "toolsUsed" TEXT[]`. Verify backfill-free apply:

```bash
PGPASSWORD=waos psql -h localhost -p 5433 -U waos -d waos_dev -tAc '\d "Product"' | head -20
```

- [ ] **Step 3: Register tenancy**

In `apps/api/src/lib/tenant.ts` add `'product', 'productImage', 'order', 'orderItem', 'notification'` to `TENANT_MODELS` (match the existing camelCase key style used for model names there; check how existing entries are cased and follow it exactly). Add to `TENANT_RELATION_FIELDS`:

```ts
  product: ['organization', 'images', 'orderItems'],
  productImage: ['organization', 'product'],
  order: ['organization', 'conversation', 'contact', 'items'],
  orderItem: ['organization', 'order', 'product'],
  notification: ['organization'],
```

Also extend the EXISTING entries that gained back-relations: `contact` adds `'orders'`, `conversation` adds `'orders'`. (Read the file first; keys and shapes must match its current structure precisely.)

- [ ] **Step 4: Update the tenant model-coverage test**

`apps/api/src/lib/tenant.test.ts` asserts every domain model is covered (it lists 9 models today). Update the expected list to include the five new models (14 total). Run: `pnpm -F @waos/api test -- tenant`
Expected: PASS after the update; FAIL before it (which proves the assertion works).

- [ ] **Step 5: Seed two demo products**

In `apps/api/prisma/seed.ts`, after the knowledge doc creation, add idempotent creation (guard on `findFirst({ where: { organizationId, name } })`) of two products for the demo org:

```ts
const demoProducts = [
  {
    name: 'Mafuta ya nywele (hair oil)',
    description: 'Natural coconut hair oil, 250ml bottle.',
    price: 12000,
    minPrice: 9000,
    stockQty: 20,
    lowStockThreshold: 5,
  },
  {
    name: 'Wig ya braids (braided wig)',
    description: 'Hand-braided wig, medium length, black.',
    price: 85000,
    minPrice: 70000,
    stockQty: 3,
    lowStockThreshold: 2,
  },
];
```

(no embeddings at seed time; comment that embeddings arrive when products are edited via the API or re-embedded). Run `pnpm db:seed`; expected output unchanged plus no errors; verify `SELECT count(*) FROM "Product";` returns 2.

- [ ] **Step 6: Full checks and commit**

```bash
pnpm typecheck && pnpm lint && pnpm -F @waos/api test
git add -A && git commit -m "feat(shop): add product, order, and notification models with tenant registration"
```

---

### Task 3: Product repository and service (CRUD + vector search + embedding upsert)

**Files:**
- Create: `apps/api/src/repositories/product-repository.ts`
- Create: `apps/api/src/services/product-service.ts`
- Create: `apps/api/src/controllers/product-controller.ts`
- Create: `apps/api/src/routes/products.ts`
- Modify: `apps/api/src/app.ts` (mount `/api/v1/products`)
- Test: `apps/api/src/services/product-service.test.ts`

**Interfaces:**
- Consumes: Task 1 schemas; Task 2 models; `requireAuth`, `requireModule('shop')`; `embeddingPort` from `adapters/embeddings/embedding-adapter.js`; `getMediaUrl` from `lib/minio.js`.
- Produces:
  - `productRepository`: `create(data)`, `findById(id)` (includes images), `list(params: { includeInactive?: boolean })`, `update(id, data)`, `remove(id)`, `setEmbedding(id, embedding: number[] | null)` (raw SQL, org-scoped), `searchByEmbedding(queryEmbedding: number[], k = 5, floor = 0.3): Promise<Array<{ id; name; description: string | null; price: number; stockQty: number; isActive: boolean; score: number }>>` (raw SQL, org-scoped, active-only), `searchByName(query: string, k = 5)` (ILIKE fallback, tenant client), `adjustStock(id, delta: number): Promise<{ stockQty: number; lowStockThreshold: number; name: string }>` (atomic decrement returning fresh values).
  - `productService`: `create(input: CreateProductRequest): Promise<ProductDto>`, `update(id, input: UpdateProductRequest): Promise<ProductDto>`, `list(includeInactive: boolean): Promise<ProductDto[]>`, `remove(id): Promise<void>`, `refreshEmbedding(id): Promise<void>` (name + description + image descriptions -> one 'document' embedding; embedding failures are caught and logged, never fail the request), `toDto(product): Promise<ProductDto>` (presigns image URLs via `getMediaUrl`).
  - Routes: `POST /api/v1/products`, `GET /api/v1/products?includeInactive=1`, `PATCH /api/v1/products/:id`, `DELETE /api/v1/products/:id`, all behind `requireAuth` + `requireModule('shop')`.

- [ ] **Step 1: Write the failing service test** (mock the repository and embedding port with `vi.mock`; follow the `vi.hoisted` idiom from `apps/api/src/lib/queues.test.ts`)

`apps/api/src/services/product-service.test.ts` covers:

```ts
// 1. create() embeds name+description as a 'document' and stores it via setEmbedding
// 2. create() still succeeds when the embedding port rejects (embedding skipped, warn logged)
// 3. update() with a name/description change calls refreshEmbedding; stock-only change does not
// 4. toDto presigns each image mediaKey and hides mediaKey itself
// 5. remove() of a missing id throws NotFoundError
```

Write these five as real tests with a mocked `productRepository` (in-memory object store) and a mocked `embeddingPort.embed` returning `[[0.1, ...]]`; assert `setEmbedding` called with the vector, assert the embed call used intent `'document'` and a text containing both name and description.

- [ ] **Step 2: Run to verify FAIL** (`pnpm -F @waos/api test -- product-service`).

- [ ] **Step 3: Implement repository**

Copy the raw-SQL patterns from `apps/api/src/repositories/knowledge-repository.ts` exactly (parameterized `Prisma.sql`, `toVectorLiteral`, explicit `"organizationId" = ${organizationId}`). `searchByEmbedding` SQL:

```sql
SELECT id, name, description, price, "stockQty", "isActive",
       1 - (embedding <=> ${vector}::vector) AS score
FROM "Product"
WHERE "organizationId" = ${organizationId}
  AND "isActive" = true
  AND embedding IS NOT NULL
ORDER BY embedding <=> ${vector}::vector
LIMIT ${k}
```

then JS-filter `score >= floor`. `adjustStock` uses the tenant client's `update` with `{ stockQty: { increment: delta } }` and returns `{ stockQty, lowStockThreshold, name }` from the updated row; it must throw `ValidationError('stock cannot go negative')` when the resulting `stockQty` would be `< 0` (check current value first inside a `$transaction` on the tenant client, or catch the DB check; simplest correct: read, validate, update within `prisma.$transaction`).

- [ ] **Step 4: Implement service, controller, routes**

Service builds the embedding text as `[name, description ?? '', ...imageDescriptions].filter(Boolean).join('\n')`. Controller parses with Task 1 schemas, returns `{ product }` / `{ products }`. Routes file mirrors `apps/api/src/routes/appointments.ts` with `requireModule('shop')`. Mount in `app.ts` beside the other routers as `/api/v1/products`.

- [ ] **Step 5: Verify GREEN + live smoke**

`pnpm -F @waos/api test -- product-service` PASS. Then with `pnpm dev` running (background it; kill after):

```bash
TOKEN=$(curl -s -X POST http://localhost:4000/api/v1/auth/login -H 'Content-Type: application/json' -d '{"email":"demo@waos.dev","password":"DemoOwner123!"}' | node -e "let d='';process.stdin.on('data',c=>d+=c).on('end',()=>console.log(JSON.parse(d).tokens.accessToken))")
curl -s -X POST http://localhost:4000/api/v1/organization -o /dev/null # no-op warmup
curl -s http://localhost:4000/api/v1/products -H "Authorization: Bearer $TOKEN"
```

Expected: 403 MODULE_DISABLED for the demo org (appointments-only) PROVES gating; then PATCH the org to `{"modules":["appointments","shop"]}` and GET again: the two seeded products return (restore modules afterward is not needed; leave shop on for the demo org from now on, later tasks use it).

- [ ] **Step 6: Full checks and commit**

```bash
pnpm typecheck && pnpm lint && pnpm -F @waos/api test
git add -A && git commit -m "feat(shop): product catalog crud with vector search and embeddings"
```

---

### Task 4: Product images (upload -> MinIO -> vision description -> embedding refresh)

**Files:**
- Modify: `apps/api/src/routes/products.ts` (multer routes)
- Modify: `apps/api/src/controllers/product-controller.ts`
- Modify: `apps/api/src/services/product-service.ts` (`addImage`, `removeImage`, `describeImage`)
- Test: `apps/api/src/services/product-image.test.ts`

**Interfaces:**
- Consumes: `llmPort` from `adapters/llm/gemini-adapter.js` (image content part), `putMediaObject`, Task 3 service internals.
- Produces: `productService.addImage(productId, file: { buffer: Buffer; mimetype: string; originalname: string }): Promise<ProductDto>`; `productService.removeImage(productId, imageId): Promise<ProductDto>`; routes `POST /api/v1/products/:id/images` (multer single `file`, 5 MB, images only) and `DELETE /api/v1/products/:id/images/:imageId`; `describeImage(buffer, mimeType, ports?): Promise<string>` exported for the worker (Task 8 reuses it for customer photos).

- [ ] **Step 1: Failing tests** (`product-image.test.ts`, mocked llm + minio + repository):

```ts
// 1. addImage stores the object under `${organizationId}/products/${productId}/` via putMediaObject
// 2. addImage asks the LLM to describe the image with an image content part and stores the description
// 3. addImage rejects non-image mimetypes with ValidationError
// 4. a vision failure degrades gracefully: image saved with empty description, embedding refresh still runs
// 5. describeImage returns trimmed text and caps it at 500 chars
```

Vision prompt (exact, used by `describeImage`):

```
Describe this product photo for a shop catalog in one short paragraph: what the item is, its colors, materials, and any distinguishing features. Plain text, no lists.
```

Call shape: `llm.complete({ system: <prompt above>, messages: [{ role: 'user', content: [{ type: 'image', mimeType, data: buffer.toString('base64') }] }], maxTokens: 200 })`.

- [ ] **Step 2: RED**, then **Step 3: implement** (multer config copied from `apps/api/src/routes/knowledge.ts` with `limits: { fileSize: 5 * 1024 * 1024 }` and an image-only `fileFilter`), then after storing/removing an image call `refreshEmbedding(productId)`.

- [ ] **Step 4: GREEN + full checks**, then **Step 5: Commit**

```bash
git add -A && git commit -m "feat(shop): product photos with gemini vision descriptions"
```

---

### Task 5: Orders (state machine, stock decrement, low-stock detection)

**Files:**
- Create: `apps/api/src/repositories/order-repository.ts`
- Create: `apps/api/src/services/order-service.ts`
- Create: `apps/api/src/controllers/order-controller.ts`
- Create: `apps/api/src/routes/orders.ts`
- Modify: `apps/api/src/app.ts` (mount `/api/v1/orders`)
- Test: `apps/api/src/services/order-service.test.ts`

**Interfaces:**
- Consumes: Tasks 1-3; `notificationService.notify` (Task 6 defines it; THIS task defines the call site against the exact signature below and Task 6 must match it: `notify(type: 'NEW_ORDER' | 'LOW_STOCK' | 'HANDOFF', payload: Record<string, unknown>): Promise<void>`; until Task 6 lands, create a stub module `apps/api/src/services/notification-service.ts` exporting `notificationService = { async notify() {} }` so this task compiles and tests can spy on it).
- Produces:
  - `orderService.createFromAgent(params: { conversationId: string | null; contactId: string; items: Array<{ productId: string; quantity: number; agreedPrice: number }>; note?: string }): Promise<{ orderId: string; totalAgreed: number }>` used by the agent (Task 7). It re-validates EVERY item price against the floor in code (`agreedPrice >= (minPrice ?? price)`) and quantity against `stockQty`, snapshots `productName`/`listPrice`, creates the order `PENDING_CONFIRMATION`, and fires `notify('NEW_ORDER', { orderId, total, contactName })`.
  - `orderService.setStatus(id, status: OrderStatus): Promise<OrderDto>` with the legal transition map:
    `PENDING_CONFIRMATION -> CONFIRMED | CANCELLED`; `CONFIRMED -> PAID | FULFILLED | CANCELLED`; `PAID -> FULFILLED | CANCELLED`; `FULFILLED ->` (terminal); `CANCELLED ->` (terminal). Illegal transitions throw `ValidationError`.
  - Stock semantics: decrement happens EXACTLY ONCE, on the transition into `CONFIRMED`, via `productRepository.adjustStock(productId, -quantity)` per item; a cancel after CONFIRMED restores stock (`adjustStock(+quantity)`). After each decrement, if the fresh `stockQty <= lowStockThreshold` AND the pre-decrement value was `> lowStockThreshold`, fire `notify('LOW_STOCK', { productId, name, stockQty })` (fires once per crossing, not on every sale below threshold).
  - `orderService.list(status?: OrderStatus): Promise<OrderDto[]>`.
  - Routes: `GET /api/v1/orders?status=`, `POST /api/v1/orders/:id/status`, behind `requireAuth` + `requireModule('shop')`.

- [ ] **Step 1: Failing tests** (mock repositories + notification service; in-memory store):

```ts
// 1. createFromAgent rejects any item priced below the floor with ValidationError (the clamp)
// 2. createFromAgent rejects quantity exceeding stockQty
// 3. createFromAgent snapshots productName and listPrice and totals agreed prices
// 4. legal transition matrix: every allowed edge passes, every other edge throws
// 5. stock decrements once on CONFIRMED and never again on PAID/FULFILLED
// 6. LOW_STOCK fires exactly once when the decrement crosses the threshold, and not when already below
// 7. cancel after CONFIRMED restores stock; cancel from PENDING_CONFIRMATION does not touch stock
```

- [ ] **Step 2: RED**, **Step 3: implement**, **Step 4: GREEN + full checks**, **Step 5: Commit**

```bash
git add -A && git commit -m "feat(shop): orders with a guarded state machine, stock, and low-stock detection"
```

---

### Task 6: Notifications (repository, service, routes, socket event)

**Files:**
- Create: `apps/api/src/repositories/notification-repository.ts`
- Modify: `apps/api/src/services/notification-service.ts` (replace Task 5's stub)
- Create: `apps/api/src/controllers/notification-controller.ts`
- Create: `apps/api/src/routes/notifications.ts`
- Modify: `apps/api/src/app.ts` (mount `/api/v1/notifications`)
- Modify: `apps/api/src/sockets/gateway.ts` (`SocketEvent` union gains `'notification.new'`)
- Test: `apps/api/src/services/notification-service.test.ts`

**Interfaces:**
- Consumes: Task 2 Notification model; `emitToOrg`.
- Produces: `notificationService.notify(type, payload)` (persists + `emitToOrg(orgId, 'notification.new', { notificationId, type })`; payload details stay in the DB row, ids only over the socket); `notificationService.list(unreadOnly?: boolean): Promise<NotificationDto[]>` (newest first, cap 50); `markRead(id)`, `markAllRead()`. Routes: `GET /api/v1/notifications?unread=1`, `POST /api/v1/notifications/:id/read`, `POST /api/v1/notifications/read-all` behind `requireAuth` only (NOT module-gated: handoff notifications matter to appointments orgs too).
- NOTE: keep the exact `notify` signature Task 5 declared. Owner WhatsApp relay is Task 10, not here.

- [ ] **Step 1: Failing tests** (mocked repository + a spy on `emitToOrg` via `vi.mock` of the gateway):

```ts
// 1. notify persists the notification and emits notification.new with ids only (no payload body on the socket)
// 2. list(unreadOnly) filters readAt null
// 3. markRead sets readAt once and is idempotent
```

- [ ] **Step 2: RED**, **Step 3: implement**, **Step 4: GREEN + full checks + wire the emit sites** (Task 5's order-service calls now flow through the real service; re-run `pnpm -F @waos/api test -- order-service` to confirm nothing broke), **Step 5: Commit**

```bash
git add -A && git commit -m "feat(shop): notifications with realtime socket delivery"
```

---

### Task 7: Shop settings endpoint and policy OWNER_ALERT

**Files:**
- Modify: `apps/api/src/controllers/settings-controller.ts` (shop-settings handler)
- Modify: `apps/api/src/routes/organization.ts` (PATCH `/api/v1/organization/shop-settings`, owner-only)
- Modify: `packages/shared/src/schemas/policy.ts` (`policyActionSchema` gains `'OWNER_ALERT'`)
- Modify: `apps/api/src/policy/policy-engine.ts`
- Test: `apps/api/src/policy/policy-engine.test.ts` (extend), `apps/api/src/controllers/settings-controller.test.ts` (new)

**Interfaces:**
- Consumes: `updateShopSettingsRequestSchema` (Task 1), `requireOwner` middleware, org settings merge pattern from `updateAiSettings` in the same controller.
- Produces: org `settings` gains `paymentInstructions?: string`, `ownerAlertPhone?: string | null`, `ownerAlertsEnabled?: boolean`; policy action `OWNER_ALERT` with the evolution rule: `allow (rateLimited: true)` when `context.contactOptedIn` is true, else `block OPT_IN_REQUIRED` (the owner contact is opted in programmatically in Task 10 when alerts are enabled); cloud_api allows as usual.
- Also produce a pure settings reader in `apps/api/src/services/ai-reply.ts`: extend `parseOrgAiSettings`'s sibling with `parseOrgShopSettings(settings: unknown): { paymentInstructions?: string; ownerAlertPhone?: string; ownerAlertsEnabled: boolean }` (`ownerAlertsEnabled` true only when explicitly true AND a phone is set).

- [ ] **Step 1: Failing tests**

Policy test additions (follow the existing table-test style in `policy-engine.test.ts`):

```ts
// OWNER_ALERT on evolution: opted-in -> allow rate-limited; not opted-in -> block OPT_IN_REQUIRED
// OWNER_ALERT on cloud_api: allow
```

Settings controller test (mock org repository; mirror `organization-controller.test.ts` patterns): STAFF gets ForbiddenError from the route-level `requireOwner` (test the handler's schema merge only: paymentInstructions + ownerAlertPhone stored into settings, other settings keys preserved). Plus `parseOrgShopSettings` unit cases in `ai-reply.test.ts`: missing -> `{ ownerAlertsEnabled: false }`; enabled without phone -> false; enabled with phone -> true with the phone carried.

- [ ] **Step 2: RED**, **Step 3: implement**, **Step 4: GREEN + full checks**, **Step 5: Commit**

```bash
git add -A && git commit -m "feat(shop): shop settings and an owner-alert policy action"
```

---

### Task 8: The selling agent core (tool loop with server-enforced floors)

**Files:**
- Create: `apps/api/src/services/ai-agent.ts`
- Create: `apps/api/src/services/shop-tools.ts`
- Modify: `apps/api/src/services/ai-reply.ts` (`buildSystemPrompt` gains shop rules)
- Test: `apps/api/src/services/ai-agent.test.ts`, `apps/api/src/services/shop-tools.test.ts`

**Interfaces:**
- Consumes: ports (`LLMPort`, `LlmToolDefinition`, `LlmToolCall`, `LlmContentPart`), Task 3 `productRepository.searchByEmbedding`/`searchByName`/`findById`, Task 5 `orderService.createFromAgent`, Task 7 `parseOrgShopSettings`, `knowledgeRepository.searchChunks`, `embeddingPort`.
- Produces:

```ts
// ai-agent.ts
export interface AgentTools {
  definitions: LlmToolDefinition[];
  execute(name: string, args: Record<string, unknown>): Promise<unknown>;
}
export interface AgentRunResult {
  output: AiReplyOutput | null; // parsed final strict-JSON answer, null if unparseable after one repair
  toolsUsed: string[];
  raw: string; // final raw text for logging-free debugging (never logged)
}
export const MAX_TOOL_ROUNDS = 4;
export async function runAgentLoop(params: {
  llm: LLMPort;
  system: string;
  messages: LlmMessage[];
  tools: AgentTools | null; // null -> plain single-shot with repair (appointments orgs)
  maxTokens?: number;
}): Promise<AgentRunResult>;
```

Loop semantics (exact): call `llm.complete({ system, messages, tools: tools?.definitions })`. While the completion has `toolCalls` and rounds < `MAX_TOOL_ROUNDS`: for each call, run `tools.execute(name, args)` (an executor throwing produces a `{ error: <message> }` result instead of crashing the loop), append ONE assistant message whose content is the `tool_call` parts, then ONE user message whose content is the matching `tool_result` parts, and call again. After the loop (no toolCalls, or rounds exhausted: append a user text part `Answer now with the strict JSON only.` and make one final call WITHOUT tools), parse with `parseAiOutput`; on null do ONE repair call (reuse the exact repair message from `completeWithRepair`) without tools. Track every executed tool name in order in `toolsUsed`.

```ts
// shop-tools.ts
export function buildShopTools(params: {
  organizationId: string;
  conversationId: string | null;
  contactId: string;
  paymentInstructions: string | undefined;
  embeddings: EmbeddingPort;
}): AgentTools;
```

Tool definitions (names and JSON schemas exactly):

1. `search_products`: description: "Search the shop catalog by text. Returns matches with price and availability."; parameters `{ type: 'object', properties: { query: { type: 'string' } }, required: ['query'] }`. Executor: embed query with intent `'query'`, `searchByEmbedding`; if empty, `searchByName`. Returns `{ products: Array<{ productId, name, description, price, inStock: stockQty > 0 }> }`. NEVER returns `minPrice` or `stockQty` numbers.
2. `negotiate_price`: description: "Propose a discounted price for one product on the customer's behalf. Returns whether the shop accepts."; parameters `{ type: 'object', properties: { productId: { type: 'string' }, proposedPrice: { type: 'integer' } }, required: ['productId', 'proposedPrice'] }`. Executor: load product (missing/inactive -> `{ error: 'unknown product' }`); `floor = product.minPrice ?? product.price`; if `proposedPrice >= floor` return `{ accepted: true, agreedPrice: proposedPrice }` else return `{ accepted: false, counterPrice: floor, isFinal: true }`. THE FLOOR VALUE ITSELF IS THE COUNTER; it is never labeled as a floor and no lower bound is ever revealed as such.
3. `record_order`: description: "Record the order once the customer has clearly agreed to buy at an agreed price. Returns payment instructions to relay."; parameters `{ type: 'object', properties: { items: { type: 'array', items: { type: 'object', properties: { productId: { type: 'string' }, quantity: { type: 'integer' }, agreedPrice: { type: 'integer' } }, required: ['productId', 'quantity', 'agreedPrice'] } }, note: { type: 'string' } }, required: ['items'] }`. Executor: delegates to `orderService.createFromAgent` (which re-validates floors and stock in code); on success returns `{ orderId, totalAgreed, paymentInstructions: paymentInstructions ?? 'Ask the shop for payment details.' }`; on `ValidationError` returns `{ error: error.message }` so the model can renegotiate.
DESIGN NOTE (spec deviation, deliberate): the master design lists `handOff(reason)` as a tool; this plan keeps handoff on the existing confidence contract instead (final JSON confidence below the threshold -> PENDING, unchanged from today). Same behavior, one less tool, and the "Unchanged semantics" clause of the spec is honored. Likewise, customer photos are handed to Gemini natively as image parts (Task 9) rather than a separate describe-then-embed pre-step; the agent composes its own search_products query from what it sees, which covers the spec's photo-matching flow with less machinery.

4. `search_knowledge`: description: "Search the business's own information (services, hours, policies)."; parameters like search_products. Executor: embed + `knowledgeRepository.searchChunks`, return `{ snippets: string[] }`.

`buildSystemPrompt` change: add a `shop` param `{ enabled: boolean }`; when enabled, insert these rules after rule 5 (renumber the tone-notes rule):

```
6. You can sell from the catalog: use search_products before answering availability or price questions, and use the tools rather than guessing.
7. Bargaining: if the customer asks for a discount, you may propose their price with negotiate_price. If the shop declines, offer the counterPrice as the best you can do and call it final. Never invent discounts and never state that a lower limit exists.
8. When the customer clearly agrees to buy at an agreed price, call record_order once, then relay the payment instructions it returns and thank them.
```

- [ ] **Step 1: Failing tests**

`ai-agent.test.ts` with a scripted fake LLM (an object whose `complete` pops queued responses):

```ts
// 1. no tools: single call, strict JSON parsed (backward compatible)
// 2. tool round trip: first completion returns toolCalls, executor result is appended as
//    tool_call then tool_result parts, second completion's JSON is returned; toolsUsed recorded in order
// 3. round cap: LLM that always returns toolCalls stops at MAX_TOOL_ROUNDS and gets one
//    final no-tools call with the "Answer now" nudge
// 4. executor throw becomes { error } tool_result, loop continues
// 5. unparseable final answer triggers exactly one repair call; still-bad -> output null
```

`shop-tools.test.ts` with mocked repos/services (THE CLAMP TESTS, mandatory per spec):

```ts
// 1. negotiate_price below floor -> { accepted: false, counterPrice: floor, isFinal: true }
// 2. negotiate_price at/above floor -> accepted with the proposed price
// 3. negotiate_price with minPrice null uses price as the floor
// 4. search_products result contains no minPrice key (assert deep)
// 5. record_order passes through to createFromAgent and returns payment instructions
// 6. record_order surfaces ValidationError as { error } (model can renegotiate)
```

- [ ] **Step 2: RED**, **Step 3: implement**, **Step 4: GREEN + full checks**, **Step 5: Commit**

```bash
git add -A && git commit -m "feat(ai): tool-loop selling agent with code-enforced price floors"
```

---

### Task 9: Wire the agent into the ai-reply worker (vision trigger, double-send guard, toolsUsed)

**Files:**
- Modify: `apps/api/src/workers/ai-reply-worker.ts`
- Modify: `apps/api/src/services/inbound-service.ts` (IMAGE also enqueues ai-reply)
- Modify: `apps/api/src/services/ai-reply.ts` (`buildConversationMessages` supports an image part on the final user turn)
- Modify: `apps/api/src/repositories/ai-reply-log-repository.ts` (`toolsUsed`)
- Test: extend `apps/api/src/services/ai-reply.test.ts` (message building), `apps/api/src/workers/ai-reply-guard.test.ts` (new, guard only)

**Interfaces:**
- Consumes: Tasks 7-8; `describeImage` is NOT needed here (the image goes to the agent as a content part; Gemini sees it directly); `redis` from `lib/redis.js`; `evolutionAdapter.downloadMedia` is NOT needed (media is already in MinIO; add `getMediaObject(key): Promise<{ data: Buffer; mimeType: string }>` to `apps/api/src/lib/minio.ts` using the client's `getObject` + `statObject`).
- Produces:
  - Worker flow: load org -> `parseOrgAiSettings` gate (existing) -> modules check: shop tools only when `organization.modules.includes('shop')` -> build messages (if the inbound message has a `mediaKey` and `type === 'IMAGE'`, fetch bytes from MinIO and make the final user turn `content: [{ type: 'image', ... }, { type: 'text', text: body or 'What is this? Do you have it?' }]`) -> `runAgentLoop` -> decide/send exactly as today (`decideAiAction` on `output`) -> `aiReplyLogRepository.create({ ..., toolsUsed: result.toolsUsed })`.
  - Double-send guard (hardening, mandatory): before enqueueing the outbound send, `const guard = await redis.set(`ai-replied:${payload.inboundMessageId}`, '1', 'EX', 86400, 'NX')`; when `guard !== 'OK'`, log a warn with the message id and return WITHOUT sending (a BullMQ retry after a successful send must not double-send).
  - `inbound-service.ts` trigger change: `if (conversation.aiEnabled && (incoming.type === 'TEXT' || incoming.type === 'IMAGE'))` enqueue.
- Export a pure helper for the guard key: `export function aiReplyGuardKey(inboundMessageId: string): string` in the worker file for the test.

- [ ] **Step 1: Failing tests**

`ai-reply-guard.test.ts`: mock `lib/redis.js` (`set` returning 'OK' then null); assert the exported key builder and that a second `set` returning null means skip (test the tiny decision function you extract: `export function shouldSendAiReply(guardResult: string | null): boolean`). Extend `ai-reply.test.ts`: `buildConversationMessages` with a final IN message of type IMAGE and an injected image `{ mimeType, data }` produces a parts array ending with an image part plus text part.

- [ ] **Step 2: RED**, **Step 3: implement** (keep the booking PENDING flip and handoff semantics byte-identical; the agent replaces only the completion call), **Step 4: GREEN + full checks**, **Step 5: Live smoke** with `pnpm dev` + real WhatsApp if connected, otherwise via `POST /api/v1/ai/test` (which still uses the plain single-shot path; note in the report that agent-path live verification lands with Task 12's integration test), **Step 6: Commit**

```bash
git add -A && git commit -m "feat(ai): selling agent wired into the reply worker with vision and a double-send guard"
```

---

### Task 10: Product photo replies and outbound media hardening

**Files:**
- Modify: `apps/api/src/workers/outbound-worker.ts` (real mime type instead of `application/octet-stream`)
- Modify: `apps/api/src/services/outbound-service.ts` (`sendMedia` variant setting `mediaKey` on OUT messages)
- Modify: `apps/api/src/workers/ai-reply-worker.ts` (attach the matched product's first photo when the agent's reply cites exactly one product)
- Test: `apps/api/src/workers/outbound-media.test.ts` (new, pure pieces), extend `apps/api/src/services/ai-agent.test.ts`

**Interfaces:**
- Consumes: `getMediaObject`/`statObject` mime from Task 9's minio helper; `AgentRunResult` gains `productIdsSeen: string[]` (every productId returned by `search_products` during the run, exported from shop-tools execute results tracking).
- Produces:
  - `outboundService.sendMedia(params: { conversationId; mediaKey; caption?; authorType; action? }): Promise<Message>` mirroring `sendText` (policy check with `MEDIA_ACTIVE_CONVERSATION` default action, stores `mediaKey` + caption as body, enqueues same outbound job).
  - Outbound worker media path: resolve mime via MinIO `statObject(key).metaData['content-type']` (fall back to `application/octet-stream` only when absent) and pass a presigned URL as today.
  - Reply enrichment rule (deterministic, code not model): after a successful agent run that used `search_products` and where exactly ONE distinct productId appeared in tool results, and that product has at least one image, send the reply via `sendMedia` with the reply text as caption instead of `sendText`. Otherwise `sendText` exactly as before.

- [ ] **Step 1: Failing tests** (pure decision function `pickReplyMedia(productIdsSeen: string[], imagesByProduct: Record<string, string | undefined>): string | null` returns the mediaKey only for the exactly-one-product case), **Step 2: RED**, **Step 3: implement**, **Step 4: GREEN + full checks**, **Step 5: Commit**

```bash
git add -A && git commit -m "feat(shop): product photo replies and honest outbound media types"
```

---

### Task 11: Owner WhatsApp alerts through the policy engine

**Files:**
- Modify: `apps/api/src/services/notification-service.ts`
- Test: extend `apps/api/src/services/notification-service.test.ts`

**Interfaces:**
- Consumes: Task 7 `parseOrgShopSettings` + `OWNER_ALERT` policy action; `contactRepository.upsertByPhone`, `contactRepository.setOptedIn`, `conversationRepository.upsertForContact`, `channelRepository.list` (pick the first CONNECTED channel; skip silently when none), `outboundService.sendText`, `organizationRepository.findCurrent`.
- Produces: `notify()` additionally relays NEW_ORDER and LOW_STOCK (not HANDOFF) to the owner's WhatsApp when `parseOrgShopSettings(org.settings).ownerAlertsEnabled`: upsert the owner contact by `ownerAlertPhone` (name 'Owner alerts'), `setOptedIn` if not already, upsert a conversation on the CONNECTED channel, and `sendText({ authorType: 'SYSTEM', action: 'OWNER_ALERT', body: <short English one-liner: 'New order <id short>: <total> TZS' | 'Low stock: <name> (<qty> left)'> })`. Relay failures are caught and logged; the in-app notification NEVER fails because the relay did.

- [ ] **Step 1: Failing tests** (mocked deps): enabled+connected -> sendText called with action OWNER_ALERT; disabled or no phone -> no send; no CONNECTED channel -> no send, no throw; relay throw -> notify still resolves. **Step 2: RED**, **Step 3: implement**, **Step 4: GREEN + full checks**, **Step 5: Commit**

```bash
git add -A && git commit -m "feat(shop): owner whatsapp alerts for orders and low stock"
```

---

### Task 12: Integration test: the full order flow against a real database

**Files:**
- Create: `apps/api/src/shop.integration.test.ts`

**Interfaces:**
- Consumes: everything above; gated with `describe.skipIf(!process.env.INTEGRATION_DATABASE_URL)` exactly like `apps/api/src/webhook.integration.test.ts` (copy its setup/teardown idioms).

- [ ] **Step 1: Write the test**: one suite, real DB, mocked LLM and embeddings only:

```ts
// setup: create org (modules appointments+shop), owner, channel (CONNECTED), contact, conversation,
//        one product (price 10000, minPrice 8000, stockQty 3, lowStockThreshold 2)
// 1. agent flow: runAgentLoop with a scripted LLM that calls negotiate_price(7000) then, on the
//    isFinal counter of 8000, calls record_order([{quantity: 2, agreedPrice: 8000}]) and answers.
//    Assert: order exists PENDING_CONFIRMATION with totalAgreed 16000, snapshot name, NEW_ORDER notification row.
// 2. confirm: orderService.setStatus(CONFIRMED) -> product stockQty 1, LOW_STOCK notification row exists (3 -> 1 crossed threshold 2)
// 3. idempotent stock: setStatus(PAID) then (FULFILLED) leaves stockQty 1
// 4. floor safety net: orderService.createFromAgent with agreedPrice 7000 rejects even when called directly
// 5. tenant isolation: a second org sees zero products/orders/notifications from the first
```

- [ ] **Step 2: Run it for real**

Run: `INTEGRATION_DATABASE_URL=postgresql://waos:waos@localhost:5433/waos_dev pnpm -F @waos/api test -- shop.integration`
Expected: PASS. Also run the FULL integration suite once to catch regressions: `INTEGRATION_DATABASE_URL=postgresql://waos:waos@localhost:5433/waos_dev pnpm -F @waos/api test`.

- [ ] **Step 3: Commit**

```bash
git add -A && git commit -m "test(shop): end-to-end order flow integration coverage"
```

---

### Task 13: Docs sync (CLAUDE.md policy table, data model, flows)

**Files:**
- Modify: `CLAUDE.md` (sections 3.2 policy table, 7 data model, 8 flows)
- Modify: `README.md` (one paragraph: shop module exists behind the `shop` module flag)

**Interfaces:**
- Consumes: everything shipped above.
- Produces: docs that match the code.

- [ ] **Step 1: Edit CLAUDE.md**

- Section 3.2 table: add row `| Owner alert to opted-in owner | allow, rate limited | allow |` and note `OWNER_ALERT` in prose.
- Section 7: add Product/ProductImage/Order/OrderItem/Notification bullets with the key fields (snapshot semantics on OrderItem, floor semantics on Product.minPrice, `AiReplyLog.toolsUsed`).
- Section 8: add "AI selling" flow paragraph: tool loop, code-enforced floors, record_order -> PENDING_CONFIRMATION, stock on CONFIRMED, low-stock crossing notification.
- Do NOT touch protected rules (ban-risk, tenant, no em dashes, never-log, payments stay out).

- [ ] **Step 2: README**: extend the feature paragraph with the shop module one-liner. Run `pnpm format:check` on the two files, fix if needed.

- [ ] **Step 3: Commit**

```bash
git add CLAUDE.md README.md && git commit -m "docs: sync rulebook and readme with the shop backend"
```

---

## Final verification (whole plan)

- [ ] `pnpm typecheck && pnpm lint && pnpm test` green.
- [ ] `INTEGRATION_DATABASE_URL=postgresql://waos:waos@localhost:5433/waos_dev pnpm -F @waos/api test` green (all suites, including the new shop flow).
- [ ] Live smoke with `pnpm dev` + curl: demo org (shop module on) can create a product with an image, list it, and `GET /api/v1/orders` is empty but 200; `GET /api/v1/notifications` 200.
- [ ] With the connected WhatsApp (Edward's phone): text the business "do you sell hair oil? nipunguzie bei" and watch the agent search, hold the floor, and record an order end to end; confirm the order in the DB decrements stock. (Requires Edward; note as manual acceptance.)
- [ ] `git log --oneline` shows one conventional commit per task.
