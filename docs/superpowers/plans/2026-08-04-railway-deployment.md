# Railway Deployment Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make WaOS deployable on Railway as six services, with production-bootable API scripts, two working Dockerfiles, and a deployment guide complete enough to follow without guessing.

**Architecture:** Three small `apps/api/package.json` changes make the API bootable without a `.env` file; two multi-stage pnpm-workspace-aware Dockerfiles (built from the repository root) package the API and web; `docs/RAILWAY.md` carries the click-by-click walkthrough, the full variable map, and the troubleshooting section. No application behavior changes.

**Tech Stack:** Docker (node:20-alpine), pnpm 10.33.0 via corepack, Prisma, Next.js 15, Railway.

## Global Constraints

- **No application behavior changes.** The only source edits are in `apps/api/package.json`. (Spec section 10.)
- **The existing VPS path keeps working**: `infra/docker-compose.yml` and RUNBOOK sections 1 to 4 stay valid; `dev` and `start` scripts are untouched. (Spec section 10.)
- **No secrets in the repository.** `.env.example` documents names only. (Spec section 10.)
- **Images must build locally.** A Dockerfile that only builds on Railway is not verified. (Spec section 10.)
- **`DATABASE_SAVE_DATA_NEW_MESSAGE=true`** is load-bearing for Evolution: with it false, inbound media downloads fail with "Message not found". (Spec section 6.)
- **`NEXT_PUBLIC_*` are build-time**, inlined by `next build`. Set only at runtime, the dashboard calls `localhost:4000` in production. (Spec section 6.)
- **No em dashes. Conventional commits.** Existing gates stay green: `pnpm -F @waos/api typecheck && pnpm -F @waos/api test && pnpm lint` and `pnpm -F @waos/web typecheck && pnpm -F @waos/web build`.

---

## File Structure

- Modify: `apps/api/package.json` (Task 1).
- Create: `apps/api/Dockerfile`, `apps/web/Dockerfile`, `.dockerignore` (Task 2).
- Create: `docs/RAILWAY.md`; Modify: `docs/RUNBOOK.md` (Task 3).

**Verified facts the tasks rely on:** Node `>=20`, `packageManager: pnpm@10.33.0`; workspace globs `apps/*` and `packages/*`; `apps/web` has no `output: 'standalone'`, so `next start` runs with `node_modules` present; `next.config.ts` sets `transpilePackages: ['@waos/shared']` and `outputFileTracingRoot` to the repo root; the API's Prisma schema is at `apps/api/prisma/schema.prisma` with default client output; `API_PUBLIC_URL`'s only consumer is the Evolution webhook URL (`channel-service.ts:11`); the API calls `ensureBucket()` at boot, so no bucket-init sidecar is needed.

---

### Task 1: Make the API bootable in production

**Files:**
- Modify: `apps/api/package.json`

**Interfaces:**
- Produces: `pnpm -F @waos/api start:prod` (starts the API reading configuration from the process environment, no `.env` file) and `pnpm -F @waos/api db:deploy:prod` (runs `prisma migrate deploy` the same way). Both are consumed by Task 2's Dockerfile and Task 3's Railway pre-deploy command.

- [ ] **Step 1: Move `tsx` to dependencies and add the production scripts**

In `apps/api/package.json`:

1. Delete `"tsx": "^4.19.0"` from `devDependencies` and add it to `dependencies` (keep the same version range). The API executes through `tsx`, so in a production install with dev dependencies pruned it is a missing runtime, not a build tool.
2. Add two scripts next to the existing ones, leaving `dev`, `start`, and `db:deploy` untouched so the local and VPS flows keep working:

```json
    "start:prod": "tsx src/index.ts",
    "db:deploy:prod": "prisma migrate deploy",
```

The difference from `start` and `db:deploy` is only the absence of the `dotenv -e ../../.env --` prefix: Railway injects variables into the process environment directly, and the dotenv wrapper fails when the file does not exist.

- [ ] **Step 2: Verify the API boots with no `.env` file**

The check that matters is that configuration comes from the environment. Run from the repository root, with the local infra already up (`pnpm infra:up`):

