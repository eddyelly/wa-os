# CLAUDE.md - WaOS (WhatsApp AI Platform)

This file is the source of truth for how Claude Code works in this repository.
Read it fully before writing any code. When a request conflicts with this file,
stop and ask before proceeding.

---

## 1. What this project is

WaOS is an AI-native WhatsApp business platform for small businesses in
Tanzania (then East Africa). An AI agent, grounded in the business's own data,
answers customers, books appointments, sends reminders, and hands off to a
human when unsure.

One-liner: "The WhatsApp operating system for appointment-based local service
businesses. An AI assistant that answers customers, books and reminds, and
never sleeps."

Beachhead vertical: appointment-based local services (clinics, salons, spas,
tutors, garages). Vertical-specific copy and defaults live in config, never
hardcoded, so a second vertical is a config change.

Naming note: "WaOS" is the internal working name. Never use "WhatsApp" in
public-facing brand strings; use "WaOS" or read from `NEXT_PUBLIC_APP_NAME`.

---

## 2. Current phase and hard scope rules

We are in Phase 1 (MVP). These rules are non-negotiable:

1. **Everything is FREE.** No payment code of any kind. No Paddle, no Lemon
   Squeezy, no AzamPay, no Stripe, no billing pages, no paywalls, no upgrade
   modals asking for money. `Organization.plan` exists (default `"free"`) only
   so pricing can be added later as a migration. Do not read `plan` for
   feature gating anywhere.
2. **Commerce is module-scoped, payments stay out.** The `shop` module
   (catalog, orders, AI selling) is being built per
   docs/superpowers/specs/2026-07-11-waos-revamp-master-design.md. The
   platform NEVER processes payments: no gateways, no checkout, no billing.
   The AI may only relay the owner's payment instructions as text.
3. **Broadcasts are gated for ban risk, not money.** Bulk/marketing sends are
   blocked by the policy engine with the reason `COMING_SOON`, surfaced in the
   UI as "Broadcasts are coming soon", never as an upsell.
4. **Entry tier transport only.** The Cloud API adapter is a stub that throws
   `NotImplementedError`. Build only the Evolution API (Baileys) adapter.
5. **Multi-tenant from day one.** Every domain table carries
   `organizationId`. No exceptions.

---

## 3. Architecture

```
        DASHBOARD (Next.js)  <- REST + Socket.IO ->  API (Express)
                                                        |
                                        APPLICATION CORE (the value layer)
                                        AI engine (RAG) | CRM | Bookings |
                                        Inbox | Policy/Routing engine
                                                        |
                                            MessagingPort (interface)
                                          /                          \
                              EvolutionAdapter                 CloudApiAdapter
                              (Baileys, entry tier)            (stub, Phase 3)
```

### 3.1 The MessagingPort contract (sacred)

The core NEVER imports a provider SDK or calls a provider URL directly. All
messaging goes through this interface, defined in `packages/ports`:

```ts
interface MessagingPort {
  sendText(channelId: string, to: string, text: string): Promise<SendResult>;
  sendMedia(channelId: string, to: string, media: MediaRef, caption?: string): Promise<SendResult>;
  sendTemplate(
    channelId: string,
    to: string,
    templateId: string,
    vars: Record<string, string>,
  ): Promise<SendResult>; // Cloud API only
  getSessionStatus(channelId: string): Promise<SessionStatus>;
  connect(channelId: string): Promise<ConnectResult>; // returns QR payload for entry tier
  disconnect(channelId: string): Promise<void>;
}
```

Inbound events from any provider are normalized to a single `IncomingMessage`
shape before they touch the core. Provider-specific payloads never leak past
the adapter boundary.

### 3.2 The policy engine

Every outbound action passes through `PolicyEngine.check(action, channel)`
BEFORE it is enqueued. Rules are keyed on `channel.provider`:

| Action                          | evolution (entry)      | cloud_api (later) |
| ------------------------------- | ---------------------- | ----------------- |
| Reply in an active conversation | allow                  | allow             |
| Media in an active chat         | allow                  | allow             |
| Reminder to opted-in contact    | allow, rate limited    | allow             |
| Owner alert to opted-in owner   | allow, rate limited    | allow             |
| Broadcast / marketing blast     | block: COMING_SOON     | allow             |
| Message to non-contact          | block: OPT_IN_REQUIRED | allow             |
| Above volume threshold          | throttle               | allow             |

A blocked action returns a typed `PolicyDecision`, never a thrown string. The
UI renders the decision reason in plain language. `OWNER_ALERT` is the shop
module's owner alert: it relays a `NEW_ORDER` or `LOW_STOCK` `Notification`
to the owner's own WhatsApp as a proactive send, so it is modeled as a normal
opted-in contact and goes through the same rate limiting and opt-in check as
a reminder.

