# Sourcing Module Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A private supplier directory for importers: record the shops they buy from, the items each sells with the price as quoted abroad, and search every item across every supplier, with CSV import for both.

**Architecture:** Three new Prisma models (`Supplier`, `SourcedItem`, `SourcedItemImage`) behind a new `sourcing` business module, following the existing product stack layer for layer (repository to service to controller to route, tenant-scoped, `requireModule` gated). The web side reuses the component layer built for products: the desktop `Table` kit, `RowActions`, `SearchInput`, cards under `lg`, photo-at-creation, and the CSV template/import/report flow. Nothing here touches the AI: no tools, no embeddings, no prompt text.

**Tech Stack:** API: Express, TypeScript strict, Prisma, multer (existing), Zod, Vitest. Web: Next.js 15, React 19, Tailwind v4, next-intl, TanStack Query v5.

## Global Constraints

- **No AI access, ever.** No sourcing tool is added to the agent loop, no sourcing text enters a prompt or tool result, and neither model gets an `embedding` column. A test asserts the shop tool list contains no sourcing tool. (Spec section 6.)
- **Money as integers in minor units** plus an ISO-4217 currency code (45.50 CNY is `priceAmount: 4550`, `priceCurrency: 'CNY'`). No conversion, no rates, no payment processing. (Spec sections 3, 7.)
- **Tenancy:** every new model carries `organizationId`, is registered in `TENANT_MODELS`, and is reached only through the tenant-scoped `prisma` client. Registration keys are **PascalCase model names** (a camelCase key silently disables tenancy). (Spec section 6; CLAUDE.md section 13.)
- **Module gating:** all routes behind `requireAuth` + `requireModule('sourcing')`; nav entries and screens gated client-side the way `products`/`orders` are. (Spec sections 4, 5.)
- **Both locales complete:** every new string in `en` and `sw`; `pnpm lint` enforces key parity. (Spec section 7.)
- **No em dashes. TypeScript strict, no `any`. Conventional commits.** Services with logic get Vitest tests. (Spec section 7.)
- **Migration command** (repo gotcha): from `apps/api`, `pnpm exec dotenv -e ../../.env -- prisma migrate dev --name <name>`. Never edit a committed migration.
- **API gate:** `pnpm -F @waos/api typecheck && pnpm -F @waos/api test && pnpm lint`. **Web gate:** `pnpm -F @waos/web typecheck && pnpm lint && pnpm -F @waos/web build`. Run `tsc` explicitly.

---

## File Structure

**Task 1 (foundation):** `apps/api/prisma/schema.prisma` (+migration), `apps/api/src/lib/tenant.ts`, `packages/shared/src/schemas/modules.ts`, new `packages/shared/src/schemas/sourcing.ts` (+ barrel export in `packages/shared/src/index.ts`), `apps/web/src/components/shell/nav-model.ts`, `apps/web/src/app/[locale]/settings/page.tsx` (module toggle list), `apps/web/messages/{en,sw}.json` (nav + settings copy).

**Task 2 (suppliers):** `apps/api/src/repositories/supplier-repository.ts`, `apps/api/src/services/supplier-service.ts` (+test), `apps/api/src/controllers/supplier-controller.ts`, `apps/api/src/routes/suppliers.ts`, `apps/api/src/app.ts` (mount), `apps/web/src/lib/sourcing-api.ts`, `apps/web/src/lib/query-keys.ts`, `apps/web/src/app/[locale]/suppliers/page.tsx`, locales.

**Task 3 (items):** `apps/api/src/repositories/sourced-item-repository.ts`, `apps/api/src/services/sourced-item-service.ts` (+test), controller/route additions, `apps/web/src/app/[locale]/suppliers/[id]/page.tsx`, `sourcing-api.ts`, locales.

**Task 4 (global search):** repository search method, service, `GET /api/v1/sourced-items`, `apps/web/src/app/[locale]/sourcing/page.tsx`, locales.

**Task 5 (CSV import):** `apps/api/src/services/sourcing-import.ts` (+test), two routes, client functions, import UI on both screens, locales.

**Reference patterns (read before writing):** `apps/api/src/repositories/product-repository.ts` (repo shape), `apps/api/src/services/product-service.ts` (service + toDto), `apps/api/src/routes/products.ts` (router + multer), `apps/api/src/services/product-import.ts` (CSV import), `apps/web/src/app/[locale]/products/page.tsx` (table + search + kebab + photo-at-creation + import UI).

---

### Task 1: Data model, module, and shared schemas

**Files:**
- Modify: `apps/api/prisma/schema.prisma` (three models + Organization relations) and a new migration
- Modify: `apps/api/src/lib/tenant.ts` (`TENANT_MODELS`, `TENANT_RELATION_FIELDS`)
- Modify: `packages/shared/src/schemas/modules.ts`
- Create: `packages/shared/src/schemas/sourcing.ts`; Modify: `packages/shared/src/index.ts`
- Modify: `apps/web/src/components/shell/nav-model.ts`, `apps/web/src/app/[locale]/settings/page.tsx`
- Modify: `apps/web/messages/en.json`, `apps/web/messages/sw.json`
- Test: `apps/api/src/services/sourcing-no-ai.test.ts` (create)

**Interfaces:**
- Produces: Prisma models `Supplier`, `SourcedItem`, `SourcedItemImage`; `BusinessModule` now includes `'sourcing'`; from `@waos/shared`: `supplierSchema`, `SupplierDto`, `createSupplierRequestSchema`, `updateSupplierRequestSchema`, `sourcedItemSchema`, `SourcedItemDto`, `createSourcedItemRequestSchema`, `updateSourcedItemRequestSchema`, `sourcedItemSearchResultSchema`, `SourcedItemSearchResult`, `SOURCING_CURRENCIES`.

- [ ] **Step 1: Add the three Prisma models**

In `apps/api/prisma/schema.prisma`, add after the `ProductImage` model:
```prisma
/// A shop or dealer the business buys from (sourcing module). Private
/// cost intelligence: never exposed to customers or the AI.
model Supplier {
  id             String       @id @default(cuid())
  organizationId String
  organization   Organization @relation(fields: [organizationId], references: [id], onDelete: Cascade)

  name        String
  /// ISO-3166 alpha-2, uppercase (e.g. CN).
  country     String
  city        String?
  /// Market or building name, e.g. "Guangzhou Bag City".
  market      String?
  address     String?
  contactName String?
  contactPhone String?
  /// WeChat/WhatsApp handles and similar.
  contactNote String?
  notes       String?

  items SourcedItem[]

  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt

  @@index([organizationId])
}

/// A product found at a supplier, priced in the currency it was quoted in.
/// No embedding column by design: sourcing data must never be reachable
/// through the vector search the AI uses.
model SourcedItem {
  id             String       @id @default(cuid())
  organizationId String
  organization   Organization @relation(fields: [organizationId], references: [id], onDelete: Cascade)

  supplierId String
  supplier   Supplier @relation(fields: [supplierId], references: [id], onDelete: Cascade)

  name        String
  description String?
  /// Minor units of priceCurrency (45.50 CNY is 4550).
  priceAmount Int
  /// ISO-4217, uppercase (e.g. CNY).
  priceCurrency String
  /// Free text: "per piece", "per carton of 50".
  unit        String?
  /// Minimum order quantity.
  moq         Int?
  notes       String?

  images SourcedItemImage[]

  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt

  @@index([organizationId])
  @@index([supplierId])
}

/// Reference photo for a sourced item (MinIO object key). No AI-written
/// description: these are the owner's market photos, not sales material.
model SourcedItemImage {
  id             String       @id @default(cuid())
  organizationId String
  organization   Organization @relation(fields: [organizationId], references: [id], onDelete: Cascade)

  sourcedItemId String
  sourcedItem   SourcedItem @relation(fields: [sourcedItemId], references: [id], onDelete: Cascade)

  mediaKey String

  createdAt DateTime @default(now())

  @@index([organizationId])
  @@index([sourcedItemId])
}
```
In the `Organization` model, add the three back-relations alongside the existing ones (`products`, `orders`, etc.):
```prisma
  suppliers         Supplier[]
  sourcedItems      SourcedItem[]
  sourcedItemImages SourcedItemImage[]
```

- [ ] **Step 2: Create the migration**

From `apps/api`: `pnpm exec dotenv -e ../../.env -- prisma migrate dev --name sourcing_module`
Expected: a new migration creating the three tables with their FKs and indexes; `prisma generate` refreshes the client.

- [ ] **Step 3: Register the models with the tenant extension**

In `apps/api/src/lib/tenant.ts`, add to `TENANT_MODELS` (PascalCase, after `'Notification'`):
```ts
  'Supplier',
  'SourcedItem',
  'SourcedItemImage',
```
And to `TENANT_RELATION_FIELDS`:
```ts
  Supplier: ['organization', 'items'],
  SourcedItem: ['organization', 'supplier', 'images'],
  SourcedItemImage: ['organization', 'sourcedItem'],
```

- [ ] **Step 4: Add the module value**

In `packages/shared/src/schemas/modules.ts`:
```ts
export const businessModuleSchema = z.enum(['appointments', 'shop', 'sourcing']);
```

- [ ] **Step 5: Create the shared sourcing schemas**