```bash
env -i PATH="$PATH" HOME="$HOME" \
  NODE_ENV=production PORT=4100 \
  DATABASE_URL='postgresql://waos:waos@localhost:5433/waos_dev' \
  REDIS_URL='redis://localhost:6380' \
  MINIO_ENDPOINT='localhost:9000' MINIO_ACCESS_KEY='waos' MINIO_SECRET_KEY='waos-secret' \
  EVOLUTION_API_URL='http://localhost:8080' EVOLUTION_API_KEY='x' EVOLUTION_WEBHOOK_SECRET='y' \
  JWT_ACCESS_SECRET='0123456789012345678901234567890123' \
  JWT_REFRESH_SECRET='1234567890123456789012345678901234' \
  GEMINI_API_KEY='x' LLM_MODEL_ID='gemini-2.5-flash' \
  EMBEDDING_PROVIDER='gemini' EMBEDDING_API_KEY='x' EMBEDDING_MODEL_ID='gemini-embedding-001' \
  ./node_modules/.bin/pnpm -F @waos/api start:prod
```

Expected: the log line `api listening` with `port: 4100`, and no dotenv error. Confirm from a second terminal:

```bash
curl -s -o /dev/null -w '%{http_code}\n' http://localhost:4100/health
```

Expected: `200`. Then stop the process with Ctrl+C.

Note: `env -i` deliberately clears the environment to prove nothing is being read from a file or an inherited shell variable. If the local infra ports differ from the repository defaults, use the values in `.env` (Postgres is on 5433 and Redis on 6380 on this machine).

- [ ] **Step 3: Run the API gate**

Run: `pnpm -F @waos/api typecheck && pnpm -F @waos/api test && pnpm lint`
Expected: all clean. Moving `tsx` between dependency groups does not change resolution, so the suite is unaffected.

- [ ] **Step 4: Commit**

```bash
git add apps/api/package.json
git commit -m "chore(api): add production start and migrate scripts for Railway"
```

---

### Task 2: Dockerfiles for the API and web

**Files:**
- Create: `apps/api/Dockerfile`, `apps/web/Dockerfile`, `.dockerignore`

**Interfaces:**
- Consumes: Task 1's `start:prod` script.
- Produces: two images buildable from the repository root, consumed by Task 3's documentation.

- [ ] **Step 1: Create the root `.dockerignore`**

Create `.dockerignore` at the repository root. Excluding `node_modules` matters for more than image size: it keeps a host-built `node_modules` (with host-specific binaries and a possibly different pnpm layout) from overwriting the one installed inside the image.

```
node_modules
**/node_modules
.next
**/.next
.git
.github
.superpowers
docs
*.log
.env
.env.*
!.env.example
coverage
**/coverage
```

- [ ] **Step 2: Create the API Dockerfile**

Create `apps/api/Dockerfile`:

```dockerfile
# syntax=docker/dockerfile:1

# Built from the REPOSITORY ROOT (the pnpm workspace), not from apps/api:
#   docker build -f apps/api/Dockerfile .
FROM node:20-alpine AS base
RUN corepack enable
WORKDIR /app

# Dependencies first, so a source-only change reuses this layer. Only the
# manifests are copied here; the lockfile install is what we want cached.
FROM base AS deps
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/api/package.json apps/api/
COPY packages/shared/package.json packages/shared/
COPY packages/ports/package.json packages/ports/
RUN pnpm install --frozen-lockfile

# Inheriting from deps keeps node_modules in every workspace location pnpm
# put them, which is more reliable than copying those paths by hand.
FROM deps AS runtime
ENV NODE_ENV=production
COPY packages/ports packages/ports
COPY packages/shared packages/shared
COPY apps/api apps/api
# Generate the Prisma client at build time so boot does no codegen. The URL is
# only read at runtime; a placeholder satisfies the schema during generate.
RUN DATABASE_URL="postgresql://placeholder:placeholder@localhost:5432/placeholder" \
    pnpm -F @waos/api exec prisma generate
EXPOSE 4000
CMD ["pnpm", "-F", "@waos/api", "start:prod"]
```

- [ ] **Step 3: Create the web Dockerfile**

Create `apps/web/Dockerfile`. The `ARG` lines are the important part: Railway supplies service variables as build arguments, and `next build` inlines `NEXT_PUBLIC_*` into the client bundle.