### 3.3 Ban-risk guardrails (entry tier)

Implemented in the outbound send worker, not in controllers:

- Per-channel BullMQ rate limiter, config-driven (`SEND_RATE_PER_MINUTE`).
- Randomized jitter between sends (2 to 9 seconds) to avoid robotic pacing.
- New-channel warm-up: day-indexed daily send caps that ramp up over 14 days.
- Reactive by default: proactive sends require `Contact.optedInAt` to be set.
- Honest disclosure: the connect screen states the entry tier is unofficial
  and carries ban risk. Never remove this copy.

### 3.4 Session persistence (required)

WhatsApp sessions MUST survive API restarts and VPS reboots. Evolution API
owns session state (its Postgres store, volume-mounted in Docker). Our side
persists `Channel.status`, reconciles on boot via `getSessionStatus`, and
emits `channel.status_changed` over Socket.IO so the dashboard always shows
live connection state. Losing a session on deploy is a P1 bug.

---

## 4. Tech stack

| Concern       | Choice                                                                    |
| ------------- | ------------------------------------------------------------------------- |
| API           | Node.js 20+, Express, TypeScript (strict)                                 |
| ORM / DB      | Prisma + PostgreSQL 16 with the `pgvector` extension                      |
| Queues        | BullMQ on Redis                                                           |
| Media storage | MinIO (S3-compatible)                                                     |
| WA transport  | Evolution API (Baileys) as a separate Docker service, REST + webhooks     |
| Realtime      | Socket.IO (Redis adapter ready, single instance for now)                  |
| LLM           | `LLMPort` interface; Gemini SDK (`@google/genai`) default, model from env |
| Embeddings    | `EmbeddingPort` interface; Gemini default provider, model from env        |
| Dashboard     | Next.js (App Router), Tailwind, shadcn/ui, TanStack Query, next-intl      |
| Infra         | Docker Compose on a single Ubuntu VPS behind Nginx                        |

Do not add new infrastructure (no second database, no Kafka, no k8s). Every
extra moving part is a tax on a solo founder.

---

## 5. Monorepo layout (pnpm workspaces)

```
wa-os/
  apps/
    api/          Express API + BullMQ workers
      src/
        routes/         route definitions only
        controllers/    HTTP in/out, no business logic
        services/       business logic, uses ports + repositories
        repositories/   all Prisma access lives here
        adapters/       EvolutionAdapter, CloudApiAdapter (stub), LLM, embeddings
        workers/        BullMQ processors (send, reminders, embeddings, ai-reply)
        policy/         PolicyEngine + rule tables
        sockets/        Socket.IO gateway
        lib/            config, logger, errors
    web/          Next.js dashboard
  packages/
    ports/        MessagingPort, LLMPort, EmbeddingPort, shared types
    shared/       Zod schemas shared by api and web (single source of truth)
  infra/
    docker-compose.yml   postgres(pgvector), redis, minio, evolution-api, api, web
  CLAUDE.md
  KICKOFF_PROMPT.md
```

Layering rule: routes -> controllers -> services -> repositories/adapters.
A layer only imports from the layer directly below it or from `packages/*`.
Controllers never touch Prisma. Services never touch `req`/`res`.

---

## 6. Coding standards (strict)

1. TypeScript `strict: true`. The `any` type is forbidden. Use `unknown` plus
   narrowing, or proper generics.
2. No em dashes anywhere: not in code, comments, docs, or UI copy. Use commas,
   colons, or parentheses.
3. Conventional commits: `feat:`, `fix:`, `chore:`, `refactor:`, `test:`,
   `docs:`. Scope when useful, e.g. `feat(inbox): assign conversations`.
4. Validate at every boundary with Zod: request bodies, webhook payloads, env
   vars (fail fast at boot via a `config.ts` that parses `process.env`), and
   queue job payloads.
5. Errors: a typed `AppError` hierarchy, one Express error middleware, no
   `throw "string"`. Workers log errors with job id and channel id.
6. Async only: no `.then()` chains, no floating promises (`no-floating-promises`
   ESLint rule on).
7. IDs are cuid/uuid strings. Timestamps are `createdAt`/`updatedAt` on every
   table. Money does not exist in this phase; if it ever does, integers in
   minor units.
8. Never log message bodies or tokens. Log message ids and metadata only.
9. Naming: `camelCase` variables, `PascalCase` types, `SCREAMING_SNAKE` env
   vars, kebab-case file names.

---

## 7. Data model (Prisma, key entities)

All domain tables include `organizationId` and are indexed on it.