Create `packages/shared/src/schemas/sourcing.ts`:
```ts
import { z } from 'zod';

/** Currencies an importer is likely to be quoted in. Stored uppercase. */
export const SOURCING_CURRENCIES = [
  'CNY',
  'USD',
  'TZS',
  'AED',
  'EUR',
  'TRY',
  'KES',
  'ZAR',
  'GBP',
  'INR',
] as const;
export const sourcingCurrencySchema = z.enum(SOURCING_CURRENCIES);

export const supplierSchema = z.object({
  id: z.string(),
  name: z.string(),
  country: z.string(),
  city: z.string().nullable(),
  market: z.string().nullable(),
  address: z.string().nullable(),
  contactName: z.string().nullable(),
  contactPhone: z.string().nullable(),
  contactNote: z.string().nullable(),
  notes: z.string().nullable(),
  itemCount: z.number().int(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type SupplierDto = z.infer<typeof supplierSchema>;

export const createSupplierRequestSchema = z.object({
  name: z.string().trim().min(2).max(160),
  country: z.string().trim().length(2).toUpperCase(),
  city: z.string().trim().max(120).optional(),
  market: z.string().trim().max(160).optional(),
  address: z.string().trim().max(300).optional(),
  contactName: z.string().trim().max(120).optional(),
  contactPhone: z.string().trim().max(40).optional(),
  contactNote: z.string().trim().max(200).optional(),
  notes: z.string().trim().max(2000).optional(),
});
export type CreateSupplierRequest = z.infer<typeof createSupplierRequestSchema>;

export const updateSupplierRequestSchema = createSupplierRequestSchema.partial();
export type UpdateSupplierRequest = z.infer<typeof updateSupplierRequestSchema>;

export const sourcedItemImageSchema = z.object({
  id: z.string(),
  mediaUrl: z.string().nullable(),
});

export const sourcedItemSchema = z.object({
  id: z.string(),
  supplierId: z.string(),
  name: z.string(),
  description: z.string().nullable(),
  /** Minor units of priceCurrency. */
  priceAmount: z.number().int(),
  priceCurrency: z.string(),
  unit: z.string().nullable(),
  moq: z.number().int().nullable(),
  notes: z.string().nullable(),
  images: z.array(sourcedItemImageSchema),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type SourcedItemDto = z.infer<typeof sourcedItemSchema>;

export const createSourcedItemRequestSchema = z.object({
  name: z.string().trim().min(2).max(160),
  description: z.string().trim().max(2000).optional(),
  priceAmount: z.number().int().min(1),
  priceCurrency: sourcingCurrencySchema,
  unit: z.string().trim().max(60).optional(),
  moq: z.number().int().min(1).optional(),
  notes: z.string().trim().max(2000).optional(),
});
export type CreateSourcedItemRequest = z.infer<typeof createSourcedItemRequestSchema>;

export const updateSourcedItemRequestSchema = createSourcedItemRequestSchema.partial();
export type UpdateSourcedItemRequest = z.infer<typeof updateSourcedItemRequestSchema>;

/** A global-search hit: the item plus where it came from. */
export const sourcedItemSearchResultSchema = sourcedItemSchema.extend({
  supplierName: z.string(),
  supplierCity: z.string().nullable(),
  supplierCountry: z.string(),
});
export type SourcedItemSearchResult = z.infer<typeof sourcedItemSearchResultSchema>;
```
In `packages/shared/src/index.ts`, add alongside the other schema exports:
```ts
export * from './schemas/sourcing.js';
```

- [ ] **Step 6: Add the nav entry**

In `apps/web/src/components/shell/nav-model.ts`: add `'sourcing'` to the `NavKey` union (after `'orders'`), import the `Boxes` icon from `lucide-react` alongside the others, and add the entry after the `orders` entry:
```ts
  { key: 'sourcing', href: '/sourcing', icon: Boxes, requiredModule: 'sourcing' },
```
(The mobile `primaryEntries` picker is unchanged: sourcing lands in the More sheet, which is correct for a secondary workflow.)

- [ ] **Step 7: Add the module to the settings toggle and the copy**

In `apps/web/src/app/[locale]/settings/page.tsx`, the modules list is hardcoded as `(['appointments', 'shop'] as const)`. Change it to:
```tsx
                {(['appointments', 'shop', 'sourcing'] as const).map((module) => (
```
In `apps/web/messages/en.json` add `"sourcing": "Sourcing"` inside the `nav` object and `"moduleSourcing": "Sourcing (suppliers you buy from)"` inside the `settings` object. In `sw.json` add `"sourcing": "Ununuzi"` and `"moduleSourcing": "Ununuzi (wauzaji unaonunua kwao)"`.
Check how the settings screen labels the other modules (it renders `t(...)` per module key); match that existing key naming exactly so the new module's label resolves the same way. If the existing pattern is `t(\`module${Capitalized}\`)`, the keys above already fit.

- [ ] **Step 8: Write the no-AI-access test**

Create `apps/api/src/services/sourcing-no-ai.test.ts`:
```ts
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

/**
 * The sourcing module records what the owner PAYS for goods. That is the
 * most commercially sensitive data in the system, so it must never reach
 * the customer-facing AI. These tests pin the two structural guarantees.
 */
describe('sourcing data never reaches the AI', () => {
  it('registers no sourcing tool with the agent loop', () => {
    const shopTools = readFileSync('src/services/shop-tools.ts', 'utf8');
    expect(shopTools).not.toMatch(/supplier/i);
    expect(shopTools).not.toMatch(/sourcedItem/i);
  });

  it('gives neither sourcing model an embedding column', () => {
    const schema = readFileSync('prisma/schema.prisma', 'utf8');
    const sourcedItem = schema.slice(
      schema.indexOf('model SourcedItem '),
      schema.indexOf('model SourcedItemImage '),
    );
    expect(sourcedItem).not.toMatch(/embedding/);
    const supplier = schema.slice(
      schema.indexOf('model Supplier '),
      schema.indexOf('model SourcedItem '),
    );
    expect(supplier).not.toMatch(/embedding/);
  });
});
```

- [ ] **Step 9: Run both gates and commit**

Run: `pnpm -F @waos/api typecheck && pnpm -F @waos/api test && pnpm lint`
Run: `pnpm -F @waos/web typecheck && pnpm -F @waos/web build`
Expected: all clean; the two new tests pass; parity holds (2 new keys per locale).
```bash
git add apps/api/prisma apps/api/src/lib/tenant.ts apps/api/src/services/sourcing-no-ai.test.ts packages/shared/src apps/web/src/components/shell/nav-model.ts "apps/web/src/app/[locale]/settings/page.tsx" apps/web/messages
git commit -m "feat(sourcing): add supplier data model, module, and shared schemas"
```

---

### Task 2: Suppliers CRUD and list screen

**Files:**
- Create: `apps/api/src/repositories/supplier-repository.ts`, `apps/api/src/services/supplier-service.ts`, `apps/api/src/controllers/supplier-controller.ts`, `apps/api/src/routes/suppliers.ts`
- Test: `apps/api/src/services/supplier-service.test.ts` (create)
- Modify: `apps/api/src/app.ts` (mount), `apps/web/src/lib/query-keys.ts`
- Create: `apps/web/src/lib/sourcing-api.ts`, `apps/web/src/app/[locale]/suppliers/page.tsx`
- Modify: `apps/web/messages/en.json`, `apps/web/messages/sw.json`

**Interfaces:**
- Consumes: Task 1's schemas and models.
- Produces: `supplierRepository` (`create`, `findById`, `list`, `update`, `remove`), `supplierService` (`create`, `list`, `update`, `remove`, `toDto`), routes `GET|POST /api/v1/suppliers` and `PATCH|DELETE /api/v1/suppliers/:id`; web `listSuppliers()`, `createSupplier(input)`, `updateSupplier(id, input)`, `deleteSupplier(id)`; `queryKeys.suppliers` / `queryKeys.suppliersRoot`.

- [ ] **Step 1: Write the failing service test**

Create `apps/api/src/services/supplier-service.test.ts` (mock the repository with the `vi.hoisted` + `vi.mock` pattern used by `notification-service.test.ts`):
```ts
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { repo } = vi.hoisted(() => ({
  repo: {
    create: vi.fn(),
    findById: vi.fn(),
    list: vi.fn(),
    update: vi.fn(),
    remove: vi.fn(),
  },
}));
vi.mock('../repositories/supplier-repository.js', () => ({ supplierRepository: repo }));

import { supplierService } from './supplier-service.js';

const row = {
  id: 's1',
  name: 'Guangzhou Bag City',
  country: 'CN',
  city: 'Guangzhou',
  market: 'Bag City',
  address: null,
  contactName: 'Lin',
  contactPhone: '+8613800000000',
  contactNote: 'WeChat: lin_bags',
  notes: null,
  createdAt: new Date('2026-08-01T00:00:00Z'),
  updatedAt: new Date('2026-08-01T00:00:00Z'),
  _count: { items: 3 },
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe('supplierService', () => {
  it('maps a row to a DTO with the item count and ISO date strings', async () => {
    repo.list.mockResolvedValue([row]);
    const [dto] = await supplierService.list();
    expect(dto).toEqual({
      id: 's1',
      name: 'Guangzhou Bag City',
      country: 'CN',
      city: 'Guangzhou',
      market: 'Bag City',
      address: null,
      contactName: 'Lin',
      contactPhone: '+8613800000000',
      contactNote: 'WeChat: lin_bags',
      notes: null,
      itemCount: 3,
      createdAt: '2026-08-01T00:00:00.000Z',
      updatedAt: '2026-08-01T00:00:00.000Z',
    });
  });

  it('rejects an update for a supplier that does not exist', async () => {
    repo.findById.mockResolvedValue(null);
    await expect(supplierService.update('missing', { name: 'x' })).rejects.toThrow();
    expect(repo.update).not.toHaveBeenCalled();
  });

  it('rejects a delete for a supplier that does not exist', async () => {
    repo.findById.mockResolvedValue(null);
    await expect(supplierService.remove('missing')).rejects.toThrow();
    expect(repo.remove).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run it to verify failure**

Run: `pnpm -F @waos/api test -- supplier-service`
Expected: FAIL (module does not exist).

- [ ] **Step 3: Write the repository**

Create `apps/api/src/repositories/supplier-repository.ts`:
```ts
import type { Prisma, Supplier } from '@prisma/client';
import { requireRequestContext } from '../lib/context.js';
import { prisma } from '../lib/prisma.js';

export type SupplierWithCount = Supplier & { _count: { items: number } };

export interface CreateSupplierData {
  name: string;
  country: string;
  city?: string;
  market?: string;
  address?: string;
  contactName?: string;
  contactPhone?: string;
  contactNote?: string;
  notes?: string;
}

const withCount = { _count: { select: { items: true } } } satisfies Prisma.SupplierInclude;

