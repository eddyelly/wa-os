# Revamp Phase B2: Shop Web Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give the B1 shop backend its dashboard: Products and Orders screens, a realtime notification bell, the shop onboarding step, shop settings, plus the backend carry-overs the B1 final review earmarked.

**Architecture:** One backend carry-over task first (notification producer for handoffs, low-stock on manual edits, order-line aggregation, MulterError mapping, orders contactId filter), then web work built on the existing hand-rolled patterns: a typed `lib/shop-api.ts` layer that runtime-parses responses with the shared Zod schemas, module-gated `/products` and `/orders` pages following the appointments-page idioms, a notification bell in `AppShell` fed by the `notification.new` socket event, a new onboarding products step with an adaptive five-step trail, and an owner-only shop settings card. No new dependencies; TanStack Query and the visual redesign stay in Phase C.

**Tech Stack:** Next.js 15 App Router, React 19, Tailwind v4, next-intl (en+sw), socket.io-client, `@waos/shared` Zod schemas, Vitest (API only; the web app has no test tooling).

**Specs:** `docs/superpowers/specs/2026-07-11-waos-revamp-master-design.md` sections 4, 7, 8; B1 ledger carry-list. B1 endpoints (all live): `GET/POST /api/v1/products`, `PATCH/DELETE /api/v1/products/:id`, `POST /api/v1/products/:id/images` (multipart `file`), `DELETE /api/v1/products/:id/images/:imageId`, `GET /api/v1/orders?status=`, `POST /api/v1/orders/:id/status` `{ status }`, `GET /api/v1/notifications?unread=1`, `POST /api/v1/notifications/:id/read`, `POST /api/v1/notifications/read-all`, `PATCH /api/v1/organization/shop-settings`. Socket event: `notification.new` `{ notificationId, type }`.

## Global Constraints

- TypeScript `strict: true`; `any` forbidden. No em dashes anywhere. Conventional commits. No floating promises.
- Every user-facing string exists in BOTH `apps/web/messages/en.json` and `sw.json` with identical key sets (drift is failure). The i18n JSON blocks in this plan are VERBATIM content.
- Shop screens and nav tabs are gated on the `shop` module via the stored session (`getStoredUser()?.organization.modules ?? ['appointments']`); the API already 403s with `MODULE_DISABLED`.
- Money renders as whole TZS with `toLocaleString(locale)` plus the literal suffix ` TZS`; never parse floats from money inputs (`parseInt`, reject NaN/<=0).
- Web verification per task: `pnpm -F @waos/web typecheck && pnpm lint` plus a live drive (dev server + curl round-trip + headless screenshot where reachable); the API carry-over task uses full TDD.
- Backend layering and tenancy rules unchanged (CLAUDE.md 5, 13). The FLOOR value (minPrice) is owner-facing here: it DOES render on the Products screen; it still never goes anywhere near the AI.
- Local env: Postgres 5433, Redis 6380; docker infra up; demo org has both modules and two seeded products; a real WhatsApp channel may be CONNECTED (do not send test messages to it).
- All checks green at every commit: `pnpm typecheck && pnpm lint && pnpm -F @waos/api test`.

## Existing web idioms (verified; copy these)

- `apiFetch<T>(path, opts?)` and `apiUpload<T>(path, formData)` in `apps/web/src/lib/api.ts` (auto-refresh on 401; `body` passed as object, NOT pre-stringified). `updateStoredOrganization(patch)` syncs the session.
- Page skeleton: `apps/web/src/app/[locale]/appointments/page.tsx` (AppShell, load/error/empty states, `Skeleton`/`EmptyState`/`ErrorBox` from `components/ui`, form Cards).
- Upload: `apps/web/src/app/[locale]/onboarding/knowledge/page.tsx` (file input + `apiUpload`).
- Nav: `apps/web/src/components/app-shell.tsx` `navItems` with `requiredModule?: BusinessModule`.
- Onboarding: `apps/web/src/components/onboarding-shell.tsx` (`step?: number`, four labels from the `wizard` namespace, `StepCircle` trail); connect page routes `Continue` to `/onboarding/knowledge`.
- Socket: `getSocket()` from `lib/socket.ts`; listener effect pattern per `apps/web/src/app/[locale]/inbox/page.tsx:75-90`.

---

