# WaOS Revamp: Master Design (Modules, Shop, Gemini, UI)

Date: 2026-07-11
Status: Approved by Edward (direction and section-level design). Each phase below
still gets its own detailed spec and implementation plan before code.

## 1. Summary

WaOS grows from an AI receptionist for appointment businesses into a platform
with two modules a business can enable independently or together:

- **appointments**: what exists today (booking, reminders, opt-in).
- **shop**: a product catalog the AI sells from. It answers availability
  questions (including from customer photos), bargains within owner-set
  bounds, records orders, shares the owner's payment instructions, and
  alerts the owner on new orders and low stock.

At the same time: all AI moves to the Gemini API (chat, vision, embeddings),
the dashboard is restyled on a real design system (shadcn/ui), onboarding is
rebuilt around module selection, and the brand keeps the WaOS name with
sharper positioning ("answers, sells, and books on WhatsApp").

This supersedes CLAUDE.md's Phase 1 ban on a commerce layer, by owner
decision (2026-07-11). Payments remain out of scope: the platform never
processes money; the AI only relays the owner's payment instructions
(for example a Lipa Namba or M-Pesa number). CLAUDE.md is rewritten as part
of this revamp so the rulebook matches the new direction.

## 2. Decisions already made (with Edward)

| Question | Decision |
| --- | --- |
| Payments | Payment instructions only. No payment processing, ever, in this revamp. |
| Module exclusivity | A business can enable appointments, shop, or both, at onboarding or later in settings. |
| Brand | Keep the name WaOS; refresh positioning, landing, and visual identity. |
| Overall approach | Evolve the existing monolith module by module (no rewrite, no frontend rebuild). |
| AI provider | Gemini for everything: LLM, vision, embeddings. Anthropic adapter is removed. |

## 3. Modules (foundation)

- `Organization` gains a `modules` field (string list; values `appointments`,
  `shop`). Existing organizations are backfilled with `["appointments"]`.
- API: routes belonging to a disabled module return a typed `AppError` with
  code `MODULE_DISABLED` (HTTP 403). Gating lives in one middleware, not
  per-controller checks.
- Web: navigation and screens render only for enabled modules. Settings has
  a module toggle section.
- AI: the agent's tool set is assembled per conversation from the enabled
  modules (selling tools only exist when `shop` is on).
- Onboarding: step 1 asks "What does your business do?" (Take bookings /
  Sell products / Both) and sets `modules`.

## 4. Data model additions (shop)

All new tables carry `organizationId`, are indexed on it, and are covered by
the tenant Prisma extension (including the hand-maintained relation-fields
map in `apps/api/src/lib/tenant.ts`, which must be extended).

- **Product**: `name`, `description?`, `price Int` (whole TZS), `minPrice
  Int?` (bargaining floor; null means fixed price), `stockQty Int`,
  `lowStockThreshold Int` (default 5), `isActive Boolean` (default true),
  `tags String[]`, `embedding vector(1536)?` (built from name + description +
  AI-written photo descriptions; regenerated when any of those change).
- **ProductImage**: `productId`, `mediaKey` (MinIO), `description String`
  (Gemini vision writes it at upload time; feeds the product embedding).
- **Order**: `conversationId?`, `contactId`, `status` enum
  `PENDING_CONFIRMATION | CONFIRMED | PAID | FULFILLED | CANCELLED`,
  `totalAgreed Int`, `note?`.
- **OrderItem**: `orderId`, `productId`, `quantity Int`, `listPrice Int`,
  `agreedPrice Int`.
- **Notification**: `type` enum (`NEW_ORDER | LOW_STOCK | HANDOFF`),
  `payload Json`, `readAt DateTime?`. Emitted live over Socket.IO as
  `notification.new`; rendered by a dashboard bell.
- Organization settings gain: `paymentInstructions` (free text the AI sends
  after a deal), optional `ownerAlertPhone` + explicit opt-in flag for
  WhatsApp alerts to the owner.

Inventory rules: stock decrements only when the owner confirms an order
(`PENDING_CONFIRMATION -> CONFIRMED`). The low-stock check runs after every
decrement and on manual stock edits; crossing the threshold creates one
`LOW_STOCK` notification (not one per sale while below threshold).