export const supplierRepository = {
  create(data: CreateSupplierData): Promise<SupplierWithCount> {
    return prisma.supplier.create({
      data: {
        name: data.name,
        country: data.country,
        city: data.city ?? null,
        market: data.market ?? null,
        address: data.address ?? null,
        contactName: data.contactName ?? null,
        contactPhone: data.contactPhone ?? null,
        contactNote: data.contactNote ?? null,
        notes: data.notes ?? null,
        organizationId: requireRequestContext().organizationId,
      },
      include: withCount,
    });
  },

  findById(id: string): Promise<SupplierWithCount | null> {
    return prisma.supplier.findUnique({ where: { id }, include: withCount });
  },

  list(): Promise<SupplierWithCount[]> {
    return prisma.supplier.findMany({ include: withCount, orderBy: { createdAt: 'desc' } });
  },

  update(id: string, data: Partial<CreateSupplierData>): Promise<SupplierWithCount> {
    return prisma.supplier.update({ where: { id }, data, include: withCount });
  },

  async remove(id: string): Promise<void> {
    await prisma.supplier.delete({ where: { id } });
  },
};
```

- [ ] **Step 4: Write the service**

Create `apps/api/src/services/supplier-service.ts`:
```ts
import type { CreateSupplierRequest, SupplierDto, UpdateSupplierRequest } from '@waos/shared';
import { NotFoundError } from '../lib/errors.js';
import {
  supplierRepository,
  type SupplierWithCount,
} from '../repositories/supplier-repository.js';

export const supplierService = {
  toDto(supplier: SupplierWithCount): SupplierDto {
    return {
      id: supplier.id,
      name: supplier.name,
      country: supplier.country,
      city: supplier.city,
      market: supplier.market,
      address: supplier.address,
      contactName: supplier.contactName,
      contactPhone: supplier.contactPhone,
      contactNote: supplier.contactNote,
      notes: supplier.notes,
      itemCount: supplier._count.items,
      createdAt: supplier.createdAt.toISOString(),
      updatedAt: supplier.updatedAt.toISOString(),
    };
  },

  async create(input: CreateSupplierRequest): Promise<SupplierDto> {
    return this.toDto(await supplierRepository.create(input));
  },

  async list(): Promise<SupplierDto[]> {
    const rows = await supplierRepository.list();
    return rows.map((row) => this.toDto(row));
  },

  async findById(id: string): Promise<SupplierDto> {
    const supplier = await supplierRepository.findById(id);
    if (!supplier) {
      throw new NotFoundError('This supplier no longer exists.');
    }
    return this.toDto(supplier);
  },

  async update(id: string, input: UpdateSupplierRequest): Promise<SupplierDto> {
    const existing = await supplierRepository.findById(id);
    if (!existing) {
      throw new NotFoundError('This supplier no longer exists.');
    }
    return this.toDto(await supplierRepository.update(id, input));
  },

  async remove(id: string): Promise<void> {
    const existing = await supplierRepository.findById(id);
    if (!existing) {
      throw new NotFoundError('This supplier no longer exists.');
    }
    await supplierRepository.remove(id);
  },
};
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `pnpm -F @waos/api test -- supplier-service`
Expected: PASS (3 tests).

- [ ] **Step 6: Controller and routes**

Create `apps/api/src/controllers/supplier-controller.ts`:
```ts
import type { Request, Response } from 'express';
import { createSupplierRequestSchema, updateSupplierRequestSchema } from '@waos/shared';
import { routeParam } from '../lib/http.js';
import { supplierService } from '../services/supplier-service.js';

export const create = async (req: Request, res: Response): Promise<void> => {
  const input = createSupplierRequestSchema.parse(req.body);
  const supplier = await supplierService.create(input);
  res.status(201).json({ supplier });
};

export const list = async (_req: Request, res: Response): Promise<void> => {
  const suppliers = await supplierService.list();
  res.json({ suppliers });
};

export const update = async (req: Request, res: Response): Promise<void> => {
  const input = updateSupplierRequestSchema.parse(req.body);
  const supplier = await supplierService.update(routeParam(req.params.id), input);
  res.json({ supplier });
};

export const remove = async (req: Request, res: Response): Promise<void> => {
  await supplierService.remove(routeParam(req.params.id));
  res.json({ ok: true });
};
```
Create `apps/api/src/routes/suppliers.ts`:
```ts
import { Router } from 'express';
import * as supplierController from '../controllers/supplier-controller.js';
import { requireAuth } from '../middleware/auth.js';
import { requireModule } from '../middleware/require-module.js';

export const supplierRoutes: Router = Router();

supplierRoutes.use(requireAuth);
supplierRoutes.use(requireModule('sourcing'));
supplierRoutes.post('/', supplierController.create);
supplierRoutes.get('/', supplierController.list);
supplierRoutes.patch('/:id', supplierController.update);
supplierRoutes.delete('/:id', supplierController.remove);
```
In `apps/api/src/app.ts`, import `supplierRoutes` alongside the other route imports and mount it next to the products mount:
```ts
  app.use('/api/v1/suppliers', supplierRoutes);
```

- [ ] **Step 7: Web client and query keys**

In `apps/web/src/lib/query-keys.ts` add:
```ts
  suppliers: ['suppliers'] as const,
  suppliersRoot: ['suppliers'] as const,
```
Create `apps/web/src/lib/sourcing-api.ts`:
```ts
import { z } from 'zod';
import {
  supplierSchema,
  type CreateSupplierRequest,
  type SupplierDto,
  type UpdateSupplierRequest,
} from '@waos/shared';
import { apiFetch } from './api';

export async function listSuppliers(): Promise<SupplierDto[]> {
  const raw = await apiFetch<unknown>('/api/v1/suppliers');
  return z.array(supplierSchema).parse((raw as { suppliers: unknown }).suppliers);
}

export async function createSupplier(input: CreateSupplierRequest): Promise<SupplierDto> {
  const raw = await apiFetch<unknown>('/api/v1/suppliers', { method: 'POST', body: input });
  return supplierSchema.parse((raw as { supplier: unknown }).supplier);
}

export async function updateSupplier(
  id: string,
  input: UpdateSupplierRequest,
): Promise<SupplierDto> {
  const raw = await apiFetch<unknown>(`/api/v1/suppliers/${id}`, { method: 'PATCH', body: input });
  return supplierSchema.parse((raw as { supplier: unknown }).supplier);
}

export async function deleteSupplier(id: string): Promise<void> {
  await apiFetch(`/api/v1/suppliers/${id}`, { method: 'DELETE' });
}
```

- [ ] **Step 8: Add the suppliers copy to both locales**

In `apps/web/messages/en.json`, add a new top-level `suppliers` object:
```json
  "suppliers": {
    "title": "Suppliers",
    "addTitle": "Add a supplier",
    "editTitle": "Edit supplier",
    "name": "Shop or dealer name",
    "country": "Country code",
    "countryHint": "Two letters, e.g. CN for China.",
    "city": "City",
    "market": "Market or building",
    "address": "Address",
    "contactName": "Contact person",
    "contactPhone": "Phone",
    "contactNote": "Other contact",
    "contactNoteHint": "WeChat, WhatsApp, or anything else you use.",
    "notes": "Notes",
    "notesHint": "Stall number, opening days, who to ask for.",
    "save": "Save supplier",
    "saving": "Saving...",
    "cancelEdit": "Cancel",
    "edit": "Edit",
    "viewItems": "View items",
    "delete": "Delete",
    "deleteConfirm": "Delete this supplier and everything recorded from it?",
    "searchPlaceholder": "Search by name, city, or market",
    "colSupplier": "Supplier",
    "colLocation": "Location",
    "colMarket": "Market",
    "colItems": "Items",
    "colActions": "Actions",
    "itemCount": "{count} items",
    "emptyTitle": "No suppliers yet.",
    "emptyHint": "Add the shops you buy from, then record what they sell.",
    "noResultsTitle": "No suppliers match your search.",
    "noResultsHint": "Try a different name, city, or market.",
    "loadError": "Could not load suppliers. Check your connection.",
    "saveError": "Could not save. Try again.",
    "retry": "Try again",
    "invalidCountry": "Use a two-letter country code, e.g. CN."
  },
```
In `apps/web/messages/sw.json`, the same keys with Swahili values:
```json
  "suppliers": {
    "title": "Wauzaji",
    "addTitle": "Ongeza muuzaji",
    "editTitle": "Hariri muuzaji",
    "name": "Jina la duka au muuzaji",
    "country": "Msimbo wa nchi",
    "countryHint": "Herufi mbili, mfano CN kwa China.",
    "city": "Jiji",
    "market": "Soko au jengo",
    "address": "Anwani",
    "contactName": "Mtu wa mawasiliano",
    "contactPhone": "Simu",
    "contactNote": "Mawasiliano mengine",
    "contactNoteHint": "WeChat, WhatsApp, au kingine unachotumia.",
    "notes": "Maelezo",
    "notesHint": "Namba ya kibanda, siku za kufungua, wa kumuuliza.",
    "save": "Hifadhi muuzaji",
    "saving": "Inahifadhi...",
    "cancelEdit": "Ghairi",
    "edit": "Hariri",
    "viewItems": "Ona bidhaa",
    "delete": "Futa",
    "deleteConfirm": "Futa muuzaji huyu na kila kitu kilichorekodiwa kwake?",
    "searchPlaceholder": "Tafuta kwa jina, jiji, au soko",
    "colSupplier": "Muuzaji",
    "colLocation": "Mahali",
    "colMarket": "Soko",
    "colItems": "Bidhaa",
    "colActions": "Vitendo",
    "itemCount": "Bidhaa {count}",
    "emptyTitle": "Hakuna wauzaji bado.",
    "emptyHint": "Ongeza maduka unayonunua, kisha rekodi wanachouza.",
    "noResultsTitle": "Hakuna muuzaji anayelingana na utafutaji wako.",
    "noResultsHint": "Jaribu jina, jiji, au soko lingine.",
    "loadError": "Imeshindwa kupakia wauzaji. Angalia muunganisho wako.",
    "saveError": "Imeshindwa kuhifadhi. Jaribu tena.",
    "retry": "Jaribu tena",
    "invalidCountry": "Tumia msimbo wa nchi wa herufi mbili, mfano CN."
  },
```

- [ ] **Step 9: Build the suppliers list screen**