- **Organization**: the tenant (the business). `name`, `vertical`, `language`
  (default `sw`), `timezone` (default `Africa/Dar_es_Salaam`), `plan`
  (default `"free"`, unused for gating), `modules String[]` (enabled feature
  modules, e.g. `appointments`, `shop`; gates routes, nav, and AI tools),
  `settings Json`.
- **User**: owner or staff. `role: OWNER | STAFF`, belongs to Organization.
  Auth is email + password (argon2) with JWT access/refresh tokens.
- **Channel**: a connected WhatsApp number.
  `provider: "evolution" | "cloud_api"`, `externalId` (Evolution instance
  name), `status: PENDING | QR_READY | CONNECTED | DISCONNECTED | BANNED`,
  `warmupStartedAt`. This field pair is the heart of transport agnosticism.
- **Contact**: end customer. `phone` (E.164), `name`, `language`, `tags
String[]`, `optedInAt DateTime?`, `customFields Json`.
- **Conversation**: Channel x Contact thread. `status: OPEN | PENDING | CLOSED`,
  `assigneeId?`, `aiEnabled Boolean @default(true)`, `lastMessageAt`.
- **Message**: normalized regardless of provider. `direction: IN | OUT`,
  `type: TEXT | IMAGE | AUDIO | DOCUMENT | LOCATION | OTHER`, `body`,
  `mediaKey?` (MinIO), `authorType: CONTACT | HUMAN_AGENT | AI | SYSTEM`,
  `providerMessageId`, `status: QUEUED | SENT | DELIVERED | READ | FAILED | BLOCKED`.
- **KnowledgeDoc** and **KnowledgeChunk**: uploaded source content. Chunk has
  `content`, `embedding` (pgvector, `Unsupported("vector(1536)")`), `docId`.
  Similarity search is a raw SQL query in the repository layer only.
- **Appointment**: `contactId`, `startsAt`, `endsAt`, `serviceName`,
  `status: BOOKED | REMINDED | COMPLETED | NO_SHOW | CANCELLED`,
  `reminderJobIds String[]`.
- **AiReplyLog**: every AI decision. `conversationId`, `retrievedChunkIds`,
  `confidence Float`, `action: REPLIED | HANDED_OFF`, `latencyMs`,
  `toolsUsed String[]` (names of agent tools invoked, e.g. `search_products`,
  `negotiate_price`, `record_order`). This powers the deflection metric and
  debugging.
- **Product** and **ProductImage**: the `shop` module's catalog. Product has
  `price` and `minPrice` (both whole TZS integers; `minPrice` is the
  bargaining floor, nullable meaning fixed price, and is NEVER exposed to the
  AI), `stockQty`, `lowStockThreshold` (default 5), `isActive`, `tags
String[]`, `embedding` (pgvector, built from name, description, and image
  descriptions). ProductImage has `mediaKey` (MinIO) and `description`
  (written by Gemini vision at upload, feeds the product embedding).
- **Order** and **OrderItem**: `Order` has `contactId`, `conversationId?`
  (nullable), `status: PENDING_CONFIRMATION | CONFIRMED | PAID | FULFILLED |
CANCELLED`, `totalAgreed`. `OrderItem` has `orderId`, `productId?`
  (nullable, set to null if the product is later deleted) and snapshots
  `productName`, `listPrice`, and `agreedPrice` at order time so a line item
  is unaffected by later product edits or deletion.
- **Notification**: `type: NEW_ORDER | LOW_STOCK | HANDOFF`, `payload Json`,
  `readAt?`. Feeds the dashboard bell (Socket.IO `notification.new`, ids and
  type only) and, for `NEW_ORDER` and `LOW_STOCK`, the owner WhatsApp alert.

Migrations via `prisma migrate`. Never edit a committed migration.

---

## 8. Key flows

**Inbound message:** Evolution webhook -> Zod-validate -> adapter normalizes
to `IncomingMessage` -> service upserts Contact + Conversation, stores
Message, downloads media to MinIO -> emits Socket.IO `message.new` -> if
`conversation.aiEnabled`, enqueue `ai-reply` job.

**AI reply job:** load conversation context + top-k chunks from pgvector ->
LLMPort completes with a system prompt that (a) answers only from provided
context, (b) replies in the contact's language (Swahili or English), (c)
returns JSON `{ reply, confidence, intent }` -> if `confidence >=
AI_CONFIDENCE_THRESHOLD` enqueue outbound send as `authorType: AI`; else set
conversation to PENDING, notify humans via Socket.IO, do not send.