## 5. Gemini AI engine

### 5.1 Adapters and ports

- `GeminiLlmAdapter` implements `LLMPort`; `GeminiEmbeddingAdapter`
  implements `EmbeddingPort`. The Gemini SDK/HTTP calls never leak past
  `apps/api/src/adapters/`.
- `LLMPort` is extended: message content becomes parts (text and image), and
  `LlmCompletionParams` gains optional `tools` (name, description, JSON
  schema) with structured `toolCalls` in the completion result (Gemini
  function calling underneath).
- Embeddings use a Gemini embedding model configured to output 1536
  dimensions, so the pgvector column `vector(1536)` does not change.
- Env: `GEMINI_API_KEY` replaces `ANTHROPIC_API_KEY`; `LLM_MODEL_ID`,
  `EMBEDDING_PROVIDER=gemini`, `EMBEDDING_MODEL_ID`, `EMBEDDING_DIM=1536`.
  `.env.example`, `config.ts`, and CLAUDE.md section 10 stay in sync.
- Migration task: re-embed every existing `KnowledgeChunk` once after the
  switch (embedding spaces are not compatible across providers). Runs
  through the existing embeddings queue, one job per doc.

### 5.2 The selling agent

The ai-reply worker upgrades from single-shot JSON to a bounded tool loop
(hard cap on tool rounds per turn). Tools, gated by module:

- `searchKnowledge(query)`: existing RAG retrieval.
- `searchProducts(query)`: vector search over product embeddings; a customer
  photo is first described by Gemini vision, and the description is embedded
  and searched the same way.
- `negotiate(productId, proposedPrice)`: THE SERVER ENFORCES THE FLOOR. The
  floor price is never written into the prompt. A proposal below `minPrice`
  is rejected by code and the tool result instructs the model to counter at
  the floor and state it is final.
- `recordOrder(items, agreedPrices)`: creates a `PENDING_CONFIRMATION` order
  after re-validating every item price against its floor in code, notifies
  the owner, and returns the payment instructions for the AI to relay.
- `handOff(reason)`: sets the conversation to PENDING, as today.

Unchanged semantics: confidence threshold and human handoff, `AiReplyLog`
per decision (extended with the tools used), reply in the customer's
language, answer only from business data.

Inbound trigger change: images now enqueue an AI reply too (today only TEXT
does). Other media types still do not.

### 5.3 Outbound media

The AI can send a product's photo in an active conversation. The outbound
worker's media path is finished as part of this: real mime types instead of
the hardcoded `application/octet-stream`, and services can set `mediaKey` on
outbound messages.

## 6. Policy engine additions

- New action `OWNER_ALERT` (proactive WhatsApp message to the owner's own
  number): allowed only when the owner has set a number and explicitly
  opted in; rate limited like reminders. Dashboard notifications need no
  policy (they are not WhatsApp sends).
- Product photo sends use the existing `MEDIA_ACTIVE_CONVERSATION` rule.
- Broadcast stays blocked (`COMING_SOON`). The ban-risk pacing (rate limit,
  jitter, warm-up caps) applies to all new send types unchanged.

## 7. Onboarding, restructured

1. **Profile**: business name, module selection (bookings / products /
   both), language, timezone.
2. **Connect WhatsApp**: unchanged, including the unofficial-tier ban-risk
   disclosure (never removed).
3. **Module setup**: appointments -> services and hours knowledge; shop ->
   add the first products (name, price, optional floor, stock, photo);
   both -> both sub-steps.
4. **Test your AI**: existing Q&A test, plus a mock bargain test for shops.

The step trail in the onboarding shell adapts to the module selection.

## 8. Dashboard UI revamp

- Adopt shadcn/ui on Tailwind v4, themed with the established identity:
  deep green brand ramp, warm amber accent, Inter loaded via `next/font`.
- Layout: desktop sidebar plus the existing mobile bottom nav; notification
  bell in the header.
- New screens: Products (list, add/edit, photos, stock, floor price) and
  Orders (list, confirm, mark paid, fulfil, cancel).
