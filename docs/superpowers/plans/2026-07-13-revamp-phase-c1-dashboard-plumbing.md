# Revamp Phase C1: Dashboard Plumbing Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the dashboard's hand-rolled per-page fetching with TanStack Query fed by runtime-validated shared schemas and socket-driven invalidation, centralize the client auth guard, and install the shadcn/ui kit and fonts, all WITHOUT changing how anything looks (Phase C2 does the restyle).

**Architecture:** New shared Zod schemas cover the five response shapes that still live as local interfaces (dashboard summary, AI test result, contacts, team, organization detail). A thin `app-api.ts` layer runtime-parses every read; pages swap `useEffect`+`useState` loading for `useQuery` with stable query keys; one socket bridge hook in `AppShell` maps realtime events to query invalidations, replacing the per-page socket refresh effects. A `useAuthGuard` hook dedupes the six copies of the token-check redirect. shadcn/ui is initialized into `@/components/shadcn` (NOT touching the existing `components/ui.tsx`) with CSS variables mapped to the brand palette and Inter loaded via `next/font`, ready for C2's swap.

**Tech Stack:** @tanstack/react-query v5, shadcn/ui (Tailwind v4 CSS-variable mode), next/font, lucide-react, Zod, next-intl.

**Specs:** master design section 8 (`docs/superpowers/specs/2026-07-11-waos-revamp-master-design.md`); B2 ledger riding items (zod range alignment lands here).

## Global Constraints

- TypeScript `strict: true`; `any` forbidden. No em dashes anywhere. Conventional commits. No floating promises.
- ZERO visual change in this phase: pages must render pixel-identical (same classNames, same markup). Only data plumbing, providers, fonts (Inter may subtly change metrics; that single change is sanctioned), and new unused kit files.
- Every read that feeds a query hook is runtime-parsed against a shared Zod schema. Mutations may keep `apiFetch` and MUST invalidate the affected query keys afterward.
- Query keys are the EXACT arrays defined in Task 3's Produces block; invalidation uses prefix matching (`queryKey: ['conversations']` invalidates all filters).
- The web app still has no test runner: web tasks gate on `pnpm -F @waos/web typecheck && pnpm lint && pnpm -F @waos/web build` plus a live drive. API-side schema tests use Vitest as usual.
- Locale files: this phase adds NO user-facing copy (plumbing only); parity must remain intact (verify, do not edit).
- All checks green at every commit: `pnpm typecheck && pnpm lint && pnpm -F @waos/api test`.
- Local env: Postgres 5433, Redis 6380, docker infra up, demo org has both modules and seeded products.

## Verified current facts

- `apps/web/src/app/[locale]/layout.tsx` is a server component: `<html><body class="min-h-screen bg-brand-50 font-sans text-brand-950 antialiased"><NextIntlClientProvider>{children}</NextIntlClientProvider></body></html>`.
- Local interfaces to replace: home `Summary { conversationsToday: number; pendingHandoffs: number; deflection: { replied: number; handedOff: number; percent: number | null }; upcomingAppointments: AppointmentDto[] }`; contacts `ContactRow { id; phone; name: string|null; language: string|null; tags: string[]; optedInAt: string|null; customFields: Record<string,string>|null }`; team `{ id; name; role }` (API returns `{ id, name, email, role }`); settings `OrganizationResponse` (id, name, vertical, language, timezone, settings incl. aiEnabled/aiConfidenceThreshold/toneNotes/paymentInstructions/ownerAlertPhone/ownerAlertsEnabled, modules); onboarding test `AiTestResult { reply: string; confidence: number; intent: string; action: 'REPLY' | 'HANDOFF'; chunksUsed: number }`.
- Existing shared schemas already cover: conversations, messages, appointments, weeklyStats, knowledge docs, channels, products, orders, notifications.
- `apps/web/src/lib/shop-api.ts` is the validated-fetch precedent to copy.
- Socket events emitted by the API: `message.new`, `message.updated`, `conversation.updated`, `channel.status_changed`, `notification.new`.

---

### Task 1: Shared schemas for the remaining response shapes

