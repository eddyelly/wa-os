# WaOS

The WhatsApp operating system for appointment-based local service businesses.
An AI assistant, grounded in the business's own data, answers customers, books
appointments, sends reminders, and hands off to a human when unsure.

Phase 1 (MVP) is free: no payment or billing code exists in this codebase.
Read `CLAUDE.md` for the architecture, standards, and scope rules before
contributing. `KICKOFF_PROMPT.md` tracks the milestone plan.

Organizations that turn on the `shop` module let the same AI also sell from a
product catalog: it searches products, negotiates within a floor price the
owner sets and the AI never sees, and records agreed orders as
`PENDING_CONFIRMATION` for the owner to confirm and get paid for outside the
platform. The dashboard adds Products and Orders screens for those
organizations to manage the catalog and confirm orders, and every
organization gets a realtime notification bell for new orders, low stock,
and handoffs.

## Stack

Express + TypeScript API, Prisma + PostgreSQL 16 (pgvector), BullMQ on Redis,
MinIO for media, Evolution API for the WhatsApp entry tier transport, Next.js
dashboard with Swahili and English via next-intl. Everything runs from one
pnpm monorepo, deployed with Docker Compose on a single VPS.

AI replies and embeddings run on Gemini (`@google/genai`); a `GEMINI_API_KEY`
is required for AI replies to work. If you switch `EMBEDDING_PROVIDER` or
`EMBEDDING_MODEL_ID` after documents already have embeddings, re-embed the
existing knowledge base with `pnpm -F @waos/api re-embed`.

## Prerequisites

- Node.js 20 or newer
- pnpm 10 (`corepack enable` or `npm i -g pnpm`)
- Docker with the Compose plugin (for the infra services)

## Setup

1. Install dependencies:

   ```bash
   pnpm install
   ```

2. Create your env file and fill in the values (the defaults work for local
   dev; set real secrets for anything shared):

   ```bash
   cp .env.example .env
   ```

3. Start the infra services (Postgres with pgvector, Redis, MinIO, Evolution
   API), then wait a few seconds for the healthchecks to go green:

   ```bash
   pnpm infra:up
   ```

4. Create the database schema and seed demo data:

   ```bash
   pnpm db:migrate
   pnpm db:seed
   ```

   The seed creates a demo business (Nuru Salon) with the owner login
   `demo@waos.dev` / `DemoOwner123!` (dev only).

## Run

```bash
pnpm dev
```

This boots both apps:

| Service          | URL                          |
| ---------------- | ---------------------------- |
| API              | http://localhost:4000        |
| API health check | http://localhost:4000/health |
| Dashboard        | http://localhost:3000        |
| MinIO console    | http://localhost:9001        |
| Evolution API    | http://localhost:8080        |

Run one app on its own with `pnpm -F @waos/api dev` or `pnpm -F @waos/web dev`.

### Try the API

```bash
# sign up a business (creates the Organization and its OWNER user)
curl -X POST http://localhost:4000/api/v1/auth/signup \
  -H 'Content-Type: application/json' \
  -d '{"businessName":"Amani Clinic","name":"Amani Mushi","email":"amani@example.com","password":"SafePass123!"}'

# log in
curl -X POST http://localhost:4000/api/v1/auth/login \
  -H 'Content-Type: application/json' \
  -d '{"email":"amani@example.com","password":"SafePass123!"}'

# call a protected route with the accessToken from the login response
curl http://localhost:4000/api/v1/auth/me -H "Authorization: Bearer <accessToken>"
```

## Checks and tests

```bash
pnpm typecheck   # strict TypeScript across all packages
pnpm lint        # eslint (no-explicit-any and no-floating-promises are errors)
pnpm test        # vitest unit tests
```

Integration tests (tenant isolation and the full auth flow against a real
database) are skipped unless you point them at a migrated database:

```bash
INTEGRATION_DATABASE_URL=postgresql://waos:waos@localhost:5432/waos_dev pnpm test
```

All three commands must pass before any commit (see `CLAUDE.md` section 12).

## Repository layout

```
apps/
  api/          Express API + BullMQ workers (routes -> controllers -> services -> repositories)
  web/          Next.js dashboard (App Router, Tailwind, next-intl)
packages/
  ports/        MessagingPort, LLMPort, EmbeddingPort contracts
  shared/       Zod schemas shared by api and web
infra/
  docker-compose.yml   postgres(pgvector), redis, minio, evolution-api
```

Two rules worth knowing on day one: every domain table is tenant-scoped by
`organizationId` (a Prisma extension enforces it, see
`apps/api/src/lib/tenant.ts`), and the core never talks to a messaging
provider directly, only through the `MessagingPort` interface in
`packages/ports`.

## Useful commands

| Command           | What it does                        |
| ----------------- | ----------------------------------- |
| `pnpm dev`        | api + web concurrently              |
| `pnpm infra:up`   | start infra services in Docker      |
| `pnpm infra:down` | stop infra services                 |
| `pnpm db:migrate` | prisma migrate dev                  |
| `pnpm db:seed`    | seed demo data                      |
| `pnpm db:studio`  | prisma studio (browse the database) |
| `pnpm format`     | prettier write                      |
