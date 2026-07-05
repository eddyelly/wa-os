# KICKOFF PROMPT - WaOS Phase 1 (MVP, free tier)

Paste this into Claude Code from the repo root. CLAUDE.md must already be in
the root.

---

You are the implementation partner for WaOS, an AI-native WhatsApp platform
for small Tanzanian businesses. Read `CLAUDE.md` completely before doing
anything. It defines the architecture, stack, standards, data model, and the
hard scope rules. The two most important scope rules: everything in this
phase is free (zero payment or billing code), and the core must stay
transport-agnostic behind the MessagingPort interface.

Your mission for Phase 1: a business owner can sign up, save their business
profile, connect their WhatsApp number by scanning a QR code, upload their
business knowledge, and watch the AI answer real customers in Swahili or
English, with clean human handoff, basic appointment booking, and automated
reminders. All of it usable by a non-technical owner on a phone.

Work milestone by milestone. Do not start a milestone until I approve the
previous checkpoint.

---

## Milestone 0: Foundation (scaffold)

Deliver:

1. pnpm monorepo exactly as laid out in CLAUDE.md section 5, with strict
   tsconfig, ESLint (no-floating-promises, no-explicit-any as errors),
   Prettier, and a root `pnpm dev`.
2. `infra/docker-compose.yml`: postgres:16 with pgvector (persistent volume),
   redis, minio, evolution-api (persistent volume for sessions), plus
   healthchecks. A `pnpm infra:up` script.
3. Full Prisma schema per CLAUDE.md section 7, first migration, and a seed
   script creating a demo Organization, owner User, and sample KnowledgeDoc.
4. `config.ts` that Zod-parses every env var and crashes at boot with a
   readable message when one is missing. `.env.example` complete.
5. Express app skeleton: health route, error middleware, request logging
   (pino), auth routes (signup, login, refresh) with argon2 + JWT.
6. Signup IS the "save your business" moment: one endpoint that creates the
   Organization and the OWNER User in a single transaction.
7. Tenant safety: a Prisma client extension that injects `organizationId`
   into every query for domain models, sourced from the authenticated
   request context. A unit test proving cross-tenant reads fail.

Checkpoint: `pnpm dev` boots clean, seed works, signup/login round-trips via
curl, typecheck/lint/test pass. Show me the tree and the test output.

## Milestone 1: Transport + realtime inbox

Deliver:

1. `packages/ports`: MessagingPort, IncomingMessage, SendResult,
   SessionStatus types with Zod schemas in `packages/shared`.
2. `EvolutionAdapter` implementing MessagingPort against the Evolution API
   (one Evolution instance per Channel; instance name = channel id). Verify
   exact endpoint paths and webhook event shapes against the current
   Evolution API docs at implementation time rather than assuming them, and
   isolate every Evolution-specific detail inside the adapter.
3. Channel lifecycle: create channel -> `connect()` returns QR payload ->
   dashboard shows QR -> webhook confirms connection -> `Channel.status`
   updates -> Socket.IO `channel.status_changed`. On API boot, reconcile all
   channel statuses so sessions survive restarts (CLAUDE.md 3.4).
4. Inbound pipeline: webhook route (verify `EVOLUTION_WEBHOOK_SECRET`) ->
   normalize -> upsert Contact + Conversation -> store Message -> media to
   MinIO -> emit `message.new`.
5. Outbound pipeline: `outbound` BullMQ queue with PolicyEngine check,
   per-channel rate limiter, jitter, warm-up daily caps, and provider ack
   updating `Message.status`.
6. PolicyEngine with the rule table from CLAUDE.md 3.2 and unit tests for
   every rule, including the COMING_SOON broadcast block.
7. CloudApiAdapter stub that satisfies the interface and throws
   NotImplementedError, proving the port swaps.
8. Dashboard: login, onboarding wizard steps 1 to 2 (business profile,
   connect WhatsApp with live QR + status), and a working realtime Inbox
   (conversation list, thread view, composer sending through the pipeline,
   assignment, conversation status).

Checkpoint: I will connect a real test number, message it from another phone,
see it appear live in the Inbox, and reply from the dashboard.

## Milestone 2: The AI brain (RAG auto-reply + handoff)

Deliver:

1. Knowledge screen: paste text or upload .txt/.md/.pdf, list docs, delete.
   Upload triggers the `embeddings` queue: extract, chunk (~500 tokens with
   overlap), embed via EmbeddingPort, store in pgvector.
2. Retrieval repository: top-k cosine similarity via raw SQL, scoped to the
   organization, with a small relevance floor.
3. `ai-reply` worker per CLAUDE.md section 8: context + chunks -> LLMPort ->
   strict JSON `{ reply, confidence, intent }` (Zod-parse the model output,
   one repair retry on invalid JSON) -> send as AI when confidence clears
   `AI_CONFIDENCE_THRESHOLD`, otherwise set conversation to PENDING and
   notify agents. Log every decision to AiReplyLog.
4. System prompt requirements: answer ONLY from provided business context,
   reply in the contact's language (Swahili or English, detect from their
   message), stay concise and polite, never invent prices or availability,
   and when unsure say a human will follow up (that response must carry low
   confidence so it hands off).
5. Inbox AI controls: per-conversation AI on/off toggle, visible AI badge on
   AI messages, a "Needs attention" filter for PENDING conversations, and a
   takeover action that mutes AI for that thread.
6. Vitest coverage for threshold branching and for tenant isolation of
   retrieval.