### Task 1: Backend carry-overs from the B1 final review

**Files:**
- Modify: `apps/api/src/workers/ai-reply-worker.ts` (HANDOFF notification producer)
- Modify: `apps/api/src/services/product-service.ts` (low-stock on manual stock edits)
- Modify: `apps/api/src/services/order-service.ts` (aggregate duplicate product lines)
- Modify: `apps/api/src/middleware/error-handler.ts` (MulterError mapping)
- Modify: `apps/api/src/repositories/order-repository.ts` + `apps/api/src/services/order-service.ts` + `apps/api/src/controllers/order-controller.ts` (optional `contactId` filter on list)
- Modify: `apps/api/src/repositories/product-repository.ts:153` area (`list()` images orderBy)
- Tests: extend `order-service.test.ts`, `product-service.test.ts`, new `apps/api/src/middleware/error-handler.test.ts`

**Interfaces:**
- Consumes: `notificationService.notify` (best-effort pattern from order-service), `parseOrgAiSettings`, `productRepository.adjustStock`-style crossing math, `MulterError` from `multer`.
- Produces (web tasks rely on):
  - HANDOFF notifications: on the worker's handoff path (decision HANDOFF), after the PENDING flip, best-effort `notify('HANDOFF', { conversationId, contactName })` (try/catch, ids-only warn).
  - `orderService.list(status?, contactId?)` and `GET /api/v1/orders?status=&contactId=` (both optional, combinable).
  - Manual stock edits fire LOW_STOCK on downward crossings only: in `productService.update`, when the payload contains `stockQty` and `newQty <= threshold && oldQty > threshold`, best-effort `notify('LOW_STOCK', { productId, name, stockQty: newQty })` (threshold = payload value if present else stored).
  - `createFromAgent` aggregates items by productId before stock validation (quantities summed; agreedPrice must be identical across duplicate lines else ValidationError('conflicting prices for the same product')); order items stored aggregated.
  - Oversized/invalid uploads: `error instanceof MulterError` maps to 400 `{ error: { code: 'UPLOAD_INVALID', message: <multer message> } }` (before the AppError branch).
  - `productRepository.list` images include gains `orderBy: { createdAt: 'asc' }`.

- [ ] **Step 1: Failing tests** (all as real tests):

```ts
// order-service.test.ts additions:
// 1. createFromAgent merges two lines of the same product (qty 1 + qty 2 -> one item qty 3) and validates the SUM against stockQty
// 2. createFromAgent rejects duplicate lines with differing agreedPrice (ValidationError)
// 3. list passes contactId through to the repository when provided
// product-service.test.ts additions:
// 4. update crossing down (stored qty 6 threshold 5 -> payload qty 4) fires notify LOW_STOCK once
// 5. update already below (stored 3 -> payload 2) does NOT notify; upward edit never notifies
// 6. notify rejection does not fail update (best-effort)
// error-handler.test.ts (new; construct a MulterError('LIMIT_FILE_SIZE') and call the handler with mock res):
// 7. maps to 400 UPLOAD_INVALID; a plain Error still maps to 500 INTERNAL_ERROR
// ai-reply worker: extend the guard test file with a pure-helper test if you extract one for the
// handoff-notify decision, else cover via the worker path in the report (the notify call itself
// is best-effort try/catch identical to order-service's reviewed pattern).
```