```dockerfile
# syntax=docker/dockerfile:1

# Built from the REPOSITORY ROOT (the pnpm workspace), not from apps/web:
#   docker build -f apps/web/Dockerfile .
FROM node:20-alpine AS base
RUN corepack enable
WORKDIR /app

FROM base AS deps
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/web/package.json apps/web/
COPY packages/shared/package.json packages/shared/
COPY packages/ports/package.json packages/ports/
RUN pnpm install --frozen-lockfile

FROM deps AS runtime
ENV NODE_ENV=production
# NEXT_PUBLIC_* values are baked into the client bundle by `next build`. They
# must be present HERE, at build time: setting them only at runtime ships a
# dashboard that calls http://localhost:4000.
ARG NEXT_PUBLIC_API_URL
ARG NEXT_PUBLIC_APP_NAME=WaOS
ENV NEXT_PUBLIC_API_URL=$NEXT_PUBLIC_API_URL
ENV NEXT_PUBLIC_APP_NAME=$NEXT_PUBLIC_APP_NAME
COPY packages/ports packages/ports
COPY packages/shared packages/shared
COPY apps/web apps/web
RUN pnpm -F @waos/web build
EXPOSE 3000
CMD ["pnpm", "-F", "@waos/web", "start"]
```

- [ ] **Step 4: Build both images locally**

```bash
docker build -f apps/api/Dockerfile -t waos-api:local .
docker build -f apps/web/Dockerfile \
  --build-arg NEXT_PUBLIC_API_URL=http://localhost:4000 \
  -t waos-web:local .
```

Expected: both succeed. The web build must print its route table (the same output `pnpm -F @waos/web build` produces locally).

If the API build fails during `prisma generate` with a schema-engine download or network error, that is an environment issue rather than a Dockerfile defect: report it with the exact error rather than working around it by removing the generate step, which would move codegen to boot.

- [ ] **Step 5: Verify the API image serves health**

Run the image against the local infra. `host.docker.internal` reaches the host from inside the container (the compose file already relies on this for Evolution):

```bash
docker run --rm -p 4100:4000 \
  --add-host=host.docker.internal:host-gateway \
  -e NODE_ENV=production \
  -e DATABASE_URL='postgresql://waos:waos@host.docker.internal:5433/waos_dev' \
  -e REDIS_URL='redis://host.docker.internal:6380' \
  -e MINIO_ENDPOINT='host.docker.internal:9000' \
  -e MINIO_ACCESS_KEY='waos' -e MINIO_SECRET_KEY='waos-secret' \
  -e EVOLUTION_API_URL='http://host.docker.internal:8080' \
  -e EVOLUTION_API_KEY='x' -e EVOLUTION_WEBHOOK_SECRET='y' \
  -e JWT_ACCESS_SECRET='0123456789012345678901234567890123' \
  -e JWT_REFRESH_SECRET='1234567890123456789012345678901234' \
  -e GEMINI_API_KEY='x' -e LLM_MODEL_ID='gemini-2.5-flash' \
  -e EMBEDDING_PROVIDER='gemini' -e EMBEDDING_API_KEY='x' \
  -e EMBEDDING_MODEL_ID='gemini-embedding-001' \
  waos-api:local
```

In a second terminal:

```bash
curl -s -o /dev/null -w '%{http_code}\n' http://localhost:4100/health
```

Expected: `200`, and the container log shows `api listening`. Stop the container with Ctrl+C. Use the real MinIO credentials from `.env` if they differ from the defaults above.

- [ ] **Step 6: Commit**

```bash
git add .dockerignore apps/api/Dockerfile apps/web/Dockerfile
git commit -m "feat(deploy): add API and web Dockerfiles for Railway"
```

---

### Task 3: The Railway deployment guide

**Files:**
- Create: `docs/RAILWAY.md`
- Modify: `docs/RUNBOOK.md`

**Interfaces:**
- Consumes: Task 1's scripts (`start:prod`, `db:deploy:prod`) and Task 2's Dockerfiles.

- [ ] **Step 1: Write `docs/RAILWAY.md`**

Create `docs/RAILWAY.md` covering, in this order. Every variable value below comes from the spec's variable map (spec section 6); copy it exactly rather than paraphrasing.

**Section 1, before you start.** A Railway account, this repository on GitHub, a Gemini API key, and roughly 20 minutes. State that the QR is re-scanned once at the end.