Checkpoint: live demo. I message the test number a question answered by the
uploaded knowledge (in Swahili), the AI replies correctly; I ask something
outside the knowledge and it hands off to the inbox.

## Milestone 3: Bookings + reminders

Deliver:

1. Appointments CRUD: calendar-style list (day/week), quick-create from a
   conversation (prefill the contact), service name, notes.
2. Reminder scheduling: creating an appointment enqueues delayed reminder
   jobs (24h and 2h before, config-driven), idempotent, cancelled when the
   appointment is cancelled or moved. Reminders require `optedInAt` and pass
   through the normal policy + send pipeline.
3. Opt-in capture: one-tap action in the conversation thread to record
   consent ("Customer agreed to receive reminders"), stored with timestamp.
4. AI booking intent (thin slice): when intent = booking, the AI proposes
   available context it knows and hands off to a human to confirm the slot.
   Fully autonomous booking is Phase 2; do not build slot inventory yet.
5. Reminder templates in en + sw with variables (name, service, time), a
   NO_SHOW/COMPLETED marking action, and a simple weekly count of reminders
   sent and no-shows marked (the ROI seed metric).

Checkpoint: book a test appointment 10 minutes out with a 5 minute reminder
override in dev config, watch the reminder arrive on WhatsApp.

## Milestone 4: Polish + hardening

Deliver:

1. Onboarding wizard completed end to end (profile -> connect -> knowledge ->
   test it: a built-in "send yourself a test question" step).
2. Contacts screen: search, tags, language, opt-in status, custom fields.
3. Settings: business profile, team members (invite STAFF by email), AI
   settings (threshold slider with plain-language labels, business tone
   notes appended to the system prompt).
4. Dashboard home: today's conversations, AI deflection % (from AiReplyLog),
   pending handoffs, upcoming appointments.
5. Empty/loading/error states on every screen per the UX brief, full sw + en
   locale coverage, mobile pass on every screen at 360px width.
6. Rate-limit auth routes, helmet, CORS locked to the dashboard origin,
   webhook signature tests, and a `docs/RUNBOOK.md` (deploy on the VPS,
   rotate keys, recover a disconnected session).

Checkpoint: full walkthrough as a brand-new business on a phone, from signup
to a working AI number, with zero touching of code or terminal.

---

## UX brief (this is a product for non-technical owners)

The person using this runs a salon or clinic and lives on a phone. Every
screen must pass the "busy owner between customers" test.

1. Mobile-first. Design at 360px, then scale up. Primary actions thumb-reach
   at the bottom on mobile.
2. Language: Swahili and English toggle in the header, next-intl, default
   from the Organization. Copy is plain and verb-first: "Connect your
   WhatsApp", "Add your business info", "Reply". Name things by what the
   owner controls, never by how the system works: "Business info", not
   "Knowledge base config"; "Turn AI off for this chat", not "Disable agent".
   A button says exactly what happens, and the same action keeps the same
   name everywhere (Save saves, and the toast says Saved).
3. The signature element is the onboarding wizard: it reads like a friendly
   conversation, one question per screen, progress dots, big inputs, and a
   live preview moment when their WhatsApp connects (show the QR large with
   the exact phone steps to scan it).
4. Chat UI follows conventions people already know from WhatsApp: bubbles,
   timestamps, ticks for sent/delivered, clear visual difference between
   customer, human agent, and AI (AI bubbles get a small badge and distinct
   tint).
5. Empty states are invitations with one clear action ("No conversations
   yet. Share your WhatsApp number with a customer to see them here."), and
   errors say what happened plus how to fix it, never a bare "Something went
   wrong".
6. Visual direction: clean, warm, and confident. Deep green anchored
   palette (WhatsApp-adjacent so it feels native to the job, but NOT
   WhatsApp's exact green), one warm accent used sparingly for primary
   actions, generous spacing, rounded-but-not-bubbly radius, a readable
   humanist sans for UI. No cream-and-serif landing page defaults, no
   dark-theme-with-acid-green. Accessibility floor: visible focus states,
   AA contrast, reduced motion respected.
7. Every list has loading skeletons. Nothing blocks on the AI: the inbox is
   always usable even if the LLM provider is down.

---

## Out of scope for Phase 1 (do not build, do not scaffold)

Payments or billing of any kind, pricing pages, plan gating, commerce
(catalog/cart/orders), broadcasts and drip campaigns (policy-blocked as
COMING_SOON), the Cloud API adapter beyond the stub, visual flow builder,
third-party integrations (calendar sync, Sheets, stores), developer API keys
and outbound webhooks, self-serve password reset email flows (a manual admin
reset script is fine for now), and multi-vertical config UIs.

If a task seems to need one of these, stop and ask.

---

## Working agreement

1. Before each milestone: post a short plan (files you will create, schema or
   contract changes, questions). Wait for my go.
2. Small conventional commits as you go, not one giant commit per milestone.
3. `pnpm typecheck && pnpm lint && pnpm test` must pass before you declare a
   checkpoint. Include the output.
4. When the Evolution API docs disagree with an assumption in this prompt,
   follow the docs, isolate the difference inside the adapter, and tell me.
5. Never widen scope. Free tier only. No payment code.
6. All the standards in CLAUDE.md apply to every line you write: strict TS,
   no `any`, no em dashes, Zod at boundaries, en + sw copy.

Start now with Milestone 0. Post your plan first.