**Files:**
- Create: `packages/shared/src/schemas/dashboard.ts`
- Create: `packages/shared/src/schemas/team.ts`
- Create: `packages/shared/src/schemas/contact.ts`
- Modify: `packages/shared/src/schemas/knowledge.ts` (aiTestResultSchema lives beside aiReplyOutputSchema)
- Modify: `packages/shared/src/schemas/organization.ts` (organizationDetailSchema)
- Modify: `packages/shared/src/index.ts` (barrel)
- Test: `apps/api/src/services/app-schemas.test.ts`

**Interfaces:**
- Consumes: `appointmentSchema` (existing), `businessModuleSchema`.
- Produces (exact names later tasks import from `@waos/shared`):

```ts
// dashboard.ts
export const dashboardSummarySchema = z.object({
  conversationsToday: z.number().int(),
  pendingHandoffs: z.number().int(),
  deflection: z.object({
    replied: z.number().int(),
    handedOff: z.number().int(),
    percent: z.number().nullable(),
  }),
  upcomingAppointments: z.array(appointmentSchema),
});
export type DashboardSummaryDto = z.infer<typeof dashboardSummarySchema>;

// team.ts
export const teamMemberSchema = z.object({
  id: z.string(),
  name: z.string(),
  email: z.string(),
  role: z.string(),
});
export type TeamMemberDto = z.infer<typeof teamMemberSchema>;

// contact.ts
export const contactSchema = z.object({
  id: z.string(),
  phone: z.string(),
  name: z.string().nullable(),
  language: z.string().nullable(),
  tags: z.array(z.string()),
  optedInAt: z.string().nullable(),
  customFields: z.record(z.unknown()).nullable(),
});
export type ContactDto = z.infer<typeof contactSchema>;

// knowledge.ts addition
export const aiTestResultSchema = z.object({
  reply: z.string(),
  confidence: z.number().min(0).max(1),
  intent: z.string(),
  action: z.enum(['REPLY', 'HANDOFF']),
  chunksUsed: z.number().int(),
});
export type AiTestResultDto = z.infer<typeof aiTestResultSchema>;

// organization.ts addition
export const organizationDetailSchema = z.object({
  id: z.string(),
  name: z.string(),
  vertical: z.string(),
  language: z.string(),
  timezone: z.string(),
  modules: z.array(businessModuleSchema),
  settings: z
    .object({
      aiEnabled: z.boolean().optional(),
      aiConfidenceThreshold: z.number().optional(),
      toneNotes: z.string().optional(),
      paymentInstructions: z.string().optional(),
      ownerAlertPhone: z.string().nullable().optional(),
      ownerAlertsEnabled: z.boolean().optional(),
    })
    .passthrough()
    .nullable(),
});
export type OrganizationDetailDto = z.infer<typeof organizationDetailSchema>;
```

IMPORTANT dates note: Prisma Date fields serialize to ISO strings over JSON; the API's contact/appointment DTOs pass through `res.json`, so `z.string()` on `optedInAt`/`createdAt` is correct (the same convention productSchema already uses). Contact rows come straight from Prisma (`createdAt`/`updatedAt` extra keys ride along): contactSchema must NOT use `.strict()`; default (strip) is right.

- [ ] **Step 1: Write the failing test** `apps/api/src/services/app-schemas.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import {
  aiTestResultSchema,
  contactSchema,
  dashboardSummarySchema,
  organizationDetailSchema,
  teamMemberSchema,
} from '@waos/shared';

describe('app response schemas', () => {
  it('parses a dashboard summary with a null deflection percent', () => {
    const parsed = dashboardSummarySchema.parse({
      conversationsToday: 0,
      pendingHandoffs: 0,
      deflection: { replied: 0, handedOff: 0, percent: null },
      upcomingAppointments: [],
    });
    expect(parsed.deflection.percent).toBeNull();
  });

  it('parses a contact and strips unknown keys', () => {
    const parsed = contactSchema.parse({
      id: 'c1', phone: '+255700000001', name: null, language: null,
      tags: [], optedInAt: null, customFields: null,
      createdAt: '2026-07-13T00:00:00.000Z',
    });
    expect('createdAt' in parsed).toBe(false);
  });

  it('ai test result accepts only REPLY or HANDOFF actions', () => {
    expect(() =>
      aiTestResultSchema.parse({ reply: 'x', confidence: 0.5, intent: 'question', action: 'MAYBE', chunksUsed: 1 }),
    ).toThrow();
  });

  it('organization detail keeps unknown settings keys (passthrough)', () => {
    const parsed = organizationDetailSchema.parse({
      id: 'o1', name: 'N', vertical: 'salon', language: 'sw', timezone: 'Africa/Dar_es_Salaam',
      modules: ['appointments'], settings: { aiEnabled: true, futureKey: 1 },
    });
    expect((parsed.settings as Record<string, unknown>).futureKey).toBe(1);
  });

  it('team member requires email', () => {
    expect(() => teamMemberSchema.parse({ id: 'u1', name: 'A', role: 'OWNER' })).toThrow();
  });
});
```

