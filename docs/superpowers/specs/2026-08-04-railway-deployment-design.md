# WaOS on Railway

Date: 2026-08-04
Status: Approved by Edward (direction and section-level design, 2026-08-04).
One implementation plan follows before code.

## 1. Summary

WaOS currently deploys to a single Ubuntu VPS: Docker Compose for infra, pnpm
plus pm2 for the apps, Nginx for TLS (docs/RUNBOOK.md). This spec makes the
same stack deployable on Railway as six services in one project, so a deploy
is a `git push` rather than an SSH session.

Nothing about the application's behavior changes. This is packaging,
configuration, and documentation, plus three small code changes that the
current setup makes unavoidable (section 4).

## 2. Decisions made (with Edward, 2026-08-04)

| Decision | Choice |
| --- | --- |
| Media storage | An S3 bucket on Railway. Railway has no native managed S3 product, so this means running **MinIO** (the S3-compatible server already used locally) as a Railway service with a persistent volume. |
| WhatsApp transport | **Evolution API runs on Railway** as a Docker service with a volume. The QR is re-scanned once after the first deploy; the session then persists across restarts. |
| Build method | **Dockerfiles** for `api` and `web`, not Nixpacks. |
| API runtime | Keep running TypeScript through `tsx`. Not switching to a compiled build in this piece of work (section 4). |

## 3. Service topology

One Railway project, six services:

| Service | What it is | Persistence | Public? |
| --- | --- | --- | --- |
| `web` | Next.js dashboard, Dockerfile | none | yes |
| `api` | Express + Socket.IO + BullMQ workers (in-process), Dockerfile | none | yes |
| `postgres` | Postgres with the `vector` extension | Railway volume | no |
| `redis` | Redis (queues + Socket.IO adapter) | Railway volume | no |
| `minio` | S3-compatible object storage, `minio/minio` image | Railway volume at `/data` | yes |
| `evolution` | `evoapicloud/evolution-api:v2.3.7` | Railway volume at `/evolution/instances` | yes |

Traffic:

- Browser to `web` and to `api` (REST + Socket.IO websockets) over public
  domains.
- Browser and `evolution` fetch media from `minio` over its public domain
  (presigned URLs).
- `api` reaches `postgres`, `redis`, `minio`, and `evolution` over Railway's
  private network.
- `evolution` posts webhooks to `api` over the private network.

`minio` is public because presigned media URLs must be openable by the
browser and fetchable by Evolution. `evolution` is public only so its manager
UI is reachable for debugging; its API is protected by
`AUTHENTICATION_API_KEY`.

## 4. Code changes required (three, all small)

These are not optional polish; the current repo cannot boot on Railway
without them.

1. **`apps/api` production start script.** `start` runs
   `dotenv -e ../../.env -- tsx src/index.ts`. Railway injects environment
   variables directly and there is no `.env` file, so this fails at boot. Add
   `"start:prod": "tsx src/index.ts"`, used by the Dockerfile. The existing
   `dev` and `start` scripts are left untouched so the VPS and local flows
   keep working.
2. **`tsx` moves from devDependencies to dependencies** in `apps/api`. The
   API runs *through* tsx, so in a production image with dev dependencies
   pruned it is a missing runtime.
3. **A `db:deploy:prod` script**: `prisma migrate deploy` without the dotenv
   wrapper, for the Railway pre-deploy command.

**Deliberately not done here:** compiling the API to JavaScript.
`@waos/shared` and `@waos/ports` ship raw TypeScript (`main: ./src/index.ts`,
no build script), so a compiled API means restructuring both packages with
build steps and export maps. That is a legitimate future cleanup, and it is
not bundled into "make it deploy". Running `tsx` in production is supported;
the cost is a slightly slower cold start and a larger dependency tree.

## 5. Dockerfiles

Both are multi-stage and pnpm-workspace aware, built from the **repository
root** (Railway root directory `/`, with each service pointed at its own
Dockerfile).

**`apps/api/Dockerfile`**
1. `base`: `node:20-alpine`, `corepack enable`.
2. `deps`: copy the root `package.json`, `pnpm-lock.yaml`,
   `pnpm-workspace.yaml`, and the `package.json` of `apps/api`,
   `packages/shared`, `packages/ports`; `pnpm install --frozen-lockfile`.
3. `runtime`: copy `node_modules` and the source for `apps/api`,
   `packages/shared`, `packages/ports`; run `prisma generate`; `EXPOSE 4000`;
   `CMD ["pnpm", "-F", "@waos/api", "start:prod"]`.