Create `apps/web/src/app/[locale]/suppliers/page.tsx` modelled on `apps/web/src/app/[locale]/products/page.tsx`. Read that file first and mirror its structure exactly:
- `'use client'`; module guard: `const sourcingOrg = (getStoredUser()?.organization.modules ?? []).includes('sourcing');` with the same `useEffect` redirect to `/home` and `if (!sourcingOrg) return null;`.
- `useQuery({ queryKey: queryKeys.suppliers, queryFn: listSuppliers })`.
- An add/edit `Card` form above the list with `Field` + `Input` for name, country, city, market, address, contactName, contactPhone, contactNote, and a `textarea` for notes (same classes the products form uses for its description textarea). Submit calls `createSupplier` or `updateSupplier`, then `queryClient.invalidateQueries({ queryKey: queryKeys.suppliersRoot })`. Client-side check: country must match `/^[A-Za-z]{2}$/`, else `setFormError(t('invalidCountry'))`.
- `SearchInput` filtering on name, city, and market (case-insensitive), producing one `filtered` array used by BOTH renders.
- Desktop `Table` (columns: supplier name, location as `city, country`, market, `t('itemCount', { count })`, kebab) with `RowActions` offering edit, view items (`router.push(\`/suppliers/${supplier.id}\`)`), and delete (danger, `window.confirm(t('deleteConfirm'))`).
- Mobile cards (`lg:hidden`) showing the same fields with the same actions as buttons.
- Empty states: `noResultsTitle/noResultsHint` when `filtered.length === 0 && suppliers.length > 0`, else `emptyTitle/emptyHint`.
- `<AppShell title={t('title')}>` wrapper.

- [ ] **Step 10: Run both gates and commit**

Run: `pnpm -F @waos/api typecheck && pnpm -F @waos/api test && pnpm lint`
Run: `pnpm -F @waos/web typecheck && pnpm -F @waos/web build`
```bash
git add apps/api/src/repositories/supplier-repository.ts apps/api/src/services/supplier-service.ts apps/api/src/services/supplier-service.test.ts apps/api/src/controllers/supplier-controller.ts apps/api/src/routes/suppliers.ts apps/api/src/app.ts apps/web/src/lib/sourcing-api.ts apps/web/src/lib/query-keys.ts "apps/web/src/app/[locale]/suppliers/page.tsx" apps/web/messages
git commit -m "feat(sourcing): suppliers CRUD and list screen"
```

---

### Task 3: Sourced items, photos, and the supplier detail screen

**Files:**
- Create: `apps/api/src/repositories/sourced-item-repository.ts`, `apps/api/src/services/sourced-item-service.ts`
- Test: `apps/api/src/services/sourced-item-service.test.ts` (create)
- Modify: `apps/api/src/controllers/supplier-controller.ts`, `apps/api/src/routes/suppliers.ts`
- Modify: `apps/web/src/lib/sourcing-api.ts`, `apps/web/src/lib/query-keys.ts`
- Create: `apps/web/src/app/[locale]/suppliers/[id]/page.tsx`
- Modify: `apps/web/messages/en.json`, `apps/web/messages/sw.json`

**Interfaces:**
- Consumes: Task 1 schemas; Task 2's `supplierRepository`/`supplierService`, router, and `sourcing-api.ts`.
- Produces: `sourcedItemRepository` (`create`, `findById`, `listBySupplier`, `update`, `remove`, `addImage`, `removeImage`), `sourcedItemService` (same surface plus `toDto`), routes `GET|POST /api/v1/suppliers/:supplierId/items`, `PATCH|DELETE /api/v1/suppliers/:supplierId/items/:itemId`, `POST /api/v1/suppliers/:supplierId/items/:itemId/images`, `DELETE /api/v1/suppliers/:supplierId/items/:itemId/images/:imageId`; web `listSourcedItems(supplierId)`, `createSourcedItem(supplierId, input)`, `updateSourcedItem(supplierId, itemId, input)`, `deleteSourcedItem(supplierId, itemId)`, `uploadSourcedItemImage(supplierId, itemId, file)`, `removeSourcedItemImage(supplierId, itemId, imageId)`; `queryKeys.sourcedItems(supplierId)`.

- [ ] **Step 1: Write the failing service test**

Create `apps/api/src/services/sourced-item-service.test.ts`:
```ts
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { repo, supplierRepo, getMediaUrl } = vi.hoisted(() => ({
  repo: {
    create: vi.fn(),
    findById: vi.fn(),
    listBySupplier: vi.fn(),
    update: vi.fn(),
    remove: vi.fn(),
    addImage: vi.fn(),
    removeImage: vi.fn(),
  },
  supplierRepo: { findById: vi.fn() },
  getMediaUrl: vi.fn((key: string) => Promise.resolve(`https://cdn.example/${key}`)),
}));
vi.mock('../repositories/sourced-item-repository.js', () => ({ sourcedItemRepository: repo }));
vi.mock('../repositories/supplier-repository.js', () => ({ supplierRepository: supplierRepo }));
vi.mock('../lib/minio.js', () => ({ getMediaUrl, putMediaObject: vi.fn() }));

import { sourcedItemService } from './sourced-item-service.js';

const row = {
  id: 'i1',
  supplierId: 's1',
  name: 'Leather handbag',
  description: null,
  priceAmount: 4550,
  priceCurrency: 'CNY',
  unit: 'per piece',
  moq: 50,
  notes: null,
  images: [{ id: 'img1', mediaKey: 'org/sourcing/img1.jpg' }],
  createdAt: new Date('2026-08-01T00:00:00Z'),
  updatedAt: new Date('2026-08-01T00:00:00Z'),
};

beforeEach(() => {
  vi.clearAllMocks();
  supplierRepo.findById.mockResolvedValue({ id: 's1' });
});