**Section 2, the pgvector check (do this first).** Create the project and add a Postgres service, then run in Railway's query console:

```sql
SELECT * FROM pg_available_extensions WHERE name = 'vector';
```

- A row returned: the managed Postgres works; continue.
- No rows: delete it and instead add a service from the Docker image `pgvector/pgvector:pg16` with a volume mounted at `/var/lib/postgresql/data` and `POSTGRES_USER`, `POSTGRES_PASSWORD`, `POSTGRES_DB` set; use its connection string wherever `${{Postgres.DATABASE_URL}}` appears below.

State plainly that this check exists because the first migration runs `CREATE EXTENSION IF NOT EXISTS "vector"`, which fails on a Postgres without pgvector available, and the failure surfaces as a failed pre-deploy rather than something obvious.

**Section 3, Evolution's database.** In the query console:

```sql
CREATE DATABASE evolution;
```

Evolution needs its own database, not just a schema. Its `DATABASE_CONNECTION_URI` is the Postgres connection string with the database name replaced by `evolution`.

**Section 4, Redis.** Add Railway's Redis service. No configuration beyond the reference variable.

**Section 5, MinIO (the S3 bucket).** New service from the Docker image `minio/minio`, with:
- Start command: `server /data --console-address ":9001"`
- Volume mounted at `/data`
- Variables: `MINIO_ROOT_USER`, `MINIO_ROOT_PASSWORD` (generate strong values)
- Generate a public domain, targeting **port 9000** (the S3 API port, not the 9001 console)

Note that no bucket needs creating by hand: the API creates `waos-media` at boot.

**Section 6, the API service.** From the GitHub repo, root directory `/`, Dockerfile path `apps/api/Dockerfile`. Pre-deploy command:

```
pnpm -F @waos/api db:deploy:prod
```

Health check path `/health`. Then the full variable table from spec section 6, with these called out:
- `MINIO_ENDPOINT` and `MINIO_PUBLIC_ENDPOINT` both set to the **public** MinIO domain, because both the browser and Evolution fetch media from outside Railway's private network.
- `EVOLUTION_API_URL` set to the **private** URL (`http://evolution.railway.internal:8080`).
- `API_PUBLIC_URL` set to the **private** API URL (`http://api.railway.internal:4000`): its only consumer is the webhook URL registered with Evolution, so the callback never leaves Railway.
- `WEB_ORIGIN` set to the public web domain; this drives CORS and the Socket.IO origin.
- `JWT_ACCESS_SECRET` and `JWT_REFRESH_SECRET` must be different from each other and at least 32 characters, which the config validates at boot.

Generate a public domain for the API targeting port 4000.

**Section 7, the web service.** From the same repo, root directory `/`, Dockerfile path `apps/web/Dockerfile`. Variables `NEXT_PUBLIC_API_URL` (the public API domain) and `NEXT_PUBLIC_APP_NAME`. State explicitly that these are consumed at **build** time as Docker build arguments, that changing them requires a redeploy to take effect, and that the symptom of getting this wrong is a deployed dashboard whose network requests go to `localhost:4000`.

**Section 8, the Evolution service.** From the Docker image `evoapicloud/evolution-api:v2.3.7`, volume at `/evolution/instances`, public domain targeting port 8080, and the variables from spec section 6. Flag `DATABASE_SAVE_DATA_NEW_MESSAGE=true` with its consequence: with it false, Evolution does not persist inbound messages and every customer photo and voice note fails to download.

**Section 9, first deploy and pairing.** Deploy order (Postgres, Redis, MinIO, then API, then web and Evolution), then: open the web domain, sign up, go through onboarding to the connect screen, scan the QR with the business phone, and confirm the channel reports connected.

**Section 10, verification checklist.**
- `curl https://<api-domain>/health` returns 200.
- The dashboard loads and login works.
- The browser's network tab shows requests going to the API domain, not `localhost`.
- The QR scan connects and the channel shows connected after a page refresh (Socket.IO delivered the status change).
- Sending a WhatsApp message to the connected number produces an inbound message in the inbox, and an AI reply if the AI is enabled.
- Uploading a product photo displays it in the dashboard (this exercises MinIO end to end).