- [ ] **Step 2: RED** (`pnpm -F @waos/api test -- app-schemas`), **Step 3: implement** (code above verbatim; barrel exports), **Step 4: GREEN + full gate**, **Step 5: Commit**

```bash
git add -A && git commit -m "feat(shared): runtime schemas for dashboard, contacts, team, org detail, and ai test"
```

---

### Task 2: Validated read layer for the app pages

**Files:**
- Create: `apps/web/src/lib/app-api.ts`
- Modify: `apps/web/src/app/[locale]/onboarding/test/page.tsx` (swap its local AiTestResult interface + inline fetch for `runAiTest`; no query migration, the page stays manual)

**Interfaces:**
- Consumes: `apiFetch` from `./api`; Task 1 schemas + existing shared schemas.
- Produces (pages import these EXACT names):

```ts
export async function getDashboardSummary(): Promise<DashboardSummaryDto>;      // GET /api/v1/dashboard -> { summary }
export async function listConversations(status?: ConversationStatus): Promise<ConversationListItem[]>; // GET /api/v1/conversations?status= -> { conversations }
export async function listMessages(conversationId: string): Promise<MessageDto[]>; // GET /api/v1/conversations/:id/messages -> { messages }
export async function listTeam(): Promise<TeamMemberDto[]>;                     // GET /api/v1/organization/users -> { users }
export async function listContacts(search?: string, tag?: string): Promise<ContactDto[]>; // GET /api/v1/contacts?search=&tag= -> { contacts }
export async function listAppointments(from?: string): Promise<AppointmentDto[]>; // GET /api/v1/appointments?from= -> { appointments }
export async function getWeeklyStats(): Promise<WeeklyStats>;                   // GET /api/v1/appointments/stats/weekly -> { stats }
export async function getOrganization(): Promise<OrganizationDetailDto>;        // GET /api/v1/organization -> { organization }
export async function runAiTest(question: string): Promise<AiTestResultDto>;    // POST /api/v1/ai/test { question } -> { result }
```

Every function follows the `shop-api.ts` envelope idiom exactly (`apiFetch<unknown>` then `schema.parse((raw as { field: unknown }).field)`; query strings via `URLSearchParams` only for provided values). `conversationListItemSchema`, `messageSchema`, `appointmentSchema`, `weeklyStatsSchema` are runtime-parsed with `z.array(...)`/direct parse (they exist in shared already; this layer finally runtime-validates them).

- [ ] **Step 1: implement the module and swap the onboarding test page's fetch to `runAiTest`** (delete its local interface; rendering unchanged), **Step 2: gate** (`pnpm -F @waos/web typecheck && pnpm lint`), **Step 3: live parse check** (dev up; demo token; curl each GET endpoint once and parse the saved bodies via a `/tmp/claude-1000/` tsx script against the schemas, INCLUDING the POST /ai/test call body shape; dev down; outputs in the report), **Step 4: Commit**

```bash
git add apps/web/src/lib/app-api.ts && git commit -m "feat(web): validated read layer for the dashboard pages"
```

---

### Task 3: TanStack Query provider, socket invalidation bridge, auth guard hook

**Files:**
- Modify: `apps/web/package.json` (add `@tanstack/react-query` ^5)
- Create: `apps/web/src/components/providers.tsx`
- Modify: `apps/web/src/app/[locale]/layout.tsx` (mount Providers inside NextIntlClientProvider)
- Create: `apps/web/src/lib/query-keys.ts`
- Create: `apps/web/src/lib/use-socket-invalidation.ts`
- Create: `apps/web/src/lib/use-auth-guard.ts`
- Modify: `apps/web/src/components/app-shell.tsx` (mount the bridge; adopt the guard hook)