describe('sourcedItemService', () => {
  it('maps a row to a DTO with presigned image urls and never exposes mediaKey', async () => {
    repo.listBySupplier.mockResolvedValue([row]);
    const [dto] = await sourcedItemService.listBySupplier('s1');
    expect(dto).toEqual({
      id: 'i1',
      supplierId: 's1',
      name: 'Leather handbag',
      description: null,
      priceAmount: 4550,
      priceCurrency: 'CNY',
      unit: 'per piece',
      moq: 50,
      notes: null,
      images: [{ id: 'img1', mediaUrl: 'https://cdn.example/org/sourcing/img1.jpg' }],
      createdAt: '2026-08-01T00:00:00.000Z',
      updatedAt: '2026-08-01T00:00:00.000Z',
    });
    expect(JSON.stringify(dto)).not.toContain('mediaKey');
  });

  it('refuses to create an item for a supplier that does not exist', async () => {
    supplierRepo.findById.mockResolvedValue(null);
    await expect(
      sourcedItemService.create('missing', {
        name: 'x',
        priceAmount: 100,
        priceCurrency: 'CNY',
      }),
    ).rejects.toThrow();
    expect(repo.create).not.toHaveBeenCalled();
  });

  it('refuses to update an item that belongs to a different supplier', async () => {
    repo.findById.mockResolvedValue({ ...row, supplierId: 'other' });
    await expect(sourcedItemService.update('s1', 'i1', { name: 'x' })).rejects.toThrow();
    expect(repo.update).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run it to verify failure**

Run: `pnpm -F @waos/api test -- sourced-item-service`
Expected: FAIL (module does not exist).

- [ ] **Step 3: Write the repository**

Create `apps/api/src/repositories/sourced-item-repository.ts`:
```ts
import type { Prisma, SourcedItem, SourcedItemImage } from '@prisma/client';
import { requireRequestContext } from '../lib/context.js';
import { prisma } from '../lib/prisma.js';

export type SourcedItemWithImages = SourcedItem & { images: SourcedItemImage[] };

export interface CreateSourcedItemData {
  supplierId: string;
  name: string;
  description?: string;
  priceAmount: number;
  priceCurrency: string;
  unit?: string;
  moq?: number;
  notes?: string;
}

const withImages = {
  images: { orderBy: { createdAt: 'asc' } },
} satisfies Prisma.SourcedItemInclude;

export const sourcedItemRepository = {
  create(data: CreateSourcedItemData): Promise<SourcedItemWithImages> {
    return prisma.sourcedItem.create({
      data: {
        supplierId: data.supplierId,
        name: data.name,
        description: data.description ?? null,
        priceAmount: data.priceAmount,
        priceCurrency: data.priceCurrency,
        unit: data.unit ?? null,
        moq: data.moq ?? null,
        notes: data.notes ?? null,
        organizationId: requireRequestContext().organizationId,
      },
      include: withImages,
    });
  },

  findById(id: string): Promise<SourcedItemWithImages | null> {
    return prisma.sourcedItem.findUnique({ where: { id }, include: withImages });
  },

  listBySupplier(supplierId: string): Promise<SourcedItemWithImages[]> {
    return prisma.sourcedItem.findMany({
      where: { supplierId },
      include: withImages,
      orderBy: { createdAt: 'desc' },
    });
  },

  update(
    id: string,
    data: Partial<Omit<CreateSourcedItemData, 'supplierId'>>,
  ): Promise<SourcedItemWithImages> {
    return prisma.sourcedItem.update({ where: { id }, data, include: withImages });
  },

  async remove(id: string): Promise<void> {
    await prisma.sourcedItem.delete({ where: { id } });
  },

  async addImage(sourcedItemId: string, mediaKey: string): Promise<void> {
    await prisma.sourcedItemImage.create({
      data: {
        sourcedItemId,
        mediaKey,
        organizationId: requireRequestContext().organizationId,
      },
    });
  },

  async removeImage(sourcedItemId: string, imageId: string): Promise<void> {
    // The id pair keeps a caller from deleting an image of another item.
    await prisma.sourcedItemImage.deleteMany({ where: { id: imageId, sourcedItemId } });
  },
};
```

- [ ] **Step 4: Write the service**

Create `apps/api/src/services/sourced-item-service.ts`:
```ts
import type {
  CreateSourcedItemRequest,
  SourcedItemDto,
  UpdateSourcedItemRequest,
} from '@waos/shared';
import { NotFoundError } from '../lib/errors.js';
import { getMediaUrl, putMediaObject } from '../lib/minio.js';
import { requireRequestContext } from '../lib/context.js';
import {
  sourcedItemRepository,
  type SourcedItemWithImages,
} from '../repositories/sourced-item-repository.js';
import { supplierRepository } from '../repositories/supplier-repository.js';

async function assertSupplier(supplierId: string): Promise<void> {
  const supplier = await supplierRepository.findById(supplierId);
  if (!supplier) {
    throw new NotFoundError('This supplier no longer exists.');
  }
}

async function loadOwned(supplierId: string, itemId: string): Promise<SourcedItemWithImages> {
  const item = await sourcedItemRepository.findById(itemId);
  if (!item || item.supplierId !== supplierId) {
    throw new NotFoundError('This item no longer exists.');
  }
  return item;
}

export const sourcedItemService = {
  async toDto(item: SourcedItemWithImages): Promise<SourcedItemDto> {
    return {
      id: item.id,
      supplierId: item.supplierId,
      name: item.name,
      description: item.description,
      priceAmount: item.priceAmount,
      priceCurrency: item.priceCurrency,
      unit: item.unit,
      moq: item.moq,
      notes: item.notes,
      images: await Promise.all(
        item.images.map(async (image) => ({
          id: image.id,
          mediaUrl: await getMediaUrl(image.mediaKey),
        })),
      ),
      createdAt: item.createdAt.toISOString(),
      updatedAt: item.updatedAt.toISOString(),
    };
  },

  async create(supplierId: string, input: CreateSourcedItemRequest): Promise<SourcedItemDto> {
    await assertSupplier(supplierId);
    const item = await sourcedItemRepository.create({ ...input, supplierId });
    return this.toDto(item);
  },

  async listBySupplier(supplierId: string): Promise<SourcedItemDto[]> {
    await assertSupplier(supplierId);
    const rows = await sourcedItemRepository.listBySupplier(supplierId);
    return Promise.all(rows.map((row) => this.toDto(row)));
  },

  async update(
    supplierId: string,
    itemId: string,
    input: UpdateSourcedItemRequest,
  ): Promise<SourcedItemDto> {
    await loadOwned(supplierId, itemId);
    return this.toDto(await sourcedItemRepository.update(itemId, input));
  },

  async remove(supplierId: string, itemId: string): Promise<void> {
    await loadOwned(supplierId, itemId);
    await sourcedItemRepository.remove(itemId);
  },

  async addImage(
    supplierId: string,
    itemId: string,
    file: { buffer: Buffer; mimeType: string },
  ): Promise<SourcedItemDto> {
    await loadOwned(supplierId, itemId);
    const key = `${requireRequestContext().organizationId}/sourcing/${itemId}/${Date.now()}`;
    const mediaKey = await putMediaObject(key, file.buffer, file.mimeType);
    await sourcedItemRepository.addImage(itemId, mediaKey);
    return this.toDto(await loadOwned(supplierId, itemId));
  },

  async removeImage(supplierId: string, itemId: string, imageId: string): Promise<SourcedItemDto> {
    await loadOwned(supplierId, itemId);
    await sourcedItemRepository.removeImage(itemId, imageId);
    return this.toDto(await loadOwned(supplierId, itemId));
  },
};
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `pnpm -F @waos/api test -- sourced-item-service`
Expected: PASS (3 tests).

- [ ] **Step 6: Controller and route additions**

In `apps/api/src/controllers/supplier-controller.ts`, add (importing `createSourcedItemRequestSchema`, `updateSourcedItemRequestSchema` from `@waos/shared`, `ValidationError` from `../lib/errors.js`, and `sourcedItemService`):
```ts
export const listItems = async (req: Request, res: Response): Promise<void> => {
  const items = await sourcedItemService.listBySupplier(routeParam(req.params.supplierId));
  res.json({ items });
};

export const createItem = async (req: Request, res: Response): Promise<void> => {
  const input = createSourcedItemRequestSchema.parse(req.body);
  const item = await sourcedItemService.create(routeParam(req.params.supplierId), input);
  res.status(201).json({ item });
};

export const updateItem = async (req: Request, res: Response): Promise<void> => {
  const input = updateSourcedItemRequestSchema.parse(req.body);
  const item = await sourcedItemService.update(
    routeParam(req.params.supplierId),
    routeParam(req.params.itemId),
    input,
  );
  res.json({ item });
};

export const removeItem = async (req: Request, res: Response): Promise<void> => {
  await sourcedItemService.remove(routeParam(req.params.supplierId), routeParam(req.params.itemId));
  res.json({ ok: true });
};

export const addItemImage = async (req: Request, res: Response): Promise<void> => {
  const file = req.file;
  if (!file) {
    throw new ValidationError('Attach an image file.');
  }
  const item = await sourcedItemService.addImage(
    routeParam(req.params.supplierId),
    routeParam(req.params.itemId),
    { buffer: file.buffer, mimeType: file.mimetype },
  );
  res.json({ item });
};

export const removeItemImage = async (req: Request, res: Response): Promise<void> => {
  const item = await sourcedItemService.removeImage(
    routeParam(req.params.supplierId),
    routeParam(req.params.itemId),
    routeParam(req.params.imageId),
  );
  res.json({ item });
};
```
In `apps/api/src/routes/suppliers.ts`, add the multer instance (copy the image filter from `apps/api/src/routes/products.ts`: memory storage, 5MB, `file.mimetype.startsWith('image/')` else `ValidationError('Attach an image file.')`) and the routes:
```ts
supplierRoutes.get('/:supplierId/items', supplierController.listItems);
supplierRoutes.post('/:supplierId/items', supplierController.createItem);
supplierRoutes.patch('/:supplierId/items/:itemId', supplierController.updateItem);
supplierRoutes.delete('/:supplierId/items/:itemId', supplierController.removeItem);
supplierRoutes.post(
  '/:supplierId/items/:itemId/images',
  upload.single('file'),
  supplierController.addItemImage,
);
supplierRoutes.delete(
  '/:supplierId/items/:itemId/images/:imageId',
  supplierController.removeItemImage,
);
```

- [ ] **Step 7: Web client additions**

In `apps/web/src/lib/query-keys.ts`:
```ts
  sourcedItems: (supplierId: string) => ['sourced-items', supplierId] as const,
  sourcedItemsRoot: ['sourced-items'] as const,
```
In `apps/web/src/lib/sourcing-api.ts` add (importing `sourcedItemSchema` and the item request types, plus `apiUpload` from `./api`):
```ts
export async function listSourcedItems(supplierId: string): Promise<SourcedItemDto[]> {
  const raw = await apiFetch<unknown>(`/api/v1/suppliers/${supplierId}/items`);
  return z.array(sourcedItemSchema).parse((raw as { items: unknown }).items);
}

export async function createSourcedItem(
  supplierId: string,
  input: CreateSourcedItemRequest,
): Promise<SourcedItemDto> {
  const raw = await apiFetch<unknown>(`/api/v1/suppliers/${supplierId}/items`, {
    method: 'POST',
    body: input,
  });
  return sourcedItemSchema.parse((raw as { item: unknown }).item);
}

export async function updateSourcedItem(
  supplierId: string,
  itemId: string,
  input: UpdateSourcedItemRequest,
): Promise<SourcedItemDto> {
  const raw = await apiFetch<unknown>(`/api/v1/suppliers/${supplierId}/items/${itemId}`, {
    method: 'PATCH',
    body: input,
  });
  return sourcedItemSchema.parse((raw as { item: unknown }).item);
}

export async function deleteSourcedItem(supplierId: string, itemId: string): Promise<void> {
  await apiFetch(`/api/v1/suppliers/${supplierId}/items/${itemId}`, { method: 'DELETE' });
}

export async function uploadSourcedItemImage(
  supplierId: string,
  itemId: string,
  file: File,
): Promise<SourcedItemDto> {
  const formData = new FormData();
  formData.append('file', file);
  const raw = await apiUpload<unknown>(
    `/api/v1/suppliers/${supplierId}/items/${itemId}/images`,
    formData,
  );
  return sourcedItemSchema.parse((raw as { item: unknown }).item);
}

export async function removeSourcedItemImage(
  supplierId: string,
  itemId: string,
  imageId: string,
): Promise<SourcedItemDto> {
  const raw = await apiFetch<unknown>(
    `/api/v1/suppliers/${supplierId}/items/${itemId}/images/${imageId}`,
    { method: 'DELETE' },
  );
  return sourcedItemSchema.parse((raw as { item: unknown }).item);
}
```

- [ ] **Step 8: Add the items copy to both locales**

In `apps/web/messages/en.json`, add a top-level `sourcedItems` object:
```json
  "sourcedItems": {
    "title": "Items",
    "addTitle": "Record an item",
    "editTitle": "Edit item",
    "name": "Item name",
    "description": "Description",
    "price": "Price",
    "priceHint": "As quoted by the supplier.",
    "currency": "Currency",
    "unit": "Unit",
    "unitHint": "Per piece, per carton of 50, per kg.",
    "moq": "Minimum order",
    "notes": "Notes",
    "photo": "Photo (optional)",
    "photoHint": "A picture from the market helps you recognise it later.",
    "addPhoto": "Add photo",
    "removePhoto": "Remove photo",
    "uploading": "Uploading...",
    "photoUploadFailed": "Item saved, but the photo failed to upload. Add it from the list.",
    "save": "Save item",
    "saving": "Saving...",
    "cancelEdit": "Cancel",
    "edit": "Edit",
    "delete": "Delete",
    "deleteConfirm": "Delete this item?",
    "searchPlaceholder": "Search items",
    "colItem": "Item",
    "colPrice": "Price",
    "colUnit": "Unit",
    "colMoq": "Min order",
    "colActions": "Actions",
    "backToSuppliers": "All suppliers",
    "emptyTitle": "Nothing recorded from this supplier yet.",
    "emptyHint": "Add what they sell and what they quoted.",
    "noResultsTitle": "No items match your search.",
    "noResultsHint": "Try a different name.",
    "loadError": "Could not load items. Check your connection.",
    "saveError": "Could not save. Try again.",
    "retry": "Try again",
    "invalidPrice": "Enter a price greater than zero."
  },
```
In `apps/web/messages/sw.json`, the same keys in Swahili:
```json
  "sourcedItems": {
    "title": "Bidhaa",
    "addTitle": "Rekodi bidhaa",
    "editTitle": "Hariri bidhaa",
    "name": "Jina la bidhaa",
    "description": "Maelezo",
    "price": "Bei",
    "priceHint": "Kama alivyotaja muuzaji.",
    "currency": "Sarafu",
    "unit": "Kipimo",
    "unitHint": "Kwa kipande, kwa karatasi ya 50, kwa kilo.",
    "moq": "Kiwango cha chini cha oda",
    "notes": "Maelezo",
    "photo": "Picha (hiari)",
    "photoHint": "Picha kutoka sokoni itakusaidia kuikumbuka baadaye.",
    "addPhoto": "Ongeza picha",
    "removePhoto": "Ondoa picha",
    "uploading": "Inapakia...",
    "photoUploadFailed": "Bidhaa imehifadhiwa, lakini picha imeshindwa kupakiwa. Iongeze kutoka kwenye orodha.",
    "save": "Hifadhi bidhaa",
    "saving": "Inahifadhi...",
    "cancelEdit": "Ghairi",
    "edit": "Hariri",
    "delete": "Futa",
    "deleteConfirm": "Futa bidhaa hii?",
    "searchPlaceholder": "Tafuta bidhaa",
    "colItem": "Bidhaa",
    "colPrice": "Bei",
    "colUnit": "Kipimo",
    "colMoq": "Oda ya chini",
    "colActions": "Vitendo",
    "backToSuppliers": "Wauzaji wote",
    "emptyTitle": "Hakuna kilichorekodiwa kwa muuzaji huyu bado.",
    "emptyHint": "Ongeza wanachouza na bei waliyotaja.",
    "noResultsTitle": "Hakuna bidhaa inayolingana na utafutaji wako.",
    "noResultsHint": "Jaribu jina lingine.",
    "loadError": "Imeshindwa kupakia bidhaa. Angalia muunganisho wako.",
    "saveError": "Imeshindwa kuhifadhi. Jaribu tena.",
    "retry": "Jaribu tena",
    "invalidPrice": "Weka bei kubwa kuliko sifuri."
  },
```

- [ ] **Step 9: Build the supplier detail screen**

Create `apps/web/src/app/[locale]/suppliers/[id]/page.tsx`, again mirroring the products page's structure. Specifics:
- Read the route id with `useParams()` and the same module guard as Task 2's screen.
- Two queries: `queryKeys.suppliers` (to find this supplier's header details from the list) and `useQuery({ queryKey: queryKeys.sourcedItems(id), queryFn: () => listSourcedItems(id) })`.
- Header: a `Card` with the supplier's name, `city, country`, market, address, contact name, a `tel:` link for `contactPhone`, contactNote, and notes. A `Link` back to `/suppliers` labelled `t('backToSuppliers')`.
- Add/edit item form (the primary action, placed directly under the header): `Field` + `Input` for name, a two-column row with price (`type="number"`, `inputMode="numeric"`, min 1) and a currency `<select>` built from `SOURCING_CURRENCIES` defaulting to the first entry, then unit, moq (`type="number"`, `inputMode="numeric"`), a description textarea, notes textarea, and the optional photo picker with preview (copy the products page's `pendingPhoto`/`pendingPhotoUrl`/`selectPendingPhoto` pattern including `URL.revokeObjectURL` on change and the unmount effect).
- Price entry is in MAJOR units for the user; convert on submit: `priceAmount: Math.round(Number(price) * 100)`. When editing, seed the input with `String(item.priceAmount / 100)`. Guard: `Number.isNaN` or `<= 0` sets `setFormError(t('invalidPrice'))`.
- Submit: `createSourcedItem` then, if a photo was chosen, `uploadSourcedItemImage(id, created.id, photo)` inside a try/catch that sets the `photoUploadFailed` warning after `resetForm()` (mirroring the products page's `photoFailed` flag flow), then invalidate `queryKeys.sourcedItemsRoot`.
- List: `SearchInput` filtering on item name; desktop `Table` (thumbnail via `ThumbCell` from the first image, name, price rendered as `${(priceAmount / 100).toLocaleString(locale)} ${priceCurrency}`, unit, moq, kebab with edit / add photo / remove photo / delete) and mobile cards with the same actions.
- Empty and no-results states using the keys above.

- [ ] **Step 10: Run both gates and commit**

Run the API gate and the web gate as in Task 2.
```bash
git add apps/api/src/repositories/sourced-item-repository.ts apps/api/src/services/sourced-item-service.ts apps/api/src/services/sourced-item-service.test.ts apps/api/src/controllers/supplier-controller.ts apps/api/src/routes/suppliers.ts apps/web/src/lib apps/web/src/app apps/web/messages
git commit -m "feat(sourcing): record items per supplier with photos"
```

---

### Task 4: Global item search

**Files:**
- Modify: `apps/api/src/repositories/sourced-item-repository.ts` (search method)
- Modify: `apps/api/src/services/sourced-item-service.ts` (search + result mapping)
- Test: `apps/api/src/services/sourced-item-service.test.ts` (add a case)
- Create: `apps/api/src/routes/sourced-items.ts`, `apps/api/src/controllers/sourced-item-controller.ts`
- Modify: `apps/api/src/app.ts` (mount)
- Modify: `apps/web/src/lib/sourcing-api.ts`, `apps/web/src/lib/query-keys.ts`
- Create: `apps/web/src/app/[locale]/sourcing/page.tsx`
- Modify: `apps/web/messages/en.json`, `apps/web/messages/sw.json`

**Interfaces:**
- Consumes: Task 3's repository and service; Task 1's `sourcedItemSearchResultSchema`.
- Produces: `sourcedItemRepository.search(query: string)`, `sourcedItemService.search(query: string): Promise<SourcedItemSearchResult[]>`, `GET /api/v1/sourced-items?q=`, web `searchSourcedItems(query: string)`, `queryKeys.sourcedItemSearch(query)`.

- [ ] **Step 1: Write the failing search test**

Add to `apps/api/src/services/sourced-item-service.test.ts` (extend the hoisted `repo` mock with `search: vi.fn()`):
```ts
it('maps search hits to results carrying the supplier name and city', async () => {
  repo.search.mockResolvedValue([
    { ...row, supplier: { name: 'Guangzhou Bag City', city: 'Guangzhou', country: 'CN' } },
  ]);
  const [hit] = await sourcedItemService.search('handbag');
  expect(hit).toMatchObject({
    id: 'i1',
    name: 'Leather handbag',
    priceAmount: 4550,
    priceCurrency: 'CNY',
    supplierName: 'Guangzhou Bag City',
    supplierCity: 'Guangzhou',
    supplierCountry: 'CN',
  });
});

it('returns nothing for a blank query instead of listing everything', async () => {
  await expect(sourcedItemService.search('   ')).resolves.toEqual([]);
  expect(repo.search).not.toHaveBeenCalled();
});
```

- [ ] **Step 2: Run it to verify failure**

Run: `pnpm -F @waos/api test -- sourced-item-service`
Expected: FAIL (`search` is not a function).

- [ ] **Step 3: Add the repository search**

In `apps/api/src/repositories/sourced-item-repository.ts`, add the type and method:
```ts
export type SourcedItemWithSupplier = SourcedItemWithImages & {
  supplier: { name: string; city: string | null; country: string };
};
```
```ts
  /** Case-insensitive match on item name or description, newest first. */
  search(query: string): Promise<SourcedItemWithSupplier[]> {
    return prisma.sourcedItem.findMany({
      where: {
        OR: [
          { name: { contains: query, mode: 'insensitive' } },
          { description: { contains: query, mode: 'insensitive' } },
        ],
      },
      include: {
        ...withImages,
        supplier: { select: { name: true, city: true, country: true } },
      },
      orderBy: { createdAt: 'desc' },
      take: 50,
    });
  },
```

- [ ] **Step 4: Add the service search**

In `apps/api/src/services/sourced-item-service.ts` (import `SourcedItemSearchResult` and `SourcedItemWithSupplier`):
```ts
  /**
   * The six-months-later question: "where did I get this, and what did it
   * cost?" A blank query returns nothing rather than dumping the whole
   * directory.
   */
  async search(query: string): Promise<SourcedItemSearchResult[]> {
    const trimmed = query.trim();
    if (trimmed.length === 0) {
      return [];
    }
    const rows = await sourcedItemRepository.search(trimmed);
    return Promise.all(
      rows.map(async (row: SourcedItemWithSupplier) => ({
        ...(await this.toDto(row)),
        supplierName: row.supplier.name,
        supplierCity: row.supplier.city,
        supplierCountry: row.supplier.country,
      })),
    );
  },
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `pnpm -F @waos/api test -- sourced-item-service`
Expected: PASS (5 tests).

- [ ] **Step 6: Controller, route, and mount**

Create `apps/api/src/controllers/sourced-item-controller.ts`:
```ts
import type { Request, Response } from 'express';
import { sourcedItemService } from '../services/sourced-item-service.js';

export const search = async (req: Request, res: Response): Promise<void> => {
  const q = typeof req.query.q === 'string' ? req.query.q : '';
  const items = await sourcedItemService.search(q);
  res.json({ items });
};
```
Create `apps/api/src/routes/sourced-items.ts`:
```ts
import { Router } from 'express';
import * as sourcedItemController from '../controllers/sourced-item-controller.js';
import { requireAuth } from '../middleware/auth.js';
import { requireModule } from '../middleware/require-module.js';

export const sourcedItemRoutes: Router = Router();

sourcedItemRoutes.use(requireAuth);
sourcedItemRoutes.use(requireModule('sourcing'));
sourcedItemRoutes.get('/', sourcedItemController.search);
```
In `apps/api/src/app.ts`, import and mount: `app.use('/api/v1/sourced-items', sourcedItemRoutes);`

- [ ] **Step 7: Web client and copy**

In `apps/web/src/lib/query-keys.ts`:
```ts
  sourcedItemSearch: (query: string) => ['sourced-item-search', query] as const,
```
In `apps/web/src/lib/sourcing-api.ts` (import `sourcedItemSearchResultSchema`, `type SourcedItemSearchResult`):
```ts
export async function searchSourcedItems(query: string): Promise<SourcedItemSearchResult[]> {
  const raw = await apiFetch<unknown>(
    `/api/v1/sourced-items?q=${encodeURIComponent(query)}`,
  );
  return z.array(sourcedItemSearchResultSchema).parse((raw as { items: unknown }).items);
}
```
In `apps/web/messages/en.json`, add a top-level `sourcing` object:
```json
  "sourcing": {
    "title": "Sourcing",
    "searchPlaceholder": "Search everything you have sourced",
    "searchHint": "Find which supplier had an item and what they quoted.",
    "startTitle": "Search your sourcing records.",
    "startHint": "Type a product name to see every supplier that had it.",
    "noResultsTitle": "Nothing matches that search.",
    "noResultsHint": "Try another product name.",
    "atSupplier": "at {supplier}",
    "viewSupplier": "View supplier",
    "loadError": "Could not search. Check your connection.",
    "retry": "Try again"
  },
```
In `apps/web/messages/sw.json`:
```json
  "sourcing": {
    "title": "Ununuzi",
    "searchPlaceholder": "Tafuta kila ulichonunua",
    "searchHint": "Tafuta ni muuzaji gani alikuwa na bidhaa na bei aliyotaja.",
    "startTitle": "Tafuta kumbukumbu zako za ununuzi.",
    "startHint": "Andika jina la bidhaa kuona kila muuzaji aliyekuwa nayo.",
    "noResultsTitle": "Hakuna kinacholingana na utafutaji huo.",
    "noResultsHint": "Jaribu jina lingine la bidhaa.",
    "atSupplier": "kwa {supplier}",
    "viewSupplier": "Ona muuzaji",
    "loadError": "Imeshindwa kutafuta. Angalia muunganisho wako.",
    "retry": "Jaribu tena"
  },
```

- [ ] **Step 8: Build the sourcing search screen**

Create `apps/web/src/app/[locale]/sourcing/page.tsx`:
- Same module guard as the other sourcing screens; `<AppShell title={t('title')}>`.
- A prominent `SearchInput` at the top with `t('searchPlaceholder')` and `t('searchHint')` beneath it, bound to a `query` state.
- `useQuery({ queryKey: queryKeys.sourcedItemSearch(query.trim()), queryFn: () => searchSourcedItems(query), enabled: query.trim().length > 0 })`.
- Before typing: `EmptyState` with `startTitle`/`startHint`. With a query and no hits: `noResultsTitle`/`noResultsHint`. On error: `ErrorBox` with `loadError` and a retry.
- Results as cards at every width (this screen is search-first, not a management table): thumbnail from the first image, item name, the price as `${(priceAmount / 100).toLocaleString(locale)} ${priceCurrency}` with the unit beside it, then `t('atSupplier', { supplier: supplierName })` with `supplierCity, supplierCountry` underneath, and a `Link` to `/suppliers/${supplierId}` labelled `t('viewSupplier')`.

- [ ] **Step 9: Run both gates and commit**

```bash
git add apps/api/src apps/web/src apps/web/messages
git commit -m "feat(sourcing): search every item across all suppliers"
```

---

### Task 5: CSV import for suppliers and items

**Files:**
- Create: `apps/api/src/services/sourcing-import.ts`; Test: `apps/api/src/services/sourcing-import.test.ts`
- Modify: `apps/api/src/controllers/supplier-controller.ts`, `apps/api/src/routes/suppliers.ts`
- Modify: `apps/web/src/lib/sourcing-api.ts`
- Modify: `apps/web/src/app/[locale]/suppliers/page.tsx`, `apps/web/src/app/[locale]/suppliers/[id]/page.tsx`
- Modify: `apps/web/messages/en.json`, `apps/web/messages/sw.json`

**Interfaces:**
- Consumes: `parseCsv(text: string): string[][]` from `apps/api/src/lib/csv.js`; `importProductsResponseSchema` shape (`{ created, failures: { row, reason }[] }`) as the response contract, reused via a sourcing-specific schema of the same shape; Task 2 and 3 services.
- Produces: `importSuppliersCsv(text)`, `importSourcedItemsCsv(supplierId, text)`, routes `POST /api/v1/suppliers/import` and `POST /api/v1/suppliers/:supplierId/items/import`, web `importSuppliersCsv(file)` and `importSourcedItemsCsv(supplierId, file)`.

- [ ] **Step 1: Add the shared response schema**

In `packages/shared/src/schemas/sourcing.ts`, append:
```ts
export const sourcingImportResponseSchema = z.object({
  created: z.number().int().min(0),
  failures: z.array(z.object({ row: z.number().int().min(1), reason: z.string() })),
});
export type SourcingImportResponse = z.infer<typeof sourcingImportResponseSchema>;
```

- [ ] **Step 2: Write the failing import tests**

Create `apps/api/src/services/sourcing-import.test.ts` (mirroring `product-import.test.ts`'s mock style):
```ts
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { supplierServiceMock, sourcedItemServiceMock } = vi.hoisted(() => ({
  supplierServiceMock: { create: vi.fn() },
  sourcedItemServiceMock: { create: vi.fn() },
}));
vi.mock('./supplier-service.js', () => ({ supplierService: supplierServiceMock }));
vi.mock('./sourced-item-service.js', () => ({ sourcedItemService: sourcedItemServiceMock }));

import { importSourcedItemsCsv, importSuppliersCsv } from './sourcing-import.js';

const SUPPLIER_HEADER = 'name,country,city,market,address,contactName,contactPhone,contactNote,notes';
const ITEM_HEADER = 'name,description,priceAmount,priceCurrency,unit,moq,notes';

beforeEach(() => {
  vi.clearAllMocks();
  supplierServiceMock.create.mockResolvedValue({ id: 's1' });
  sourcedItemServiceMock.create.mockResolvedValue({ id: 'i1' });
});

describe('importSuppliersCsv', () => {
  it('creates each valid row', async () => {
    const csv = `${SUPPLIER_HEADER}\n"Guangzhou Bag City",CN,Guangzhou,"Bag City",,Lin,+8613800000000,"WeChat: lin",\n`;
    const result = await importSuppliersCsv(csv);
    expect(result).toEqual({ created: 1, failures: [] });
    expect(supplierServiceMock.create).toHaveBeenCalledWith({
      name: 'Guangzhou Bag City',
      country: 'CN',
      city: 'Guangzhou',
      market: 'Bag City',
      contactName: 'Lin',
      contactPhone: '+8613800000000',
      contactNote: 'WeChat: lin',
    });
  });

  it('reports an invalid country code as a row failure and keeps going', async () => {
    const csv = `${SUPPLIER_HEADER}\nGood,CN,,,,,,,\nBad,CHINA,,,,,,,\n`;
    const result = await importSuppliersCsv(csv);
    expect(result.created).toBe(1);
    expect(result.failures).toHaveLength(1);
    expect(result.failures[0]?.row).toBe(2);
  });

  it('rejects a wrong header', async () => {
    await expect(importSuppliersCsv('nope,country\nx,CN')).rejects.toThrow(/header/i);
  });

  it('skips fully empty padding rows', async () => {
    const csv = `${SUPPLIER_HEADER}\nGood,CN,,,,,,,\n,,,,,,,,\n`;
    const result = await importSuppliersCsv(csv);
    expect(result).toEqual({ created: 1, failures: [] });
  });
});

describe('importSourcedItemsCsv', () => {
  it('creates each valid row against the given supplier', async () => {
    const csv = `${ITEM_HEADER}\n"Leather handbag",,4550,CNY,"per piece",50,\n`;
    const result = await importSourcedItemsCsv('s1', csv);
    expect(result).toEqual({ created: 1, failures: [] });
    expect(sourcedItemServiceMock.create).toHaveBeenCalledWith('s1', {
      name: 'Leather handbag',
      priceAmount: 4550,
      priceCurrency: 'CNY',
      unit: 'per piece',
      moq: 50,
    });
  });

  it('reports an unsupported currency as a row failure', async () => {
    const csv = `${ITEM_HEADER}\nGood,,100,CNY,,,\nBad,,100,XYZ,,,\n`;
    const result = await importSourcedItemsCsv('s1', csv);
    expect(result.created).toBe(1);
    expect(result.failures[0]?.row).toBe(2);
  });
});
```

- [ ] **Step 3: Run to verify failure**

Run: `pnpm -F @waos/api test -- sourcing-import`
Expected: FAIL (module does not exist).

- [ ] **Step 4: Implement the import service**

Create `apps/api/src/services/sourcing-import.ts`:
```ts
import {
  createSourcedItemRequestSchema,
  createSupplierRequestSchema,
  type SourcingImportResponse,
} from '@waos/shared';
import { parseCsv } from '../lib/csv.js';
import { ValidationError } from '../lib/errors.js';
import { sourcedItemService } from './sourced-item-service.js';
import { supplierService } from './supplier-service.js';

export const SUPPLIER_IMPORT_HEADER = [
  'name',
  'country',
  'city',
  'market',
  'address',
  'contactName',
  'contactPhone',
  'contactNote',
  'notes',
] as const;

export const ITEM_IMPORT_HEADER = [
  'name',
  'description',
  'priceAmount',
  'priceCurrency',
  'unit',
  'moq',
  'notes',
] as const;

const MAX_DATA_ROWS = 200;

/** Empty cells become undefined so the schema's optionals apply. */
function text(cell: string | undefined): string | undefined {
  const trimmed = (cell ?? '').trim();
  return trimmed === '' ? undefined : trimmed;
}

function count(cell: string | undefined): number | undefined {
  const trimmed = (cell ?? '').trim();
  return trimmed === '' ? undefined : Number(trimmed);
}

interface ImportPlan {
  header: readonly string[];
  toPayload: (cells: string[]) => Record<string, unknown>;
  create: (payload: Record<string, unknown>) => Promise<unknown>;
  schema: { safeParse: (value: unknown) => { success: boolean; error?: { issues: { path: (string | number)[]; message: string }[] }; data?: unknown } };
}

async function runImport(text_: string, plan: ImportPlan): Promise<SourcingImportResponse> {
  const rows = parseCsv(text_);
  if (rows.length === 0) {
    throw new ValidationError('The file is empty.');
  }
  const header = (rows[0] ?? []).map((cell) => cell.trim());
  if (header.join(',') !== plan.header.join(',')) {
    throw new ValidationError(
      `The header row must be exactly: ${plan.header.join(',')}. Download a fresh template.`,
    );
  }
  const dataRows = rows.slice(1);
  if (dataRows.length > MAX_DATA_ROWS) {
    throw new ValidationError(
      `The file has ${dataRows.length} data rows. The limit is ${MAX_DATA_ROWS} per import.`,
    );
  }
  let created = 0;
  const failures: { row: number; reason: string }[] = [];
  for (const [index, cells] of dataRows.entries()) {
    const rowNumber = index + 1;
    if (cells.every((cell) => cell.trim() === '')) {
      continue;
    }
    if (cells.length !== plan.header.length) {
      failures.push({
        row: rowNumber,
        reason: `Expected ${plan.header.length} columns, got ${cells.length}.`,
      });
      continue;
    }
    const parsed = plan.schema.safeParse(plan.toPayload(cells));
    if (!parsed.success) {
      const issue = parsed.error?.issues[0];
      const path = issue?.path.join('.') ?? 'row';
      failures.push({ row: rowNumber, reason: `${path}: ${issue?.message ?? 'invalid'}` });
      continue;
    }
    try {
      await plan.create(parsed.data as Record<string, unknown>);
      created += 1;
    } catch (error) {
      failures.push({
        row: rowNumber,
        reason: error instanceof Error ? error.message : 'Could not create this row.',
      });
    }
  }
  return { created, failures };
}

export function importSuppliersCsv(csv: string): Promise<SourcingImportResponse> {
  return runImport(csv, {
    header: SUPPLIER_IMPORT_HEADER,
    schema: createSupplierRequestSchema,
    toPayload: (cells) => ({
      name: text(cells[0]),
      country: text(cells[1]),
      city: text(cells[2]),
      market: text(cells[3]),
      address: text(cells[4]),
      contactName: text(cells[5]),
      contactPhone: text(cells[6]),
      contactNote: text(cells[7]),
      notes: text(cells[8]),
    }),
    create: (payload) => supplierService.create(payload as never),
  });
}

export function importSourcedItemsCsv(
  supplierId: string,
  csv: string,
): Promise<SourcingImportResponse> {
  return runImport(csv, {
    header: ITEM_IMPORT_HEADER,
    schema: createSourcedItemRequestSchema,
    toPayload: (cells) => ({
      name: text(cells[0]),
      description: text(cells[1]),
      priceAmount: count(cells[2]),
      priceCurrency: text(cells[3]),
      unit: text(cells[4]),
      moq: count(cells[5]),
      notes: text(cells[6]),
    }),
    create: (payload) => sourcedItemService.create(supplierId, payload as never),
  });
}
```
Note: `createSupplierRequestSchema` strips undefined optionals, so the test's expected `create` payloads contain only the supplied fields. If a `safeParse` typing mismatch appears against the `ImportPlan.schema` shape, type `schema` as `z.ZodType<unknown>` and import `z` rather than loosening with `any`.

- [ ] **Step 5: Run to verify the tests pass**

Run: `pnpm -F @waos/api test -- sourcing-import`
Expected: PASS (6 tests).

- [ ] **Step 6: Routes and controller**

In `apps/api/src/controllers/supplier-controller.ts`, add (importing the two import functions):
```ts
export const importSuppliers = async (req: Request, res: Response): Promise<void> => {
  const file = req.file;
  if (!file) {
    throw new ValidationError('Attach a .csv file.');
  }
  res.json(await importSuppliersCsv(file.buffer.toString('utf8')));
};

export const importItems = async (req: Request, res: Response): Promise<void> => {
  const file = req.file;
  if (!file) {
    throw new ValidationError('Attach a .csv file.');
  }
  res.json(
    await importSourcedItemsCsv(routeParam(req.params.supplierId), file.buffer.toString('utf8')),
  );
};
```
In `apps/api/src/routes/suppliers.ts`, add a `csvUpload` multer instance (copy from `apps/api/src/routes/products.ts`: memory storage, 1MB, accepts `text/csv`, `application/vnd.ms-excel`, or a `.csv` filename) and register BEFORE the `/:id` routes so the literal path wins:
```ts
supplierRoutes.post('/import', csvUpload.single('file'), supplierController.importSuppliers);
```
and with the other item routes:
```ts
supplierRoutes.post(
  '/:supplierId/items/import',
  csvUpload.single('file'),
  supplierController.importItems,
);
```
Register `/:supplierId/items/import` BEFORE `/:supplierId/items/:itemId` is not required (different method/segment count), but keep `/import` above `/:id` so Express does not treat "import" as an id.

- [ ] **Step 7: Web client, templates, and UI**

In `apps/web/src/lib/sourcing-api.ts` (import `sourcingImportResponseSchema`, `type SourcingImportResponse`, `apiUpload`):
```ts
export async function importSuppliersCsv(file: File): Promise<SourcingImportResponse> {
  const formData = new FormData();
  formData.append('file', file);
  const raw = await apiUpload<unknown>('/api/v1/suppliers/import', formData);
  return sourcingImportResponseSchema.parse(raw);
}

export async function importSourcedItemsCsv(
  supplierId: string,
  file: File,
): Promise<SourcingImportResponse> {
  const formData = new FormData();
  formData.append('file', file);
  const raw = await apiUpload<unknown>(`/api/v1/suppliers/${supplierId}/items/import`, formData);
  return sourcingImportResponseSchema.parse(raw);
}
```
Add to the `suppliers` object in `en.json`:
```json
    "downloadTemplate": "Download template",
    "importCsv": "Import CSV",
    "importing": "Importing...",
    "importedCount": "{count} suppliers imported.",
    "importFailuresTitle": "Rows that failed (fix these in the file and re-upload only them):",
    "importRow": "Row {row}",
    "importError": "Import failed. Check the file and try again.",
    "importDismiss": "Dismiss",
```
and in `sw.json`:
```json
    "downloadTemplate": "Pakua kiolezo",
    "importCsv": "Ingiza CSV",
    "importing": "Inaingiza...",
    "importedCount": "Wauzaji {count} wameingizwa.",
    "importFailuresTitle": "Safu zilizoshindwa (zirekebishe kwenye faili kisha upakie hizo tu):",
    "importRow": "Safu {row}",
    "importError": "Uingizaji umeshindwa. Angalia faili kisha ujaribu tena.",
    "importDismiss": "Funga",
```
Add the same eight keys to the `sourcedItems` object in both files, with `importedCount` reading `"{count} items imported."` / `"Bidhaa {count} zimeingizwa."`.

On the suppliers list screen, add the Download template and Import CSV buttons plus the result panel, copying the products page's implementation (a `TEMPLATE_CSV` blob download, a hidden file input, `runImport`, and the created-count-plus-failures panel). The supplier template string is:
```ts
  const TEMPLATE_CSV =
    'name,country,city,market,address,contactName,contactPhone,contactNote,notes\r\n' +
    '"Guangzhou Bag City",CN,Guangzhou,"Bag City","Zhan Qian Rd",Lin,+8613800000000,"WeChat: lin_bags","Stall 3B, closed Sundays"\r\n';
```
downloaded as `waos-suppliers-template.csv`. On the supplier detail screen, the same treatment with:
```ts
  const TEMPLATE_CSV =
    'name,description,priceAmount,priceCurrency,unit,moq,notes\r\n' +
    '"Leather handbag","Black, PU leather",4550,CNY,"per piece",50,"Ask for the 100pc price"\r\n';
```
downloaded as `waos-sourced-items-template.csv`. Both templates keep fixed English headers: they are a machine contract the parser matches exactly, exactly as the products import does. Note in the UI copy that `priceAmount` is in minor units (the example row shows 4550 for 45.50 CNY); add this to the item `importCsv` button's surrounding hint only if a hint element already exists, otherwise leave the example row to carry it.

- [ ] **Step 8: Run both gates and commit**

Run the API gate and the web gate.
```bash
git add packages/shared/src/schemas/sourcing.ts apps/api/src apps/web/src apps/web/messages
git commit -m "feat(sourcing): CSV import for suppliers and sourced items"
```

---

## Self-Review

**1. Spec coverage:** Section 3 (three models, minor units, no embedding) is Task 1. Section 4's screens: suppliers list (Task 2), supplier detail with add-item and photo-at-creation (Task 3), global search (Task 4), CSV import on both screens (Task 5). Section 5's routes are spread across Tasks 2 to 5 exactly as listed. Section 6's safety invariant is enforced structurally (no tools or embeddings anywhere in the plan) and pinned by the Task 1 test. Section 7's constraints are in Global Constraints. Section 8's out-of-scope items appear in no task. Section 9's sequencing matches the five tasks. Section 10's criteria map to the tests and the live drive.

**2. Placeholder scan:** No TBD or "handle errors" hand-waves. The three screen-building steps (Task 2 Step 9, Task 3 Step 9, Task 4 Step 8) describe structure plus exact behaviors rather than pasting 400 lines of JSX, and name the file to mirror (`products/page.tsx`), which is the established pattern in this repo's plans; every non-obvious decision (price conversion, photo-failure flow, empty-state branching, currency default) is specified. The `ImportPlan.schema` typing note gives a concrete fallback rather than leaving it open.

**3. Type consistency:** `SupplierDto.itemCount` is produced by `supplierRepository`'s `_count` include and mapped in `supplierService.toDto`, matching the Task 2 test. `SourcedItemDto.images[].mediaUrl` comes from `getMediaUrl(mediaKey)` and `mediaKey` never reaches the DTO (asserted). `sourcedItemService.create(supplierId, input)` is called that way by the controller and by `importSourcedItemsCsv`. `SourcedItemWithSupplier` (Task 4) extends `SourcedItemWithImages` (Task 3). `sourcingImportResponseSchema` (Task 5 Step 1) matches `SourcingImportResponse` returned by both import functions and parsed by both web clients. `queryKeys.suppliers`, `sourcedItems(supplierId)`, and `sourcedItemSearch(query)` are defined once and used consistently. `SOURCING_CURRENCIES` (Task 1) drives the Task 3 currency picker and the Task 5 currency validation. No dangling references.