- [ ] **Step 2: RED**, **Step 3: implement** (HANDOFF producer goes right after the existing `conversationRepository.updateStatus(...PENDING...)` in the worker's handoff branch; contact name comes from the already-loaded conversation), **Step 4: GREEN + full gate**, **Step 5: Commit**

```bash
git add -A && git commit -m "feat(shop): handoff notifications, manual-edit low stock, order-line aggregation, upload error mapping"
```

---

### Task 2: Typed web API layer for the shop

**Files:**
- Create: `apps/web/src/lib/shop-api.ts`

**Interfaces:**
- Consumes: `apiFetch`/`apiUpload` from `./api`; `productSchema`, `orderSchema`, `notificationSchema`, and their Dto types plus `OrderStatus` from `@waos/shared`.
- Produces (pages import these EXACT names):

```ts
export async function listProducts(includeInactive?: boolean): Promise<ProductDto[]>;
export async function createProduct(input: {
  name: string; description?: string; price: number; minPrice?: number;
  stockQty: number; lowStockThreshold: number;
}): Promise<ProductDto>;
export async function updateProduct(id: string, input: Partial<{
  name: string; description: string | null; price: number; minPrice: number | null;
  stockQty: number; lowStockThreshold: number; isActive: boolean;
}>): Promise<ProductDto>;
export async function deleteProduct(id: string): Promise<void>;
export async function uploadProductImage(id: string, file: File): Promise<ProductDto>;
export async function removeProductImage(id: string, imageId: string): Promise<ProductDto>;
export async function listOrders(filter?: { status?: OrderStatus; contactId?: string }): Promise<OrderDto[]>;
export async function setOrderStatus(id: string, status: OrderStatus): Promise<OrderDto>;
export async function listNotifications(unreadOnly?: boolean): Promise<NotificationDto[]>;
export async function markNotificationRead(id: string): Promise<void>;
export async function markAllNotificationsRead(): Promise<void>;
export async function updateShopSettings(input: {
  paymentInstructions?: string; ownerAlertPhone?: string | null; ownerAlertsEnabled?: boolean;
}): Promise<void>;
```

Every list/detail response is runtime-parsed (e.g. `z.array(productSchema).parse(raw.products)`); this is the phase's step toward the master design's "response shapes runtime-validated" goal without waiting for Phase C. Example to copy for all fetchers:

```ts
export async function listProducts(includeInactive = false): Promise<ProductDto[]> {
  const raw = await apiFetch<unknown>(
    `/api/v1/products${includeInactive ? '?includeInactive=1' : ''}`,
  );
  return z.array(productSchema).parse((raw as { products: unknown }).products);
}
```

(`uploadProductImage` builds `FormData` with `formData.append('file', file)` and uses `apiUpload`.)

- [ ] **Step 1: Implement the module** (no web test infra; the gate is `pnpm -F @waos/web typecheck && pnpm lint`).
- [ ] **Step 2: Verify the parse layer live**: with `pnpm dev` running, a quick node-free check is impossible from the browser side; instead curl the API endpoints with the demo token and confirm each response body parses against the shared schemas via a throwaway `npx tsx` script in `/tmp/claude-1000/` that imports `@waos/shared` from the workspace and parses the curl outputs for products, orders, notifications. Record the output.
- [ ] **Step 3: Commit**

```bash
git add apps/web/src/lib/shop-api.ts && git commit -m "feat(web): typed runtime-validated shop api layer"
```

---

### Task 3: Products screen

**Files:**
- Create: `apps/web/src/app/[locale]/products/page.tsx`
- Modify: `apps/web/src/components/app-shell.tsx` (nav gains Products + Orders tabs, both `requiredModule: 'shop'`)
- Modify: `apps/web/messages/en.json`, `apps/web/messages/sw.json` (new `products` namespace + `nav.products`, `nav.orders`)

**Interfaces:**
- Consumes: Task 2 fetchers; `AppShell` (plain, not wide); ui primitives; `useIsDesktop` NOT needed.
- Produces: `/products` page; nav tabs (Orders tab targets Task 4's page; adding both nav entries here avoids two AppShell edits).

Page requirements (follow `appointments/page.tsx` structure):
- Load: `listProducts(true)`; loading `Skeleton`x3; `ErrorBox` retry; `EmptyState` with hint to add the first product.
- List: Card per product: first image thumbnail (`img` h-16 w-16 rounded, or a neutral placeholder div when none), name, price (`{price.toLocaleString(locale)} TZS`), floor shown as `t('floorLabel')`: value or `t('noFloor')`, stock badge (tone danger when `stockQty <= lowStockThreshold`, else neutral), inactive badge when `!isActive`, tags line.
- Row actions: Edit (loads values into the form), Activate/Deactivate toggle (`updateProduct(id, { isActive: !p.isActive })`), Delete (confirm via `window.confirm(t('deleteConfirm'))`), image add (hidden file input, `uploadProductImage`, busy state) and per-image remove buttons.
- Add/Edit form Card (top of page, mirrors appointments form): fields name, description (textarea), price, minPrice (optional, hint explains bargaining floor), stockQty, lowStockThreshold; integers validated client-side (`Number.parseInt`, reject NaN/<=0 for prices, <0 for stock); submit -> create or update -> reset form -> reload; `formError` on ApiError.

- [ ] **Step 1: i18n first** (BOTH locales; verbatim):

`en.json`: add to `nav`: `"products": "Products", "orders": "Orders"`. New top-level namespace after `contacts`:

```json
"products": {
  "title": "Products",
  "addTitle": "Add a product",
  "editTitle": "Edit product",
  "name": "Product name",
  "description": "Description",
  "descriptionHint": "What the AI tells customers about this product.",
  "price": "Price (TZS)",
  "minPrice": "Lowest acceptable price (TZS)",
  "minPriceHint": "The AI can bargain down to this price but never below it. Customers never see it. Leave empty for a fixed price.",
  "stockQty": "In stock",
  "lowStockThreshold": "Alert me when stock reaches",
  "save": "Save product",
  "saving": "Saving...",
  "cancelEdit": "Cancel",
  "floorLabel": "Floor",
  "noFloor": "Fixed price",
  "inactive": "Hidden",
  "activate": "Show",
  "deactivate": "Hide",
  "edit": "Edit",
  "delete": "Delete",
  "deleteConfirm": "Delete this product? Existing orders keep their copy of it.",
  "addImage": "Add photo",
  "removeImage": "Remove",
  "uploading": "Uploading...",
  "stockBadge": "{count} in stock",
  "emptyTitle": "No products yet",
  "emptyHint": "Add your first product and the AI can start selling it.",
  "loadError": "Could not load products. Check your connection and try again.",
  "saveError": "Could not save. Check the values and try again.",
  "retry": "Try again",
  "invalidNumbers": "Prices must be whole numbers above zero."
}
```

`sw.json`: same keys:

```json
"products": {
  "title": "Bidhaa",
  "addTitle": "Ongeza bidhaa",
  "editTitle": "Hariri bidhaa",
  "name": "Jina la bidhaa",
  "description": "Maelezo",
  "descriptionHint": "AI inachowaambia wateja kuhusu bidhaa hii.",
  "price": "Bei (TZS)",
  "minPrice": "Bei ya chini kabisa (TZS)",
  "minPriceHint": "AI inaweza kupunguza bei hadi kiwango hiki lakini kamwe si chini yake. Wateja hawakioni. Acha wazi kwa bei isiyobadilika.",
  "stockQty": "Zilizopo",
  "lowStockThreshold": "Nitaarifu stoki ikifika",
  "save": "Hifadhi bidhaa",
  "saving": "Inahifadhi...",
  "cancelEdit": "Ghairi",
  "floorLabel": "Kikomo",
  "noFloor": "Bei isiyobadilika",
  "inactive": "Imefichwa",
  "activate": "Onyesha",
  "deactivate": "Ficha",
  "edit": "Hariri",
  "delete": "Futa",
  "deleteConfirm": "Ufute bidhaa hii? Oda zilizopo zinabaki na nakala yake.",
  "addImage": "Ongeza picha",
  "removeImage": "Ondoa",
  "uploading": "Inapakia...",
  "stockBadge": "{count} stoki",
  "emptyTitle": "Hakuna bidhaa bado",
  "emptyHint": "Ongeza bidhaa yako ya kwanza ili AI ianze kuiuza.",
  "loadError": "Imeshindwa kupakia bidhaa. Angalia muunganisho wako kisha ujaribu tena.",
  "saveError": "Imeshindwa kuhifadhi. Angalia thamani kisha ujaribu tena.",
  "retry": "Jaribu tena",
  "invalidNumbers": "Bei lazima ziwe namba nzima zaidi ya sifuri."
}
```

`nav` sw: `"products": "Bidhaa", "orders": "Oda"`.

- [ ] **Step 2: nav tabs** in `app-shell.tsx` (`{ href: '/products', label: t('products'), requiredModule: 'shop' }, { href: '/orders', label: t('orders'), requiredModule: 'shop' }` between appointments and contacts).
- [ ] **Step 3: build the page**, **Step 4: verify** (`pnpm -F @waos/web typecheck && pnpm lint`; live: with dev running and the demo owner token, confirm the two seeded products render by API round-trip: create one product via the UI-equivalent curl POST, reload list; screenshot `http://localhost:3000/en/products` unauthenticated redirect as liveness + note the authed check), **Step 5: Commit**

```bash
git add -A && git commit -m "feat(web): products screen with images, stock, and bargaining floor"
```

---

### Task 4: Orders screen

**Files:**
- Create: `apps/web/src/app/[locale]/orders/page.tsx`
- Modify: `apps/web/messages/en.json`, `apps/web/messages/sw.json` (new `orders` namespace)

**Interfaces:**
- Consumes: Task 2 `listOrders`/`setOrderStatus`; socket `notification.new` for live refresh; legal transitions map (mirror of the backend): PENDING_CONFIRMATION -> CONFIRMED|CANCELLED; CONFIRMED -> PAID|FULFILLED|CANCELLED; PAID -> FULFILLED|CANCELLED; terminal states none.
- Produces: `/orders` page (nav tab already added in Task 3).

Page requirements:
- Filter chips ALL + the five statuses (like inbox filters); list newest-first as the API returns.
- Order Card: short id (`#` + last 6), status badge (warning for PENDING_CONFIRMATION, success for CONFIRMED/PAID/FULFILLED, neutral for CANCELLED), contact name/phone, per-item lines `{quantity} x {productName}` with agreedPrice (strikethrough listPrice beside it when different), `totalAgreed` in bold TZS, createdAt via `toLocaleString(locale)`, link `t('viewChat')` to `/inbox/${conversationId}` when conversationId non-null.
- Action buttons rendered from the transitions map: labels confirm/markPaid/fulfil/cancel; cancel wrapped in `window.confirm(t('cancelConfirm'))`; on action -> `setOrderStatus` -> reload; conflict ValidationError from the TOCTOU guard surfaces via `ErrorBox` (message passthrough) + reload.
- Socket effect: refresh on `notification.new` (any type; cheap) plus on window focus? NO focus handler (YAGNI): socket only.
- i18n (BOTH locales, verbatim):

`en.json`:

```json
"orders": {
  "title": "Orders",
  "filterAll": "All",
  "statusPENDING_CONFIRMATION": "Needs confirmation",
  "statusCONFIRMED": "Confirmed",
  "statusPAID": "Paid",
  "statusFULFILLED": "Fulfilled",
  "statusCANCELLED": "Cancelled",
  "confirm": "Confirm order",
  "markPaid": "Mark paid",
  "fulfil": "Mark fulfilled",
  "cancel": "Cancel order",
  "cancelConfirm": "Cancel this order? Stock returns if it was already confirmed.",
  "viewChat": "Open the chat",
  "total": "Total",
  "emptyTitle": "No orders yet",
  "emptyHint": "When the AI closes a sale, the order lands here for you to confirm.",
  "loadError": "Could not load orders. Check your connection and try again.",
  "retry": "Try again"
}
```

`sw.json`:

```json
"orders": {
  "title": "Oda",
  "filterAll": "Zote",
  "statusPENDING_CONFIRMATION": "Inahitaji uthibitisho",
  "statusCONFIRMED": "Imethibitishwa",
  "statusPAID": "Imelipwa",
  "statusFULFILLED": "Imekamilika",
  "statusCANCELLED": "Imeghairiwa",
  "confirm": "Thibitisha oda",
  "markPaid": "Weka imelipwa",
  "fulfil": "Weka imekamilika",
  "cancel": "Ghairi oda",
  "cancelConfirm": "Ughairi oda hii? Stoki inarudi ikiwa ilishathibitishwa.",
  "viewChat": "Fungua mazungumzo",
  "total": "Jumla",
  "emptyTitle": "Hakuna oda bado",
  "emptyHint": "AI ikifunga mauzo, oda inafika hapa ili uithibitishe.",
  "loadError": "Imeshindwa kupakia oda. Angalia muunganisho wako kisha ujaribu tena.",
  "retry": "Jaribu tena"
}
```

- [ ] **Step 1: i18n**, **Step 2: build**, **Step 3: verify** (typecheck/lint; live: create an order via `orderService.createFromAgent`-equivalent curl is not exposed: instead insert one via a small `npx tsx` script in `/tmp/claude-1000/` that calls `orderService.createFromAgent` inside `runWithRequestContext` against the dev DB for the demo org, then confirm it through the REAL API: `POST /api/v1/orders/:id/status {"status":"CONFIRMED"}` and check stock dropped via GET products; leave the test order CANCELLED afterward to restore stock), **Step 4: Commit**

```bash
git add -A && git commit -m "feat(web): orders screen with guarded status transitions"
```

---

### Task 5: Notification bell in AppShell

**Files:**
- Create: `apps/web/src/components/notification-bell.tsx`
- Modify: `apps/web/src/components/app-shell.tsx` (render the bell in the header, before the org name)
- Modify: `apps/web/messages/en.json`, `apps/web/messages/sw.json` (new `notifications` namespace)

**Interfaces:**
- Consumes: Task 2 `listNotifications`/`markNotificationRead`/`markAllNotificationsRead`; `getSocket()`; router from `@/i18n/navigation`.
- Produces: `<NotificationBell />` client component.

Requirements:
- Bell button (inline SVG bell icon, h-5 w-5) with an absolute-positioned unread-count badge (accent bg, hidden when 0, caps at `9+`).
- On mount + on every `notification.new` socket event: `listNotifications(true)` to refresh the unread count and cached list.
- Click toggles a dropdown panel (absolute right-0, Card-like, max-h-96 overflow-y-auto, z-20; closes on outside click via a `useEffect` document listener). Panel lists up to 50 latest (fetch `listNotifications(false)` when opened): per item an icon-free two-line row: title by type (`t('typeNEW_ORDER')` etc.), `createdAt` time, unread dot when `readAt === null`.
- Item click: `markNotificationRead(id)` then navigate: NEW_ORDER -> `/orders`, LOW_STOCK -> `/products`, HANDOFF -> `/inbox/${String(payload.conversationId ?? '')}` when present else `/inbox`. Payload is `Record<string, unknown>`: narrow safely.
- Header: `t('markAllRead')` button when any unread.
- The bell renders for ALL orgs (notifications are not module-gated; handoffs matter to appointment orgs).

i18n `en.json`:

```json
"notifications": {
  "label": "Notifications",
  "markAllRead": "Mark all read",
  "emptyTitle": "Nothing yet",
  "emptyHint": "Order and stock alerts appear here.",
  "typeNEW_ORDER": "New order recorded",
  "typeLOW_STOCK": "Stock is running low",
  "typeHANDOFF": "A customer needs a human"
}
```

`sw.json`:

```json
"notifications": {
  "label": "Arifa",
  "markAllRead": "Weka zote zimesomwa",
  "emptyTitle": "Hakuna kitu bado",
  "emptyHint": "Arifa za oda na stoki zinaonekana hapa.",
  "typeNEW_ORDER": "Oda mpya imerekodiwa",
  "typeLOW_STOCK": "Stoki inakaribia kuisha",
  "typeHANDOFF": "Mteja anahitaji binadamu"
}
```

- [ ] **Step 1: i18n**, **Step 2: build the component + mount in AppShell**, **Step 3: verify** (typecheck/lint; live: trigger a LOW_STOCK by editing a product's stock below threshold via curl PATCH, then GET /api/v1/notifications shows the row: the bell consumes the same endpoint; screenshot liveness), **Step 4: Commit**

```bash
git add -A && git commit -m "feat(web): realtime notification bell"
```

---

### Task 6: Onboarding products step with an adaptive trail

**Files:**
- Create: `apps/web/src/app/[locale]/onboarding/products/page.tsx`
- Modify: `apps/web/src/components/onboarding-shell.tsx` (five-step variant)
- Modify: `apps/web/src/app/[locale]/onboarding/connect/page.tsx` (Continue routes by module)
- Modify: `apps/web/messages/en.json`, `apps/web/messages/sw.json` (`wizard.stepProducts`, `onboardingProducts` namespace, and the two copy fixes below)

**Interfaces:**
- Consumes: Task 2 `listProducts`/`createProduct`; `getStoredUser` modules; `OnboardingShell`.
- Produces: `/onboarding/products` reachable only for shop orgs; trail shows 5 steps for shop orgs.

Requirements:
- `OnboardingShell` gains `includeProducts?: boolean`. Labels array: `[stepProfile, stepConnect, ...(includeProducts ? [stepProducts] : []), stepKnowledge, stepTest]`. `step` remains an index into THAT array. Update ALL existing onboarding pages to pass `includeProducts` (derive from stored modules: `const shopOrg = (getStoredUser()?.organization.modules ?? []).includes('shop')`) and shift their indices: profile 0, connect 1, products 2 (shop only), knowledge `shopOrg ? 3 : 2`, test `shopOrg ? 4 : 3`.
- Connect page: `router.push(shopOrg ? '/onboarding/products' : '/onboarding/knowledge')` on Continue.
- Products step page: guard `getTokens()` redirect (mirror knowledge page); if NOT shopOrg, `router.replace('/onboarding/knowledge')`. Quick-add form (name, price, optional minPrice, stockQty; NO images here: keep the step light, hint says photos can be added later in Products) + list of already-added products (name + price) + two buttons: `t('addAnother')` (submit + stay) and `t('continue')` (to `/onboarding/knowledge`); skip link `t('skip')` also to knowledge.
- Copy fixes (both locales): `settings.moduleShop` drops the suffix: en `"Shop and selling"`, sw `"Duka na mauzo"`; `onboarding.modules_shopHint`: en `"A catalog your AI sells from, bargains included."`, sw `"Katalogi ambayo AI yako inauzia, ikiwemo majadiliano ya bei."`.

i18n `wizard`: en `"stepProducts": "Products"`, sw `"stepProducts": "Bidhaa"`. New namespace `onboardingProducts` en:

```json
"onboardingProducts": {
  "title": "Add your first products",
  "subtitle": "Give the AI something to sell. You can add photos and more products later under Products.",
  "name": "Product name",
  "price": "Price (TZS)",
  "minPrice": "Lowest acceptable price (TZS, optional)",
  "minPriceHint": "The AI bargains down to this but never below. Customers never see it.",
  "stockQty": "In stock",
  "addAnother": "Add and add another",
  "continue": "Continue",
  "skip": "Skip for now",
  "added": "Added so far",
  "saveError": "Could not save this product. Check the values and try again.",
  "invalidNumbers": "Prices must be whole numbers above zero."
}
```

sw:

```json
"onboardingProducts": {
  "title": "Ongeza bidhaa zako za kwanza",
  "subtitle": "Ipe AI kitu cha kuuza. Unaweza kuongeza picha na bidhaa zaidi baadaye kwenye Bidhaa.",
  "name": "Jina la bidhaa",
  "price": "Bei (TZS)",
  "minPrice": "Bei ya chini kabisa (TZS, si lazima)",
  "minPriceHint": "AI inajadili bei hadi kiwango hiki lakini kamwe si chini yake. Wateja hawakioni.",
  "stockQty": "Zilizopo",
  "addAnother": "Ongeza kisha ongeza nyingine",
  "continue": "Endelea",
  "skip": "Ruka kwa sasa",
  "added": "Zilizoongezwa",
  "saveError": "Imeshindwa kuhifadhi bidhaa hii. Angalia thamani kisha ujaribu tena.",
  "invalidNumbers": "Bei lazima ziwe namba nzima zaidi ya sifuri."
}
```

- [ ] **Step 1: i18n + copy fixes**, **Step 2: OnboardingShell variant + existing page index updates**, **Step 3: the new page + connect routing**, **Step 4: verify** (typecheck/lint; live: fresh signup with shop module via API, walk profile->connect pages by URL and confirm the 5-step trail renders in a headless screenshot of an UNAUTH page is impossible: verify trail logic via the shell's props in code + authed API walk; confirm `/onboarding/products` for an appointments-only org redirects to knowledge), **Step 5: Commit**

```bash
git add -A && git commit -m "feat(onboarding): products quick-add step with an adaptive trail"
```

---

### Task 7: Shop settings section

**Files:**
- Modify: `apps/web/src/app/[locale]/settings/page.tsx` (new owner-only, shop-gated card)
- Modify: `apps/web/messages/en.json`, `apps/web/messages/sw.json` (`settings` namespace additions)

**Interfaces:**
- Consumes: Task 2 `updateShopSettings`; existing settings-page idioms (isOwner, notice/error state); org settings from the existing GET (extend the local `OrganizationResponse` settings type with `paymentInstructions?: string; ownerAlertPhone?: string | null; ownerAlertsEnabled?: boolean`).
- Produces: settings card "Selling" visible when `isOwner && modules.includes('shop')`: paymentInstructions textarea (hint: sent to customers when an order is recorded), ownerAlertPhone input (placeholder `+2557...`), ownerAlertsEnabled checkbox (disabled when phone empty), save button -> `updateShopSettings` -> notice.

i18n `settings` additions en:

```json
"shopSection": "Selling",
"paymentInstructions": "Payment instructions",
"paymentInstructionsHint": "The AI sends this after recording an order, e.g. your Lipa Namba.",
"ownerAlertPhone": "WhatsApp number for alerts",
"ownerAlertPhoneHint": "Your own number. New orders and low stock get sent there.",
"ownerAlertsEnabled": "Send me WhatsApp alerts"
```

sw:

```json
"shopSection": "Mauzo",
"paymentInstructions": "Maelekezo ya malipo",
"paymentInstructionsHint": "AI inayatuma baada ya kurekodi oda, mfano Lipa Namba yako.",
"ownerAlertPhone": "Namba ya WhatsApp kwa arifa",
"ownerAlertPhoneHint": "Namba yako mwenyewe. Oda mpya na stoki pungufu vinatumwa huko.",
"ownerAlertsEnabled": "Nitumie arifa za WhatsApp"
```

- [ ] **Step 1: i18n**, **Step 2: build**, **Step 3: verify** (typecheck/lint; live: PATCH round-trip via curl, GET organization shows merged settings), **Step 4: Commit**

```bash
git add -A && git commit -m "feat(web): shop settings with payment instructions and owner alerts"
```

---

### Task 8: Order linkage in the conversation thread

**Files:**
- Modify: `apps/web/src/components/conversation-thread.tsx`

**Interfaces:**
- Consumes: Task 2 `listOrders({ contactId })`; Task 1's contactId filter; stored-session modules.
- Produces: in the thread header controls row, for shop orgs only: when the conversation's contact has orders, a chip `Link` to `/orders` labeled with `t('ordersChip', { count })` (add to `thread` namespace: en `"ordersChip": "Orders ({count})"`, sw `"ordersChip": "Oda ({count})"`). Fetch once when the conversation loads (piggyback in the existing `load()` Promise.all only when shop org; store `orderCount`). Zero orders -> no chip.

- [ ] **Step 1: i18n + implementation**, **Step 2: verify** (typecheck/lint), **Step 3: Commit**

```bash
git add -A && git commit -m "feat(web): surface a contact's orders from the conversation thread"
```

---

### Task 9: Docs sync and whole-phase verification

**Files:**
- Modify: `README.md` (dashboard feature list mentions Products/Orders/bell)
- Modify: `CLAUDE.md` section 8 (one sentence: the dashboard surfaces orders for confirmation and notifications over `notification.new`)

- [ ] **Step 1: docs edits** (no em dashes; protected rules untouched).
- [ ] **Step 2: whole-phase verification**:

```bash
pnpm typecheck && pnpm lint && pnpm -F @waos/api test
INTEGRATION_DATABASE_URL=postgresql://waos:waos@localhost:5433/waos_dev pnpm -F @waos/api test
node -e "const en=require('./apps/web/messages/en.json'),sw=require('./apps/web/messages/sw.json');const k=o=>{const r=[];const w=(x,p)=>{for(const[key,v]of Object.entries(x)){if(typeof v==='object')w(v,p+key+'.');else r.push(p+key)}};w(o,'');return new Set(r)};const a=k(en),b=k(sw);const d=[...a].filter(x=>!b.has(x)).concat([...b].filter(x=>!a.has(x)));console.log(d.length===0?'locale parity OK':'DRIFT: '+d.join(', '))"
pnpm -F @waos/web build
```

All green; locale parity OK; the web production build must succeed.
- [ ] **Step 3: Commit**

```bash
git add README.md CLAUDE.md && git commit -m "docs: note the shop dashboard surfaces"
```

---

## Final verification (whole plan)

- [ ] Full gate + integration + locale parity + web build (Task 9 Step 2 outputs recorded).
- [ ] Live walk with the demo org (dev server): Products lists seeded products and accepts a new one with a photo; Orders shows a created order and Confirm decrements stock; the bell shows the resulting notifications; settings saves payment instructions.
- [ ] Manual acceptance (Edward, real WhatsApp): bargain to an order on the phone, confirm it from the Orders screen, watch the bell.
- [ ] One conventional commit per task.