**Section 11, troubleshooting.** Each entry as symptom, cause, fix:
- Dashboard requests go to `localhost:4000`: `NEXT_PUBLIC_API_URL` was set at runtime only, or changed without a redeploy. Set it as a service variable and redeploy the web service.
- Pre-deploy fails on `CREATE EXTENSION "vector"`: the Postgres has no pgvector. Follow the section 2 fallback.
- Inbound photos and voice notes never arrive, log shows `getBase64FromMediaMessage` 400 "Message not found": Evolution's `DATABASE_SAVE_DATA_NEW_MESSAGE` is not `true`.
- Media fails to send, log shows `sendMedia` 400: `MINIO_PUBLIC_ENDPOINT` is not reachable from outside Railway. It must be the public MinIO domain.
- Evolution reports an instance "does not exist" or `connectionState` returns no state: the instance stalled. Restart the Evolution service; the session is restored from its volume without a re-scan.
- Boot fails with a config validation error: a required variable is missing or a JWT secret is under 32 characters. The error names the variable.
- Socket.IO does not connect and the inbox only updates on navigation: `WEB_ORIGIN` does not exactly match the web domain, including scheme.

**Section 12, what this deployment does not cover.** Custom domains, backups, staging environments, and the fact that the API must run a **single replica** because its BullMQ workers run in-process: a second replica would duplicate reminders and AI replies.

- [ ] **Step 2: Point the RUNBOOK at the Railway guide**

In `docs/RUNBOOK.md`, immediately under the `# WaOS Runbook` title and its intro line, add:

```markdown
Two supported deployments: **Railway** (see docs/RAILWAY.md) and the single
VPS described below. The sections after deployment (key rotation, session
recovery, everyday checks) apply to both.
```

Leave the existing VPS instructions unchanged; they remain valid.

- [ ] **Step 3: Verify the guide against the spec**

Re-read `docs/RAILWAY.md` beside spec section 6 and confirm every variable in the spec's tables appears in the guide with the same value or source, and that no variable is described as public where the spec says private. This is a documentation-accuracy check, not a code change: a wrong value here costs a debugging session on deploy day.

- [ ] **Step 4: Run both gates**

Run: `pnpm -F @waos/api typecheck && pnpm -F @waos/api test && pnpm lint`
Run: `pnpm -F @waos/web typecheck && pnpm -F @waos/web build`
Expected: all clean (documentation changes should not affect them; this confirms nothing was disturbed).

- [ ] **Step 5: Commit**

```bash
git add docs/RAILWAY.md docs/RUNBOOK.md
git commit -m "docs: add the Railway deployment guide"
```

---

## Self-Review

**1. Spec coverage:** Section 3's topology and section 6's variable map are carried into Task 3's guide. Section 4's three code changes are Task 1. Section 5's Dockerfiles are Task 2. Section 7's pgvector check-then-branch and the `CREATE DATABASE evolution` step are Task 3 sections 2 and 3. Section 8's health checks are Task 3 section 6. Section 9's documentation deliverable is Task 3, including the troubleshooting list drawn from failures already met in this project. Section 10's constraints are in Global Constraints, and the local-build requirement is Task 2 steps 4 and 5. Section 11's out-of-scope items appear in no task and are restated in the guide's closing section. Section 13's success criteria map to Task 1 step 2, Task 2 steps 4 and 5, and Task 3 step 3.

**2. Placeholder scan:** No TBD or "configure appropriately". Both Dockerfiles are complete. Verification commands are literal and runnable, with the machine's non-default Postgres and Redis ports called out. Task 3 specifies each documentation section's content and the exact SQL, image names, start command, ports, and pre-deploy command rather than saying "document the setup"; the instance-specific values (generated domains, chosen passwords) are correctly left as the reader's own, since they cannot exist until the services are created.

**3. Type consistency:** `start:prod` and `db:deploy:prod` are defined in Task 1 and referenced by exactly those names in Task 2's `CMD` and Task 3's pre-deploy command. Dockerfile paths (`apps/api/Dockerfile`, `apps/web/Dockerfile`) match between Task 2's creation, its build commands, and Task 3's service configuration. Image names (`minio/minio`, `evoapicloud/evolution-api:v2.3.7`, `pgvector/pgvector:pg16`) match the spec. The MinIO public-domain port (9000, not the 9001 console) is consistent between Task 3 sections 5 and 6.