Prisma's client is generated at image build time so no generation happens at
boot.

**`apps/web/Dockerfile`**
1. Same `base` and `deps` stages, for `apps/web`, `packages/shared`,
   `packages/ports`.
2. `build`: `next build`, with `NEXT_PUBLIC_API_URL` and
   `NEXT_PUBLIC_APP_NAME` passed as **build arguments** (section 6).
3. `runtime`: `CMD ["pnpm", "-F", "@waos/web", "start"]`, `EXPOSE 3000`.

A root `.dockerignore` excludes `node_modules`, `.next`, `.git`,
`.superpowers`, and `docs`.

## 6. Environment variables

The complete contract, from `apps/api/src/lib/config.ts`. Values shown as
`${{Service.VAR}}` are Railway reference variables.

**`api` service (all runtime):**

| Variable | Value |
| --- | --- |
| `NODE_ENV` | `production` |
| `PORT` | `4000` |
| `DATABASE_URL` | `${{Postgres.DATABASE_URL}}` |
| `REDIS_URL` | `${{Redis.REDIS_URL}}` |
| `MINIO_ENDPOINT` | the public MinIO domain, e.g. `https://minio-production.up.railway.app` |
| `MINIO_PUBLIC_ENDPOINT` | the same public MinIO domain |
| `MINIO_ACCESS_KEY` / `MINIO_SECRET_KEY` | match the MinIO service's root credentials |
| `MINIO_BUCKET` | `waos-media` |
| `EVOLUTION_API_URL` | private Evolution URL, e.g. `http://evolution.railway.internal:8080` |
| `EVOLUTION_API_KEY` | a strong generated key, identical to Evolution's `AUTHENTICATION_API_KEY` |
| `EVOLUTION_WEBHOOK_SECRET` | a strong generated secret |
| `JWT_ACCESS_SECRET` / `JWT_REFRESH_SECRET` | distinct random strings, 32+ characters (enforced by config) |
| `GEMINI_API_KEY`, `LLM_MODEL_ID` | as today |
| `EMBEDDING_PROVIDER`, `EMBEDDING_API_KEY`, `EMBEDDING_MODEL_ID`, `EMBEDDING_DIM` | as today |
| `AI_CONFIDENCE_THRESHOLD`, `REMINDER_OFFSETS_MINUTES`, `SEND_RATE_PER_MINUTE`, `WARMUP_DAILY_CAPS` | optional; defaults apply |
| `WEB_ORIGIN` | the public `web` domain (CORS + Socket.IO origin) |
| `API_PUBLIC_URL` | the **private** api URL, e.g. `http://api.railway.internal:4000`, because its only consumer is Evolution's webhook registration |

**`web` service:**

| Variable | Scope | Value |
| --- | --- | --- |
| `NEXT_PUBLIC_API_URL` | **build** | the public `api` domain |
| `NEXT_PUBLIC_APP_NAME` | **build** | `WaOS` |
| `PORT` | runtime | `3000` |

`NEXT_PUBLIC_*` values are inlined into the client bundle by `next build`. If
they are set only as runtime variables, the deployed dashboard calls
`http://localhost:4000` and every request fails. This is the single most
common way this deployment breaks.

**`minio` service:** `MINIO_ROOT_USER`, `MINIO_ROOT_PASSWORD`, command
`server /data --console-address ":9001"`, volume at `/data`. No bucket-init
sidecar: the API's `ensureBucket()` creates the bucket at boot.

**`evolution` service:** ported from `infra/docker-compose.yml`, notably
`SERVER_URL` (its own public domain), `AUTHENTICATION_API_KEY`,
`DATABASE_ENABLED=true`, `DATABASE_PROVIDER=postgresql`,
`DATABASE_CONNECTION_URI` (pointing at the `evolution` database, section 7),
`DATABASE_SAVE_DATA_INSTANCE=true`, **`DATABASE_SAVE_DATA_NEW_MESSAGE=true`**,
`CACHE_REDIS_ENABLED=true`, `CACHE_REDIS_URI` (Redis with `/6` appended),
`CACHE_REDIS_PREFIX_KEY=evolution`, `CACHE_LOCAL_ENABLED=false`,
`DEL_INSTANCE=false`, volume at `/evolution/instances`.

`DATABASE_SAVE_DATA_NEW_MESSAGE=true` is load-bearing and easy to lose: with
it `false`, Evolution does not persist inbound messages and every media
download fails with "Message not found", which silently breaks customer
photos and voice notes.