**AI selling (shop module):** when the organization's `modules` include
`shop`, the AI reply job also runs a bounded tool loop (max 4 rounds) with
`search_knowledge`, `search_products`, `negotiate_price`, and `record_order`
before it answers -> price floors (`Product.minPrice`) are enforced in code
at two layers, never told to the model: `negotiate_price`'s executor clamps
to the floor, and `record_order` revalidates every item against the live
floor and stock before writing anything -> a struck deal creates an `Order`
as `PENDING_CONFIRMATION` and returns payment instructions for the AI to
relay in chat, the platform never processes the payment itself -> stock
decrements atomically with the transition to `CONFIRMED`; a low-stock
crossing creates a `LOW_STOCK` `Notification` -> `NEW_ORDER` and `LOW_STOCK`
notifications relay to the owner's own WhatsApp through the `OWNER_ALERT`
policy action when owner alerts are enabled in shop settings. The dashboard
also surfaces recorded orders for the owner to confirm directly and receives
these notifications live over Socket.IO `notification.new`.

**Outbound send job:** PolicyEngine.check -> rate limiter + jitter ->
MessagingPort.sendText/sendMedia -> update Message.status from provider ack.
BLOCKED decisions store the Message with `status: BLOCKED` and the reason.

**Booking + reminders:** creating an Appointment schedules delayed BullMQ
jobs (24h and 2h before, config-driven). Reminder jobs go through the same
policy + send pipeline and require `optedInAt`.

---

## 9. Queues (BullMQ)

| Queue        | Purpose                            | Notes                        |
| ------------ | ---------------------------------- | ---------------------------- |
| `outbound`   | all provider sends                 | per-channel limiter + jitter |
| `ai-reply`   | RAG completion per inbound message | concurrency small, LLM-bound |
| `embeddings` | chunk + embed KnowledgeDocs        | batch, retry with backoff    |
| `reminders`  | delayed appointment reminders      | delayed jobs, idempotent     |

All job payloads have Zod schemas in `packages/shared`. Jobs are idempotent:
re-running one must not double-send (guard on `providerMessageId` / job key).

---

## 10. Environment variables (parsed in config.ts, fail fast)

```
NODE_ENV=development PORT=4000
DATABASE_URL=
REDIS_URL=
MINIO_ENDPOINT= MINIO_ACCESS_KEY= MINIO_SECRET_KEY= MINIO_BUCKET=waos-media
EVOLUTION_API_URL= EVOLUTION_API_KEY= EVOLUTION_WEBHOOK_SECRET=
JWT_ACCESS_SECRET= JWT_REFRESH_SECRET=
GEMINI_API_KEY= LLM_MODEL_ID=gemini-2.5-flash
EMBEDDING_PROVIDER=gemini EMBEDDING_API_KEY= EMBEDDING_MODEL_ID=gemini-embedding-001 EMBEDDING_DIM=1536
AI_CONFIDENCE_THRESHOLD=0.7
REMINDER_OFFSETS_MINUTES=1440,120
SEND_RATE_PER_MINUTE=6
WARMUP_DAILY_CAPS=20,40,60,80,120,160,200,250,300,350,400,450,500,600
WEB_ORIGIN= API_PUBLIC_URL=
NEXT_PUBLIC_APP_NAME=WaOS
NEXT_PUBLIC_API_URL=
```

`.env.example` stays in sync with this list. Secrets never enter git.

---

## 11. Commands

```
pnpm install                 install workspace deps
pnpm dev                     api + web + workers concurrently
pnpm -F api dev              API only
pnpm -F web dev              dashboard only
pnpm db:migrate              prisma migrate dev
pnpm db:studio               prisma studio
pnpm lint / pnpm typecheck   must pass before any commit
pnpm test                    vitest
docker compose -f infra/docker-compose.yml up -d    infra services
```

---

## 12. Testing and definition of done

A feature is done when:

1. `pnpm typecheck` and `pnpm lint` pass with zero errors.
2. Services with logic have Vitest unit tests (policy engine, warm-up caps,
   confidence threshold branching, and tenant scoping are mandatory tests).
3. The Zod schema exists in `packages/shared` for any new boundary.
4. The dashboard surface has loading, empty, and error states (see the UX
   section of KICKOFF_PROMPT.md).
5. Copy exists in BOTH `en` and `sw` locale files. English-only strings are
   a lint failure.
6. Conventional commit(s) with a clear message.

---

## 13. Never do

- Never import a provider SDK or call Evolution/Meta URLs outside `adapters/`.
- Never send a message that did not pass the PolicyEngine.
- Never write payment, billing, checkout, or pricing-gate code in this phase.
- Never use `any`, em dashes, or English-only UI strings.
- Never query a domain table without an `organizationId` filter (the tenant
  Prisma extension enforces this; do not bypass it with `$queryRawUnsafe`).
- Never log message bodies, tokens, or QR payloads.
- Never edit committed Prisma migrations or Evolution's internal storage.
- Never remove the unofficial-tier ban-risk disclosure from the connect flow.

When in doubt, ask Edward before deviating from this file.
