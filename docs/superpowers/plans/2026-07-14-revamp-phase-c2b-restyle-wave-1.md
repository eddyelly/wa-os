# WaOS Revamp Phase C2b: Restyle Wave 1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add the additive read-only sales KPIs to the dashboard API and restyle wave 1 of the dashboard screens (home, login, signup, and the five onboarding steps) onto the new `@/components/ui` component layer.

**Architecture:** Three tasks. Task 1 extends the existing `/api/v1/dashboard` response with an optional `sales` block for shop-module orgs, computed from new read-only aggregate repository methods, gated server-side on the org's modules, and covered by a Vitest unit test. Task 2 rebuilds the home page to render a module-aware `StatCard` grid (booking KPIs always; sales KPIs when the org has the shop module) plus a recent-activity strip, reusing existing validated reads and query keys. Task 3 migrates the seven auth and onboarding screens from the old `@/components/ui-legacy` kit to the new `@/components/ui` layer by swapping one import line per file; the new components are drop-in API-compatible, so the visual refresh (soft `brand-100` card borders, focus rings) comes from the component layer with no logic change.

**Tech Stack:** API: Node 20+, Express, TypeScript strict, Prisma, Vitest. Web: Next.js 15 App Router, React 19, Tailwind v4, next-intl, TanStack Query v5, the `@/components/ui` layer built on shadcn/ui.

## Global Constraints