**Interfaces:**
- Consumes: `getSocket` from `lib/socket`; `getTokens` from `lib/api`; router from `@/i18n/navigation`.
- Produces (EXACT):

```ts
// query-keys.ts
export const queryKeys = {
  dashboard: ['dashboard'] as const,
  conversations: (status?: string) => ['conversations', status ?? 'ALL'] as const,
  conversationsRoot: ['conversations'] as const,
  messages: (conversationId: string) => ['messages', conversationId] as const,
  messagesRoot: ['messages'] as const,
  team: ['team'] as const,
  contacts: (search?: string, tag?: string) => ['contacts', search ?? '', tag ?? ''] as const,
  contactsRoot: ['contacts'] as const,
  appointments: (from?: string) => ['appointments', from ?? ''] as const,
  appointmentsRoot: ['appointments'] as const,
  weeklyStats: ['weeklyStats'] as const,
  organization: ['organization'] as const,
  products: (includeInactive: boolean) => ['products', includeInactive] as const,
  productsRoot: ['products'] as const,
  orders: (status?: string, contactId?: string) => ['orders', status ?? 'ALL', contactId ?? ''] as const,
  ordersRoot: ['orders'] as const,
  notifications: (unreadOnly: boolean) => ['notifications', unreadOnly] as const,
  notificationsRoot: ['notifications'] as const,
};
```

```tsx
// providers.tsx ('use client')
export function Providers({ children }: { children: ReactNode }) // QueryClientProvider
// QueryClient defaults: { queries: { staleTime: 15_000, retry: 1, refetchOnWindowFocus: true } }
// The client lives in a useState initializer so it is created once per mount tree.
```

```ts
// use-socket-invalidation.ts ('use client' hook)
export function useSocketInvalidation(): void;
// one effect; on socket events invalidate (prefix keys):
//   message.new, message.updated -> messagesRoot, conversationsRoot, dashboard
//   conversation.updated -> messagesRoot, conversationsRoot, dashboard
//   notification.new -> notificationsRoot, ordersRoot, productsRoot, dashboard
//   channel.status_changed -> (nothing; the connect page manages its own state)
// cleanup removes all listeners.
```

```ts
// use-auth-guard.ts ('use client' hook)
export function useAuthGuard(): boolean; // false until checked; redirects to /login when no tokens
```

- Layout change: `<NextIntlClientProvider><Providers>{children}</Providers></NextIntlClientProvider>` (Providers is a client component; the layout stays server).
- AppShell: replace its inline token-check effect with `const checked = useAuthGuard()`; call `useSocketInvalidation()` once; markup unchanged.

- [ ] **Step 1: implement**, **Step 2: gate** (`pnpm -F @waos/web typecheck && pnpm lint && pnpm -F @waos/web build`), **Step 3: live smoke** (dev up; log-in flow still works: authed page loads; dev down), **Step 4: Commit**

```bash
git add -A && git commit -m "feat(web): tanstack query provider, socket invalidation bridge, and auth guard hook"
```

---

### Task 4: Migrate wave 1 (home, contacts, settings reads, bell)

**Files:**
- Modify: `apps/web/src/app/[locale]/home/page.tsx`
- Modify: `apps/web/src/app/[locale]/contacts/page.tsx`
- Modify: `apps/web/src/app/[locale]/settings/page.tsx`
- Modify: `apps/web/src/components/notification-bell.tsx`

**Interfaces:**
- Consumes: Tasks 2-3 fetchers, `queryKeys`, `useQuery`/`useQueryClient`; `listNotifications` from shop-api.
- Produces: pages render identically; local response interfaces deleted in favor of shared Dto types.