- Every existing screen restyled on the new kit; home dashboard gains sales
  KPIs (orders today, revenue agreed this week) beside booking KPIs.
- Under the hood: TanStack Query for fetching/caching with socket-driven
  invalidation (replaces hand-rolled per-page fetching), one central
  client-side auth guard (fixes the unguarded `/inbox/[id]` and
  `/onboarding/test`), all API response shapes moved to shared Zod schemas
  in `packages/shared` and runtime-validated.
- Dark mode ships at the end of this phase.
- Both locales stay complete; English-only strings remain a failure.

## 9. Brand and landing

- Name stays WaOS. Positioning: "Your business answers, sells, and books on
  WhatsApp, even when you are busy."
- Landing hero demo gains a second scripted scene (photo -> availability ->
  short bargain -> order confirmed -> payment instructions), alternating
  with the booking scene.
- Copy rewritten in en and sw. The public-facing naming rule (WaOS as the
  brand, WhatsApp only as the platform noun) is applied across landing and
  app copy.

## 10. Hardening (woven through every phase)

Fixed in the phase that touches the area:

- AI reply double-send guard (idempotency for retried ai-reply jobs).
- `message.updated` FAILED event includes `conversationId`.
- Embeddings job id becomes idempotent (drop the `Date.now()` suffix).
- Reminder worker only sends through a CONNECTED channel; otherwise skip
  and notify the owner.
- "Reminders sent" stat excludes BLOCKED messages.
- `.env.example` gains `WEB_ORIGIN` and `API_PUBLIC_URL`.
- Boundary schemas defined in controllers move to `packages/shared`.
- Dead `ChannelDto.phoneNumber` removed or populated for real.
- Unused transport Zod mirrors in `packages/shared` deleted.
- team-service goes through a repository like every other service.
- Revert the stray blank lines in `apps/web/messages/sw.json`; commit the
  compose host-port parametrization.
- CI: GitHub Actions running typecheck, lint, unit tests, the integration
  suites against a pgvector Postgres service, and the web build.
- CLAUDE.md rewritten: modules, shop scope (no payment processing; payment
  instructions only), Gemini as the AI provider, shadcn/ui, synced env list,
  updated policy table.

## 11. Testing (mandatory additions)

- Negotiation clamp: the accepted price can never be below the floor,
  regardless of what the model proposes.
- Order state machine: legal transitions only; stock decrements exactly once
  on confirm; low-stock notification fires exactly once per crossing.
- Module gating: disabled-module routes 403; tool set matches modules.
- Agent tool loop with a mocked LLM: tool-call round trip, round cap,
  handoff fallback.
- Photo pipeline with mocked Gemini: describe -> embed -> match -> answer.
- Policy: `OWNER_ALERT` allow/block matrix.
- Integration: full order flow (webhook message -> agent -> order ->
  confirm -> stock -> notification) against a real database.

## 12. Build order

| Phase | Delivers | Contents |
| --- | --- | --- |
| A: Foundation | Gemini everywhere, modules exist, new onboarding | LLMPort extension, both Gemini adapters, re-embed task, `modules` field + gating, onboarding rebuild, CI |
| B: Shop | A shop can actually sell | Product/Order/Notification models and APIs, agent tool loop, bargaining, vision, inventory and alerts, functional Products/Orders screens |
| C: UI revamp | The app looks like the landing promised | shadcn/ui system, restyle all screens, TanStack Query, central auth guard, bell, dark mode |
| D: Brand and landing | The story matches the product | positioning, selling demo scene, en+sw copy |

Each phase gets its own spec and implementation plan; Edward approves each
before implementation starts. Hardening items land in whichever phase touches
their area.

## 13. Out of scope (explicitly)

- Payment processing of any kind (only relaying owner payment instructions).
- Broadcasts (still blocked as COMING_SOON, unchanged).
- Cloud API transport (stub stays a stub).
- Carts and multi-step checkout flows: an order is what the AI and customer
  agreed in chat, nothing more.
- Delivery/logistics tracking.

## 14. Prerequisites

- A Gemini API key (Google AI Studio) in `.env` before Phase A testing.
- The local infra port remap (Postgres 5433, Redis 6380 on this machine)
  stays as is.