- **Presentation and additive-read only.** No data, tenancy, or business-logic change beyond the additive read-only KPIs. C1's query layer and every backend contract stay intact. A change that alters an existing query key, an invalidation, or an existing endpoint's existing fields is out of scope. (Spec section 10.)
- **The sales KPIs are the only new data.** `orders today`, `revenue agreed this week` (sum of the week's confirmed order totals: statuses CONFIRMED, PAID, FULFILLED), `pending confirmations` (status PENDING_CONFIRMATION), and `low-stock product count` (active products with `stockQty <= lowStockThreshold`). Returned only for orgs whose `modules` include `shop`. (Spec section 6.)
- **Both locales stay complete.** Any new copy (KPI labels, activity strip) ships in `en` and `sw` with key parity. English-only strings are a lint failure. (Spec section 10; CLAUDE.md section 12.5.)
- **No em dashes anywhere.** Not in code, comments, docs, or UI copy. Use commas, colons, or parentheses. (CLAUDE.md section 6.2.)
- **TypeScript strict, no `any`.** Use `unknown` plus narrowing or proper generics. (CLAUDE.md section 6.1.)
- **Conventional commits.** `feat:`, `fix:`, `refactor:`, `test:`, `docs:`, with scope where useful. (CLAUDE.md section 6.3.)
- **Layering.** routes to controllers to services to repositories. Controllers never touch Prisma; services never touch `req`/`res`; all Prisma access lives in `repositories/`. (CLAUDE.md section 5.)
- **Tenancy.** Never query a domain table without the org scope; the tenant Prisma extension enforces this. Do not bypass it with raw SQL. (CLAUDE.md section 13.)
- **Money is whole TZS integers.** `Product.price`, `Order.totalAgreed` and the new revenue sum are whole-shilling integers. Render as `{value.toLocaleString(locale)} TZS`, matching the existing orders and products pages. (CLAUDE.md section 7; existing `apps/web/src/app/[locale]/orders/page.tsx`.)
- **API gate:** `pnpm -F @waos/api typecheck && pnpm -F @waos/api test && pnpm lint` pass with zero errors.
- **Web gate (no web test runner):** `pnpm -F @waos/web typecheck && pnpm lint && pnpm -F @waos/web build` pass with zero errors, then a live drive of the changed screens. (Spec section 10.)

---

## File Structure

**Task 1 (backend, additive read-only):**
- Modify `apps/api/src/repositories/order-repository.ts` — add `countCreatedSince`, `countByStatus`, `sumAgreedSince` (read-only aggregates).
- Modify `apps/api/src/repositories/product-repository.ts` — add `countLowStock` (read-only).
- Modify `apps/api/src/services/dashboard-service.ts` — add `SalesSummary`, extend `DashboardSummary` with optional `sales`, gate on the org's modules.
- Modify `packages/shared/src/schemas/dashboard.ts` — add `salesSummarySchema`, add optional `sales` to `dashboardSummarySchema`.
- Create `apps/api/src/services/dashboard-service.test.ts` — Vitest unit test with mocked repositories.

**Task 2 (home restyle + KPIs):**
- Modify `apps/web/src/app/[locale]/home/page.tsx` — full rewrite onto `@/components/ui`, module-aware KPI grid, activity strip.
- Modify `apps/web/messages/en.json` and `apps/web/messages/sw.json` — new `homeDash` keys.

**Task 3 (auth + onboarding migration):**
- Modify these seven files, one import line each, `@/components/ui-legacy` to `@/components/ui`:
  - `apps/web/src/app/[locale]/login/page.tsx`
  - `apps/web/src/app/[locale]/signup/page.tsx`
  - `apps/web/src/app/[locale]/onboarding/profile/page.tsx`
  - `apps/web/src/app/[locale]/onboarding/connect/page.tsx`
  - `apps/web/src/app/[locale]/onboarding/knowledge/page.tsx`
  - `apps/web/src/app/[locale]/onboarding/products/page.tsx`
  - `apps/web/src/app/[locale]/onboarding/test/page.tsx`

**Reference (do not modify): the new component layer and its APIs**
- `apps/web/src/components/ui/index.ts` barrel exports: `Button`, `Input`, `Textarea`, `Card`, `Badge`, `Skeleton`, `Separator`, `Field`, `EmptyState`, `ErrorBox`, `Spinner`, `PageHeader`, `StatCard`, plus re-exports of shadcn `dialog`, `dropdown-menu`, `select`, `switch`.
- `StatCard({ label: string, value: string, hint?: string, tone?: 'neutral' | 'brand' | 'accent' })`.
- `EmptyState({ title: string, hint?: string, action?: ReactNode })`.
- `ErrorBox({ message: string, onRetry?: () => void, retryLabel?: string })`.
- `Skeleton({ className?: string })`.
- `AppShell({ children, wide?: boolean, title?: string })` in `apps/web/src/components/app-shell.tsx`. The `title` is rendered by `TopHeader` as the page `<h1>`; a screen that passes `title` must NOT also render an in-content title for the same string.

---

### Task 1: Dashboard sales-summary API extension

**Files:**
- Modify: `packages/shared/src/schemas/dashboard.ts`
- Modify: `apps/api/src/repositories/order-repository.ts`
- Modify: `apps/api/src/repositories/product-repository.ts`
- Modify: `apps/api/src/services/dashboard-service.ts`
- Test: `apps/api/src/services/dashboard-service.test.ts` (create)

**Interfaces:**
- Consumes (existing, unchanged): `conversationRepository.countByStatusToday`, `conversationRepository.list`, `aiReplyLogRepository.countsSince`, `appointmentRepository.upcoming`, `appointmentService.toDto`, `organizationRepository.findCurrent(id: string)`, `requireRequestContext()` from `../lib/context.js`, and `prisma` from `../lib/prisma.js`. `OrderStatus` is imported from `@prisma/client` in the order repository.
- Produces:
  - `orderRepository.countCreatedSince(since: Date): Promise<number>`
  - `orderRepository.countByStatus(status: OrderStatus): Promise<number>`
  - `orderRepository.sumAgreedSince(since: Date, statuses: OrderStatus[]): Promise<number>`
  - `productRepository.countLowStock(): Promise<number>`
  - `SalesSummary` interface and `DashboardSummary.sales?: SalesSummary` from `dashboard-service.ts`.
  - `salesSummarySchema` and `dashboardSummarySchema` (with optional `sales`) plus `SalesSummaryDto` from `@waos/shared`. Consumed by Task 2.

- [ ] **Step 1: Extend the shared schema**

In `packages/shared/src/schemas/dashboard.ts`, add `salesSummarySchema` and an optional `sales` field. Full file after edit:

```ts
import { z } from 'zod';
import { appointmentSchema } from './appointment.js';

export const salesSummarySchema = z.object({
  ordersToday: z.number().int(),
  revenueAgreedThisWeek: z.number().int(),
  pendingConfirmations: z.number().int(),
  lowStockCount: z.number().int(),
});
export type SalesSummaryDto = z.infer<typeof salesSummarySchema>;

export const dashboardSummarySchema = z.object({
  conversationsToday: z.number().int(),
  pendingHandoffs: z.number().int(),
  deflection: z.object({
    replied: z.number().int(),
    handedOff: z.number().int(),
    percent: z.number().nullable(),
  }),
  upcomingAppointments: z.array(appointmentSchema),
  sales: salesSummarySchema.optional(),
});
export type DashboardSummaryDto = z.infer<typeof dashboardSummarySchema>;
```

- [ ] **Step 2: Build the shared package so the API and web pick up the new types**

Run: `pnpm -F @waos/shared build`
Expected: exits 0. (If the shared package has no separate build and is consumed from source, this is a no-op that still exits 0; proceed either way.)

- [ ] **Step 3: Write the failing service test**

Create `apps/api/src/services/dashboard-service.test.ts`:

```ts
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { runWithRequestContext } from '../lib/context.js';

// vi.hoisted is required because the vi.mock factories below are hoisted
// above these consts; a plain top-level const referenced from inside a
// factory would throw a temporal-dead-zone ReferenceError otherwise.
const { aiReplyLogRepo, appointmentRepo, conversationRepo, orderRepo, organizationRepo, productRepo } =
  vi.hoisted(() => ({
    aiReplyLogRepo: { countsSince: vi.fn() },
    appointmentRepo: { upcoming: vi.fn() },
    conversationRepo: { countByStatusToday: vi.fn(), list: vi.fn() },
    orderRepo: { countCreatedSince: vi.fn(), sumAgreedSince: vi.fn(), countByStatus: vi.fn() },
    organizationRepo: { findCurrent: vi.fn() },
    productRepo: { countLowStock: vi.fn() },
  }));

vi.mock('../repositories/ai-reply-log-repository.js', () => ({ aiReplyLogRepository: aiReplyLogRepo }));
vi.mock('../repositories/appointment-repository.js', () => ({ appointmentRepository: appointmentRepo }));
vi.mock('../repositories/conversation-repository.js', () => ({ conversationRepository: conversationRepo }));
vi.mock('../repositories/order-repository.js', () => ({ orderRepository: orderRepo }));
vi.mock('../repositories/organization-repository.js', () => ({ organizationRepository: organizationRepo }));
vi.mock('../repositories/product-repository.js', () => ({ productRepository: productRepo }));

import { dashboardSummary } from './dashboard-service.js';

const ctx = { organizationId: 'org1', userId: 'u1', role: 'OWNER' as const };

beforeEach(() => {
  vi.clearAllMocks();
  conversationRepo.countByStatusToday.mockResolvedValue(0);
  conversationRepo.list.mockResolvedValue([]);
  aiReplyLogRepo.countsSince.mockResolvedValue({ replied: 0, handedOff: 0 });
  appointmentRepo.upcoming.mockResolvedValue([]);
  orderRepo.countCreatedSince.mockResolvedValue(0);
  orderRepo.sumAgreedSince.mockResolvedValue(0);
  orderRepo.countByStatus.mockResolvedValue(0);
  productRepo.countLowStock.mockResolvedValue(0);
});

describe('dashboardSummary', () => {
  it('includes sales KPIs for a shop organization', async () => {
    organizationRepo.findCurrent.mockResolvedValue({ id: 'org1', modules: ['shop'] });
    orderRepo.countCreatedSince.mockResolvedValue(3);
    orderRepo.sumAgreedSince.mockResolvedValue(120000);
    orderRepo.countByStatus.mockResolvedValue(2);
    productRepo.countLowStock.mockResolvedValue(4);

    const result = await runWithRequestContext(ctx, () => dashboardSummary());

    expect(result.sales).toEqual({
      ordersToday: 3,
      revenueAgreedThisWeek: 120000,
      pendingConfirmations: 2,
      lowStockCount: 4,
    });
    expect(orderRepo.countByStatus).toHaveBeenCalledWith('PENDING_CONFIRMATION');
    expect(orderRepo.sumAgreedSince).toHaveBeenCalledWith(expect.any(Date), ['CONFIRMED', 'PAID', 'FULFILLED']);
  });

  it('omits sales KPIs for an appointments-only organization', async () => {
    organizationRepo.findCurrent.mockResolvedValue({ id: 'org1', modules: ['appointments'] });

    const result = await runWithRequestContext(ctx, () => dashboardSummary());

    expect(result.sales).toBeUndefined();
    expect(orderRepo.countByStatus).not.toHaveBeenCalled();
    expect(productRepo.countLowStock).not.toHaveBeenCalled();
  });

  it('still returns booking stats and deflection percent', async () => {
    organizationRepo.findCurrent.mockResolvedValue({ id: 'org1', modules: ['appointments'] });
    conversationRepo.countByStatusToday.mockImplementation((status: string) =>
      Promise.resolve(status === 'OPEN' ? 5 : 2),
    );
    conversationRepo.list.mockResolvedValue([{ id: 'c1' }, { id: 'c2' }]);
    aiReplyLogRepo.countsSince.mockResolvedValue({ replied: 8, handedOff: 2 });

    const result = await runWithRequestContext(ctx, () => dashboardSummary());

    expect(result.conversationsToday).toBe(7);
    expect(result.pendingHandoffs).toBe(2);
    expect(result.deflection).toEqual({ replied: 8, handedOff: 2, percent: 80 });
  });
});
```

- [ ] **Step 4: Run the test to verify it fails**

Run: `pnpm -F @waos/api test -- dashboard-service`
Expected: FAIL. The suite errors or fails because `orderRepository.countCreatedSince` / `sumAgreedSince` / `countByStatus`, `productRepository.countLowStock`, and `result.sales` do not exist yet.

- [ ] **Step 5: Add the read-only aggregate methods to the order repository**

In `apps/api/src/repositories/order-repository.ts`, add these three methods inside the `orderRepository` object literal (alongside `list`, `updateStatus`, etc.). `OrderStatus` and `prisma` are already imported at the top of the file.

```ts
  /** Count orders created at or after `since` (e.g. the start of today). Read-only. */
  countCreatedSince(since: Date): Promise<number> {
    return prisma.order.count({ where: { createdAt: { gte: since } } });
  },

  /** Count orders currently in a given status. Read-only. */
  countByStatus(status: OrderStatus): Promise<number> {
    return prisma.order.count({ where: { status } });
  },

  /**
   * Sum `totalAgreed` over orders created at or after `since` whose status is
   * one of `statuses`. Returns 0 when nothing matches. Read-only.
   */
  async sumAgreedSince(since: Date, statuses: OrderStatus[]): Promise<number> {
    const result = await prisma.order.aggregate({
      _sum: { totalAgreed: true },
      where: { createdAt: { gte: since }, status: { in: statuses } },
    });
    return result._sum.totalAgreed ?? 0;
  },
```

- [ ] **Step 6: Add the low-stock count to the product repository**

In `apps/api/src/repositories/product-repository.ts`, add this method inside the `productRepository` object literal. `prisma` is already imported.

```ts
  /**
   * Count active products at or below their low-stock threshold. Prisma has
   * no column-to-column comparison in `where`, so the comparison runs in JS
   * over a lean projection. The catalog is small (MVP scale), so this stays
   * within the tenant-scoped client and avoids raw SQL. Read-only.
   */
  async countLowStock(): Promise<number> {
    const rows = await prisma.product.findMany({
      where: { isActive: true },
      select: { stockQty: true, lowStockThreshold: true },
    });
    return rows.filter((row) => row.stockQty <= row.lowStockThreshold).length;
  },
```

- [ ] **Step 7: Extend the dashboard service with the module-gated sales block**

Replace the full contents of `apps/api/src/services/dashboard-service.ts` with:

```ts
import type { OrderStatus } from '@prisma/client';
import type { AppointmentDto } from '@waos/shared';
import { aiReplyLogRepository } from '../repositories/ai-reply-log-repository.js';
import { appointmentRepository } from '../repositories/appointment-repository.js';
import { conversationRepository } from '../repositories/conversation-repository.js';
import { orderRepository } from '../repositories/order-repository.js';
import { organizationRepository } from '../repositories/organization-repository.js';
import { productRepository } from '../repositories/product-repository.js';
import { requireRequestContext } from '../lib/context.js';
import { appointmentService } from './appointment-service.js';

export interface SalesSummary {
  ordersToday: number;
  revenueAgreedThisWeek: number;
  pendingConfirmations: number;
  lowStockCount: number;
}

export interface DashboardSummary {
  conversationsToday: number;
  pendingHandoffs: number;
  deflection: { replied: number; handedOff: number; percent: number | null };
  upcomingAppointments: AppointmentDto[];
  sales?: SalesSummary;
}

// Orders whose value counts as "agreed" revenue: past the unconfirmed stage
// and not cancelled.
const CONFIRMED_SALE_STATUSES: OrderStatus[] = ['CONFIRMED', 'PAID', 'FULFILLED'];

async function salesSummary(weekAgo: Date): Promise<SalesSummary> {
  const startOfToday = new Date();
  startOfToday.setHours(0, 0, 0, 0);
  const [ordersToday, revenueAgreedThisWeek, pendingConfirmations, lowStockCount] = await Promise.all([
    orderRepository.countCreatedSince(startOfToday),
    orderRepository.sumAgreedSince(weekAgo, CONFIRMED_SALE_STATUSES),
    orderRepository.countByStatus('PENDING_CONFIRMATION'),
    productRepository.countLowStock(),
  ]);
  return { ordersToday, revenueAgreedThisWeek, pendingConfirmations, lowStockCount };
}

export async function dashboardSummary(): Promise<DashboardSummary> {
  const weekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
  const [openToday, pendingToday, pendingAll, counts, upcoming, organization] = await Promise.all([
    conversationRepository.countByStatusToday('OPEN'),
    conversationRepository.countByStatusToday('PENDING'),
    conversationRepository.list({ status: 'PENDING' }),
    aiReplyLogRepository.countsSince(weekAgo),
    appointmentRepository.upcoming(5),
    organizationRepository.findCurrent(requireRequestContext().organizationId),
  ]);
  const total = counts.replied + counts.handedOff;
  const summary: DashboardSummary = {
    conversationsToday: openToday + pendingToday,
    pendingHandoffs: pendingAll.length,
    deflection: {
      replied: counts.replied,
      handedOff: counts.handedOff,
      percent: total > 0 ? Math.round((counts.replied / total) * 100) : null,
    },
    upcomingAppointments: upcoming.map((appointment) => appointmentService.toDto(appointment)),
  };
  if (organization?.modules.includes('shop')) {
    summary.sales = await salesSummary(weekAgo);
  }
  return summary;
}
```

- [ ] **Step 8: Run the test to verify it passes**

Run: `pnpm -F @waos/api test -- dashboard-service`
Expected: PASS, all three tests green.

- [ ] **Step 9: Run the full API gate**

Run: `pnpm -F @waos/api typecheck && pnpm -F @waos/api test && pnpm lint`
Expected: typecheck clean, the full API suite green (the existing suite plus the three new dashboard tests), lint clean.

- [ ] **Step 10: Commit**

```bash
git add packages/shared/src/schemas/dashboard.ts \
  apps/api/src/repositories/order-repository.ts \
  apps/api/src/repositories/product-repository.ts \
  apps/api/src/services/dashboard-service.ts \
  apps/api/src/services/dashboard-service.test.ts
git commit -m "feat(api): additive sales KPIs on the dashboard summary for shop orgs"
```

---

### Task 2: Home dashboard restyle with sales KPIs

**Files:**
- Modify: `apps/web/src/app/[locale]/home/page.tsx` (full rewrite)
- Modify: `apps/web/messages/en.json`
- Modify: `apps/web/messages/sw.json`

**Interfaces:**
- Consumes: `getDashboardSummary(): Promise<DashboardSummaryDto>` from `@/lib/app-api` (now carries optional `sales`); `listOrders(filter?: { status?: OrderStatus; contactId?: string }): Promise<OrderDto[]>` from `@/lib/shop-api`; `queryKeys.dashboard` (`['dashboard']`) and `queryKeys.orders(status?, contactId?)` from `@/lib/query-keys`; `getStoredUser()` from `@/lib/api` (returns `{ user, organization }` where `organization.modules: string[]`); `AppShell`, and `EmptyState`, `ErrorBox`, `Skeleton`, `StatCard` from `@/components/ui`. `OrderDto.contact` is `{ id, name: string | null, phone }`; `OrderDto.totalAgreed` is a whole-TZS integer.
- Produces: no exports; this is a page.

- [ ] **Step 1: Add the new `homeDash` copy to the English locale**

In `apps/web/messages/en.json`, inside the existing `homeDash` object, add these keys (keep the existing keys; append these). Do not add a trailing comma after the last key of the object.

```json
      "ordersToday": "Orders today",
      "revenueWeek": "Revenue this week",
      "pendingConfirmations": "Awaiting confirmation",
      "lowStock": "Low stock",
      "pendingOrders": "Orders to confirm",
      "noPendingOrdersTitle": "No orders waiting.",
      "noPendingOrdersHint": "New orders from chat will appear here.",
      "ordersError": "Could not load orders. Check your connection."
```

- [ ] **Step 2: Add the matching Swahili copy**

In `apps/web/messages/sw.json`, inside the existing `homeDash` object, add the same keys with Swahili values:

```json
      "ordersToday": "Oda za leo",
      "revenueWeek": "Mapato ya wiki",
      "pendingConfirmations": "Zinasubiri uthibitisho",
      "lowStock": "Bidhaa zinazoisha",
      "pendingOrders": "Oda za kuthibitisha",
      "noPendingOrdersTitle": "Hakuna oda zinazosubiri.",
      "noPendingOrdersHint": "Oda mpya kutoka kwenye gumzo zitaonekana hapa.",
      "ordersError": "Imeshindwa kupakia oda. Angalia muunganisho wako."
```

- [ ] **Step 3: Rewrite the home page onto the new component layer**

Replace the full contents of `apps/web/src/app/[locale]/home/page.tsx` with:

```tsx
'use client';

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useLocale, useTranslations } from 'next-intl';
import { Link } from '@/i18n/navigation';
import { getStoredUser } from '@/lib/api';
import { getDashboardSummary } from '@/lib/app-api';
import { listOrders } from '@/lib/shop-api';
import { queryKeys } from '@/lib/query-keys';
import { AppShell } from '@/components/app-shell';
import { EmptyState, ErrorBox, Skeleton, StatCard } from '@/components/ui';

export default function HomeDashboardPage() {
  const t = useTranslations('homeDash');
  const locale = useLocale();
  // Lazy synchronous init mirrors AppShell so modules are known on first
  // paint (no flash of the wrong KPI set).
  const [modules] = useState<string[]>(() => getStoredUser()?.organization.modules ?? ['appointments']);
  const hasShop = modules.includes('shop');
  const hasAppointments = modules.includes('appointments');

  const {
    data: summary,
    isPending,
    isError,
    refetch,
  } = useQuery({
    queryKey: queryKeys.dashboard,
    queryFn: getDashboardSummary,
  });

  // Reuses the existing validated orders read and its query key; no new
  // contract. Fetched only for shop orgs.
  const pendingOrders = useQuery({
    queryKey: queryKeys.orders('PENDING_CONFIRMATION'),
    queryFn: () => listOrders({ status: 'PENDING_CONFIRMATION' }),
    enabled: hasShop,
  });

  const money = (value: number): string => `${value.toLocaleString(locale)} TZS`;

  return (
    <AppShell title={t('title')}>
      {isError ? (
        <ErrorBox message={t('loadError')} onRetry={() => void refetch()} retryLabel={t('retry')} />
      ) : isPending ? (
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          {Array.from({ length: hasShop ? 8 : 4 }).map((_, index) => (
            <Skeleton key={index} className="h-24" />
          ))}
        </div>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <StatCard tone="brand" label={t('conversationsToday')} value={String(summary.conversationsToday)} />
            <StatCard
              tone={summary.pendingHandoffs > 0 ? 'accent' : 'neutral'}
              label={t('pendingHandoffs')}
              value={String(summary.pendingHandoffs)}
            />
            <StatCard
              tone="brand"
              label={t('deflection')}
              value={summary.deflection.percent === null ? '--' : `${summary.deflection.percent}%`}
            />
            <StatCard
              tone="neutral"
              label={t('aiAnswersWeek')}
              value={String(summary.deflection.replied + summary.deflection.handedOff)}
            />
            {summary.sales ? (
              <>
                <StatCard tone="brand" label={t('ordersToday')} value={String(summary.sales.ordersToday)} />
                <StatCard tone="brand" label={t('revenueWeek')} value={money(summary.sales.revenueAgreedThisWeek)} />
                <StatCard
                  tone={summary.sales.pendingConfirmations > 0 ? 'accent' : 'neutral'}
                  label={t('pendingConfirmations')}
                  value={String(summary.sales.pendingConfirmations)}
                />
                <StatCard
                  tone={summary.sales.lowStockCount > 0 ? 'accent' : 'neutral'}
                  label={t('lowStock')}
                  value={String(summary.sales.lowStockCount)}
                />
              </>
            ) : null}
          </div>

          {hasShop ? (
            <section className="mt-6">
              <h2 className="mb-2 text-sm font-semibold text-brand-800">{t('pendingOrders')}</h2>
              {pendingOrders.isPending ? (
                <div className="space-y-2">
                  <Skeleton className="h-16" />
                  <Skeleton className="h-16" />
                </div>
              ) : pendingOrders.isError ? (
                <ErrorBox
                  message={t('ordersError')}
                  onRetry={() => void pendingOrders.refetch()}
                  retryLabel={t('retry')}
                />
              ) : (pendingOrders.data?.length ?? 0) === 0 ? (
                <EmptyState title={t('noPendingOrdersTitle')} hint={t('noPendingOrdersHint')} />
              ) : (
                <ul className="space-y-2">
                  {pendingOrders.data?.slice(0, 5).map((order) => (
                    <li key={order.id}>
                      <Link
                        href="/orders"
                        className="flex items-center justify-between rounded-2xl border border-brand-100 bg-white p-4 shadow-sm transition-colors hover:bg-brand-50"
                      >
                        <span className="font-semibold text-brand-950">
                          {order.contact.name ?? order.contact.phone}
                        </span>
                        <span className="text-sm font-medium text-brand-700">{money(order.totalAgreed)}</span>
                      </Link>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          ) : null}

          {hasAppointments ? (
            <section className="mt-6">
              <h2 className="mb-2 text-sm font-semibold text-brand-800">{t('upcoming')}</h2>
              {summary.upcomingAppointments.length === 0 ? (
                <EmptyState title={t('noUpcomingTitle')} hint={t('noUpcomingHint')} />
              ) : (
                <ul className="space-y-2">
                  {summary.upcomingAppointments.map((appointment) => (
                    <li
                      key={appointment.id}
                      className="rounded-2xl border border-brand-100 bg-white p-4 shadow-sm"
                    >
                      <p className="font-semibold text-brand-950">
                        {new Date(appointment.startsAt).toLocaleString(locale, {
                          weekday: 'short',
                          day: 'numeric',
                          month: 'short',
                          hour: '2-digit',
                          minute: '2-digit',
                        })}
                      </p>
                      <p className="text-sm text-brand-600">
                        {appointment.serviceName}, {appointment.contact.name ?? appointment.contact.phone}
                      </p>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          ) : null}
        </>
      )}
    </AppShell>
  );
}
```

Notes for the implementer:
- The page title now flows to `AppShell` via `title={t('title')}`, which `TopHeader` renders as the page `<h1>`. Do not add an in-content `<h1>`/`PageHeader` for the title; that would duplicate it.
- Amber (`tone="accent"`) is applied only to attention KPIs (handoffs waiting, pending confirmations, low stock) and only when the count is above zero, so amber stays a signal rather than decoration (spec section 3).
- A booking-only org sees four cards and the bookings strip. A shop-only org sees eight cards and the orders strip. An org with both sees eight cards and both strips. This is driven by `hasShop`/`hasAppointments`.

- [ ] **Step 4: Verify locale key parity**

Run: `pnpm lint`
Expected: PASS. The locale-parity lint rule confirms every new `homeDash` key exists in both `en.json` and `sw.json`. If it fails on a missing key, add the missing key to the other file.

- [ ] **Step 5: Run the web gate**

Run: `pnpm -F @waos/web typecheck && pnpm -F @waos/web build`
Expected: typecheck clean; build compiles with no type or lint errors.

- [ ] **Step 6: Commit**

```bash
git add "apps/web/src/app/[locale]/home/page.tsx" apps/web/messages/en.json apps/web/messages/sw.json
git commit -m "feat(web): restyle the home dashboard with module-aware sales KPIs"
```

---

### Task 3: Migrate the auth and onboarding screens to the new component layer

**Files (modify one import line each):**
- `apps/web/src/app/[locale]/login/page.tsx`
- `apps/web/src/app/[locale]/signup/page.tsx`
- `apps/web/src/app/[locale]/onboarding/profile/page.tsx`
- `apps/web/src/app/[locale]/onboarding/connect/page.tsx`
- `apps/web/src/app/[locale]/onboarding/knowledge/page.tsx`
- `apps/web/src/app/[locale]/onboarding/products/page.tsx`
- `apps/web/src/app/[locale]/onboarding/test/page.tsx`

**Interfaces:**
- Consumes: the new `@/components/ui` barrel. Every name these screens import (`Button`, `Card`, `ErrorBox`, `Field`, `Input`, `Skeleton`, `Badge`, `EmptyState`, `Spinner`) is exported by the new barrel with a drop-in-compatible API. `Button`'s new `variant` union (`primary | accent | secondary | destructive | ghost`) is a superset of the legacy one (`primary | secondary | ghost`), so existing usages type-check unchanged.
- Produces: nothing; these are pages.

The only change per file is the module specifier of the components import: replace `'@/components/ui-legacy'` with `'@/components/ui'`. The imported symbol list stays exactly as-is. Do NOT touch `OnboardingShell`, hooks, state, handlers, JSX, or any other import. The visual refresh (soft `brand-100` card borders, input and button focus rings) comes from the new components.

- [ ] **Step 1: Swap the import in login**

In `apps/web/src/app/[locale]/login/page.tsx`, change:
```tsx
import { Button, Card, ErrorBox, Field, Input } from '@/components/ui-legacy';
```
to:
```tsx
import { Button, Card, ErrorBox, Field, Input } from '@/components/ui';
```

- [ ] **Step 2: Swap the import in signup**

In `apps/web/src/app/[locale]/signup/page.tsx`, change:
```tsx
import { Button, Card, ErrorBox, Field, Input } from '@/components/ui-legacy';
```
to:
```tsx
import { Button, Card, ErrorBox, Field, Input } from '@/components/ui';
```

- [ ] **Step 3: Swap the import in onboarding/profile**

In `apps/web/src/app/[locale]/onboarding/profile/page.tsx`, change:
```tsx
import { Button, Card, ErrorBox, Field, Input, Skeleton } from '@/components/ui-legacy';
```
to:
```tsx
import { Button, Card, ErrorBox, Field, Input, Skeleton } from '@/components/ui';
```

- [ ] **Step 4: Swap the import in onboarding/connect**

In `apps/web/src/app/[locale]/onboarding/connect/page.tsx`, change:
```tsx
import { Badge, Button, Card, ErrorBox, Spinner } from '@/components/ui-legacy';
```
to:
```tsx
import { Badge, Button, Card, ErrorBox, Spinner } from '@/components/ui';
```

- [ ] **Step 5: Swap the import in onboarding/knowledge**

In `apps/web/src/app/[locale]/onboarding/knowledge/page.tsx`, change:
```tsx
import { Badge, Button, Card, EmptyState, ErrorBox, Field, Input, Skeleton } from '@/components/ui-legacy';
```
to:
```tsx
import { Badge, Button, Card, EmptyState, ErrorBox, Field, Input, Skeleton } from '@/components/ui';
```

- [ ] **Step 6: Swap the import in onboarding/products**

In `apps/web/src/app/[locale]/onboarding/products/page.tsx`, change:
```tsx
import { Button, Card, ErrorBox, Field, Input } from '@/components/ui-legacy';
```
to:
```tsx
import { Button, Card, ErrorBox, Field, Input } from '@/components/ui';
```

- [ ] **Step 7: Swap the import in onboarding/test**

In `apps/web/src/app/[locale]/onboarding/test/page.tsx`, change:
```tsx
import { Badge, Button, Card, ErrorBox, Field, Input } from '@/components/ui-legacy';
```
to:
```tsx
import { Badge, Button, Card, ErrorBox, Field, Input } from '@/components/ui';
```

- [ ] **Step 8: Confirm no legacy imports remain in these seven files**

Run: `git grep -n "components/ui-legacy" -- "apps/web/src/app/[locale]/login" "apps/web/src/app/[locale]/signup" "apps/web/src/app/[locale]/onboarding"`
Expected: no output. (Other screens outside login/signup/onboarding may still import `ui-legacy`; those migrate in C2c. `ui-legacy.tsx` itself is deleted in C2c, not here.)

- [ ] **Step 9: Run the web gate**

Run: `pnpm -F @waos/web typecheck && pnpm -F @waos/web build`
Expected: typecheck clean; build compiles. A type error here would mean a component API is not drop-in after all; reconcile the usage to the new component's props (do not fall back to `ui-legacy`).

- [ ] **Step 10: Commit**

```bash
git add "apps/web/src/app/[locale]/login/page.tsx" \
  "apps/web/src/app/[locale]/signup/page.tsx" \
  "apps/web/src/app/[locale]/onboarding/profile/page.tsx" \
  "apps/web/src/app/[locale]/onboarding/connect/page.tsx" \
  "apps/web/src/app/[locale]/onboarding/knowledge/page.tsx" \
  "apps/web/src/app/[locale]/onboarding/products/page.tsx" \
  "apps/web/src/app/[locale]/onboarding/test/page.tsx"
git commit -m "refactor(web): migrate auth and onboarding screens to the WaOS component layer"
```

---

## Self-Review

**1. Spec coverage (spec sections mapped to tasks):**
- Section 6 (home sales KPIs, module-aware grid, recent-activity strip, additive read-only API extension): Task 1 (API extension + Vitest test) and Task 2 (module-aware grid + activity strip). Booking businesses see the base four; shop businesses additionally see orders today, revenue this week, pending confirmations, low-stock; both-module orgs see both. Covered.
- Section 5 (every screen restyled on the new layer, consistent header/cards/states, data untouched): Task 2 (home) and Task 3 (login, signup, five onboarding steps). The remaining screens are C2c. Covered for wave 1.
- Section 9 (C2b scope = home + KPIs + API extension, login, signup, onboarding steps): exactly Tasks 1 to 3. Covered.
- Section 10 (presentation + additive-read only; locale parity; no em dash; strict TS; API extension gets a Vitest test; web gate is typecheck + lint + build + live drive): Global Constraints plus the per-task gate steps. Covered.
- Out of scope confirmed untouched: dark-mode toggle, landing page, `ui-legacy.tsx` deletion, forms polish, the other screens (all C2c or later). No task touches them.

**2. Placeholder scan:** No TBD/TODO/"handle edge cases"/"similar to Task N". Every code step shows complete code; every command step shows the exact command and expected result. The Swahili strings are concrete values, not placeholders.

**3. Type consistency:**
- `orderRepository.countCreatedSince(since: Date)`, `countByStatus(status: OrderStatus)`, `sumAgreedSince(since: Date, statuses: OrderStatus[])` and `productRepository.countLowStock()` are defined in Task 1 Steps 5 to 6 and called with matching arguments in Step 7 (`sumAgreedSince(weekAgo, CONFIRMED_SALE_STATUSES)`, `countByStatus('PENDING_CONFIRMATION')`). `OrderStatus` comes from `@prisma/client` in both the repo and the service.
- `SalesSummary` fields (`ordersToday`, `revenueAgreedThisWeek`, `pendingConfirmations`, `lowStockCount`) match `salesSummarySchema` (Step 1) and the object built in `salesSummary()` (Step 7) and the assertions in the test (Step 3).
- Task 2 reads `summary.sales?.{ordersToday,revenueAgreedThisWeek,pendingConfirmations,lowStockCount}` and `order.contact.name/phone`, `order.totalAgreed`, matching `DashboardSummaryDto` and `OrderDto`.
- Task 2 uses `listOrders` (the actual export name in `shop-api.ts`), not `getOrders`, and `queryKeys.orders('PENDING_CONFIRMATION')` / `queryKeys.dashboard`, which both already exist.
- Task 3 imported names are each present in the `@/components/ui` barrel (`index.ts`), and `Button`'s variant union is a superset of the legacy one, so no usage breaks.

No issues found; plan is internally consistent.