Migration recipe (apply per page; the reviewer will hold you to it):
- Reads become `useQuery({ queryKey: queryKeys.X(...), queryFn: () => fetcher(...) })`; `isPending` drives the existing Skeleton branch, `isError` the existing ErrorBox (retry = `refetch`), data the existing render. The debounced contacts search feeds the query key (debounce state stays; key = `queryKeys.contacts(debouncedSearch, tag)`).
- Mutations keep their current `apiFetch`/shop-api calls but replace `load()` calls with `queryClient.invalidateQueries({ queryKey: <root key> })` (settings saves invalidate `organization`; contact edits invalidate `contactsRoot`; bell mark-read invalidates `notificationsRoot`).
- DELETE each page's now-dead socket refresh effect (the bridge covers it) and its `load` callback.
- Bell: unread count = `useQuery({ queryKey: queryKeys.notifications(true), queryFn: () => listNotifications(true) })`; panel list = a second query with `enabled: open`, `queryKeys.notifications(false)`.
- settings page keeps `updateStoredOrganization` side effects exactly as-is after mutations.

- [ ] **Step 1: migrate the four files**, **Step 2: gate** (typecheck/lint/build), **Step 3: live smoke** (dev up: home renders KPIs; contacts search narrows; settings loads and a save round-trips; bell badge shows; verify in the report with curl + an authed CDP pass if available; dev down), **Step 4: Commit**

```bash
git add -A && git commit -m "refactor(web): home, contacts, settings, and bell on tanstack query"
```

---

### Task 5: Migrate wave 2 (inbox, thread, appointments, products, orders)

**Files:**
- Modify: `apps/web/src/app/[locale]/inbox/page.tsx`
- Modify: `apps/web/src/components/conversation-thread.tsx`
- Modify: `apps/web/src/app/[locale]/appointments/page.tsx`
- Modify: `apps/web/src/app/[locale]/products/page.tsx`
- Modify: `apps/web/src/app/[locale]/orders/page.tsx`

**Interfaces:**
- Consumes: same recipe as Task 4.
- Produces: identical rendering; all five pages' socket effects deleted (bridge covers them); thread's orders-chip fetch becomes `useQuery({ queryKey: queryKeys.orders('ALL', contactId), enabled: shopOrg && !!contactId })`.

Thread specifics: `listMessages(id)` + `listConversations()` + `listTeam()` become three queries (messages keyed per conversation; conversation derived from the conversations query via `select` or a find over data); after send/assign/status/ai-toggle mutations, invalidate `messagesRoot` + `conversationsRoot` (replaces `await load()`); the scroll-to-bottom effect keys off the messages query data. The standalone `/inbox/[id]` wrapper adopts `useAuthGuard`.
Appointments specifics: list + weeklyStats queries; the create/update/status mutations invalidate `appointmentsRoot` + `weeklyStats` + `dashboard`.
Products/orders: reads via queries (products keyed `products(true)` since the page shows inactive; orders keyed per filter); mutations invalidate their roots (product mutations also `ordersRoot` NOT needed; keep minimal: productsRoot; order status changes invalidate `ordersRoot` + `productsRoot` because stock changes).

- [ ] **Step 1: migrate the five files**, **Step 2: gate** (typecheck/lint/build), **Step 3: live smoke** (dev up: walk inbox -> open a thread -> send disabled state renders; appointments page lists; products/orders render; confirm one order status change invalidates and re-renders stock on products without a manual reload, via the real UI if CDP-authed access is available, else document the API-level equivalence; dev down), **Step 4: Commit**

```bash
git add -A && git commit -m "refactor(web): inbox, thread, appointments, products, and orders on tanstack query"
```

---

### Task 6: shadcn/ui kit installation (no usage swap)

**Files:**
- Create: `apps/web/components.json` (shadcn config; aliases.ui = `@/components/shadcn`)
- Create: `apps/web/src/components/shadcn/*` (generated primitives)
- Create: `apps/web/src/lib/utils.ts` (`cn` helper, generated)
- Modify: `apps/web/src/app/globals.css` (shadcn CSS variables mapped to the brand palette)
- Modify: `apps/web/src/app/[locale]/layout.tsx` (Inter via next/font)
- Modify: `apps/web/package.json` (deps added by the CLI + lucide-react)