## 7. Database setup

Two facts to handle before the first deploy:

1. **pgvector.** The initial migration runs
   `CREATE EXTENSION IF NOT EXISTS "vector"`. Whether Railway's Postgres
   image ships pgvector is **not assumed by this spec**: the deployment doc
   opens with a verification step, `SELECT * FROM pg_available_extensions
   WHERE name = 'vector';`, run in Railway's query console. If it returns a
   row, the managed Postgres is used as-is. If it returns nothing, the
   documented fallback is to deploy `pgvector/pgvector:pg16` as a Docker
   service with a volume and point `DATABASE_URL` at it. Both paths are
   written out; the check decides which one is followed.
2. **Evolution's database.** Evolution needs its own database, not just its
   own schema. Railway's Postgres provisions a single database, so the doc
   includes one command, `CREATE DATABASE evolution;`, and
   `DATABASE_CONNECTION_URI` is `DATABASE_URL` with the database name
   swapped.

Migrations run as the `api` service's **pre-deploy command**
(`pnpm -F @waos/api db:deploy:prod`), so the schema is current before the new
container serves traffic and a failed migration blocks the deploy rather than
half-applying at runtime.

## 8. Health checks and deployment behavior

- `api` health check path `/health` (the route already exists and returns
  200 without touching the database, so it reports process liveness).
- `web` health check path `/`.
- Both services get Railway's default restart policy.
- Sessions survive restarts: the API's boot reconcile
  (`channelService.reconcileAllOnBoot`) already resyncs channel status from
  Evolution, and Evolution's own volume holds the WhatsApp credentials.

## 9. Documentation deliverable

`docs/RAILWAY.md`, written to be followed top to bottom on a first deploy:
the pgvector check, service-by-service creation, the full variable map, the
`CREATE DATABASE evolution` step, the QR pairing walkthrough, a verification
checklist (health endpoint, dashboard login, a QR scan, one inbound message
producing an AI reply), and a troubleshooting section covering the failure
modes already met in this project: `NEXT_PUBLIC_API_URL` baked wrong, a
missing `vector` extension, `DATABASE_SAVE_DATA_NEW_MESSAGE=false` breaking
media, and a stalled Evolution instance needing a restart.

`docs/RUNBOOK.md` gains a short section pointing at the Railway path and
keeps the VPS instructions, which remain valid.

## 10. Boundaries and constraints

- No application behavior changes. The only source edits are the three in
  section 4, all confined to `apps/api/package.json`.
- No secrets in the repository. `.env.example` documents names only, as
  today.
- The existing VPS path (`infra/docker-compose.yml`, RUNBOOK sections 1 to 4)
  keeps working unchanged.
- No em dashes, conventional commits, and the existing gates
  (`pnpm -F @waos/api typecheck && test`, `pnpm lint`,
  `pnpm -F @waos/web typecheck && build`) stay green.
- Docker images must build locally before the work is considered done; a
  Dockerfile that only builds on Railway is not verified.

## 11. Out of scope (explicitly)

- CI/CD auto-deploy pipelines and GitHub integration beyond Railway's default
  deploy-on-push.
- Staging or preview environments.
- Custom domains and their TLS.
- Database backups, restore drills, and disaster recovery.
- Horizontal scaling: the API runs its BullMQ workers in-process, so running
  more than one API replica would duplicate scheduled work. Single replica is
  the supported topology, and splitting workers into their own service is a
  separate piece of work.
- Compiling the API to JavaScript (section 4).

## 12. Sequencing (decomposition)

One implementation plan, roughly three tasks:

1. **Make the API bootable in production**: the three `apps/api/package.json`
   changes, verified by starting the API with environment variables and no
   `.env` file.
2. **Dockerfiles and `.dockerignore`**: both images build locally from the
   repository root and start.
3. **`docs/RAILWAY.md` and the RUNBOOK pointer**: the full deployment
   walkthrough, variable map, and troubleshooting.

## 13. Success criteria

- `docker build -f apps/api/Dockerfile .` and
  `docker build -f apps/web/Dockerfile .` both succeed locally, and the API
  image starts and serves `/health` with variables supplied through the
  environment.
- The API starts with no `.env` file present.
- `docs/RAILWAY.md` is complete enough to follow start to finish without
  guessing: every variable has a stated value or source, and the pgvector
  branch is decided by a documented check rather than an assumption.
- Existing gates stay green and the VPS path still works.