**Interfaces:**
- Consumes: existing `@theme` brand palette in globals.css.
- Produces: primitives `button, card, input, textarea, select, badge, dialog, dropdown-menu, switch, skeleton, separator` under `@/components/shadcn/*`; CSS variables (`--background`, `--foreground`, `--primary`, `--accent`, `--destructive`, `--muted`, `--border`, `--ring`, radius) defined in `:root` AND `.dark` blocks, with values mapped to the existing brand ramp (primary = brand-700 `#15803d`-family value from the ramp; read the actual hexes from globals.css `@theme` and reuse them; accent = accent-500 `#f5a623`; background light = brand-50, dark = brand-950). Inter: `next/font/google` `Inter({ subsets: ['latin'], variable: '--font-inter' })`, variable class on `<html>`, and `--font-sans` in the theme updated to reference it with the existing stack as fallback.

Steps:
- [ ] **Step 1:** run `pnpm dlx shadcn@latest init` from `apps/web` (choose: Tailwind v4 detected automatically; base color neutral; CSS variables yes); then `pnpm dlx shadcn@latest add button card input textarea select badge dialog dropdown-menu switch skeleton separator`. If the CLI insists on `@/components/ui`, set `components.json` aliases first, then add. Record exact CLI output in the report; if the CLI fights the existing Tailwind v4 setup, BLOCKED with specifics rather than hand-rolling.
- [ ] **Step 2:** map the generated CSS variables to the brand palette in globals.css (both `:root` and `.dark`; dark values are the palette inverted per the mapping above; C2 ships the toggle, the variables just exist now).
- [ ] **Step 3:** Inter via next/font as specified; verify no `font-sans` regression by loading any page.
- [ ] **Step 4: gate** (typecheck/lint/build; the generated files must lint clean under the repo's flat config: if `no-explicit-any` or import rules flag generated code, minimally patch the generated files and note each patch), **Step 5: live smoke** (dev up; a page renders with Inter: check computed font-family via CDP or accept the build; dev down), **Step 6: Commit**

```bash
git add -A && git commit -m "feat(web): install the shadcn kit, brand css variables, and inter font"
```

---

### Task 7: Chores, docs, and whole-phase verification

**Files:**
- Modify: `apps/web/package.json` (zod range `^3.25.0` to match `packages/shared`)
- Modify: `CLAUDE.md` section 4 (dashboard row: Next.js App Router, Tailwind, shadcn/ui, TanStack Query, next-intl)
- Modify: `README.md` (stack line mentions TanStack Query + shadcn/ui)

- [ ] **Step 1: chores + docs** (no em dashes; protected rules untouched).
- [ ] **Step 2: whole-phase verification** (record ALL outputs):

```bash
pnpm install   # lockfile settles after the zod range change
pnpm typecheck && pnpm lint && pnpm -F @waos/api test
INTEGRATION_DATABASE_URL=postgresql://waos:waos@localhost:5433/waos_dev pnpm -F @waos/api test
pnpm -F @waos/web build
node -e "const en=require('./apps/web/messages/en.json'),sw=require('./apps/web/messages/sw.json');const k=o=>{const r=[];const w=(x,p)=>{for(const[key,v]of Object.entries(x)){if(typeof v==='object')w(v,p+key+'.');else r.push(p+key)}};w(o,'');return new Set(r)};const a=k(en),b=k(sw);const d=[...a].filter(x=>!b.has(x)).concat([...b].filter(x=>!a.has(x)));console.log(d.length===0?'locale parity OK':'DRIFT: '+d.join(', '))"
```

- [ ] **Step 3: live regression walk** (dev up: login -> home -> inbox -> thread -> appointments -> products -> orders -> settings -> bell all render and update live over the socket bridge; record what was clicked; dev down).
- [ ] **Step 4: Commit**

```bash
git add -A && git commit -m "chore(web): align zod range and note the query layer in the docs"
```

---

## Final verification (whole plan)

- [ ] Task 7's battery all green; locale parity OK; production build succeeds.
- [ ] No visual diffs: spot-check two screenshots (login, an authed page if reachable) against pre-phase renders; fonts aside, markup identical.
- [ ] `git log --oneline`: one conventional commit per task.
- [ ] Ledger note for C2: the kit is installed and unused; C2 swaps `components/ui.tsx` internals, rebuilds the shell (sidebar + mobile nav), restyles screens, adds home sales KPIs, dark-mode toggle, and the forms pass (client-side E.164, money input UX).
