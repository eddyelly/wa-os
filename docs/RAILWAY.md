# Deploying WaOS on Railway

A second supported deployment target alongside the single VPS in
docs/RUNBOOK.md. Same application, six Railway services instead of one
machine, so a deploy is a `git push` rather than an SSH session.

## 1. Before you start

You need:

- A Railway account with billing enabled (Postgres, Redis, and the Docker
  services all need real usage, not the free trial's limits).
- This repository pushed to GitHub, on the branch you want to deploy.
- A Gemini API key (`GEMINI_API_KEY`).
- About 20 minutes.

You will scan a QR code with the business's WhatsApp phone exactly once, at
the end (section 9), to pair the WhatsApp session. After that the session
persists across restarts as long as Evolution's volume survives (section
11 has the recovery story if it does not).

## 2. The pgvector check (do this first)

Create a new Railway project, then add a Postgres service (Railway's managed
Postgres, not yet the Docker image). Open its query console and run:

```sql
SELECT * FROM pg_available_extensions WHERE name = 'vector';
```

This matters because the API's first migration runs
`CREATE EXTENSION IF NOT EXISTS "vector"`. If the extension is not available,
that migration fails during the pre-deploy step, which is a confusing place
to discover it on deploy day: the failure looks like a broken migration, not
a missing Postgres feature.

- **A row comes back:** the managed Postgres has pgvector. Keep it and
  continue to section 3.
- **No rows:** delete the managed Postgres service and add a new service
  instead from the Docker image `pgvector/pgvector:pg16`, with:
  - A volume mounted at `/var/lib/postgresql/data`.
  - Variables `POSTGRES_USER`, `POSTGRES_PASSWORD`, `POSTGRES_DB` set to
    values of your choice, plus `PGDATA=/var/lib/postgresql/data/pgdata`.
    Railway volumes are ext4-backed and typically already contain a
    `lost+found` directory, and Postgres refuses to `initdb` directly into a
    mount point that is not empty. Pointing `PGDATA` at a subdirectory of
    the mount avoids this; it is harmless even if the volume turns out to be
    empty.

  Wherever this guide says `${{Postgres.DATABASE_URL}}` below, use this
  service's connection string instead (built from the variables above and
  its internal host).

## 3. Evolution's database

Evolution needs its own database, not just its own schema inside the one
the API uses. In the same query console:

```sql
CREATE DATABASE evolution;
```

Evolution's `DATABASE_CONNECTION_URI` (section 8) is the Postgres connection
string from section 2, with the database name at the end swapped for
`evolution`.

## 4. Redis

Add Railway's Redis service. No configuration beyond letting it provision;
you will reference `${{Redis.REDIS_URL}}` from the api and evolution
services.

## 5. MinIO (the S3 bucket)

Railway has no native S3-compatible storage, so media (product photos,
inbound WhatsApp images and voice notes) is served by MinIO running as its
own service.

Add a new service from the Docker image `minio/minio`, with:

- Start command: `server /data --console-address ":9001"`
- A volume mounted at `/data`
- Variables `MINIO_ROOT_USER` and `MINIO_ROOT_PASSWORD` (generate strong
  values; these become the credentials the api service authenticates with)
- A generated public domain, targeting **port 9000** (the S3 API port, not
  the 9001 console)

Do not create the `waos-media` bucket by hand. The API creates it at boot
(`ensureBucket()`).

## 6. The api service

From the GitHub repo, with root directory `/` and Dockerfile path
`apps/api/Dockerfile`. Railway builds from the repository root because the
Dockerfile copies workspace manifests (`package.json`, `pnpm-lock.yaml`,
`pnpm-workspace.yaml`) from there; do not point the root directory at
`apps/api`.

Pre-deploy command:

```
pnpm -F @waos/api db:deploy:prod
```

This runs `prisma migrate deploy` with no dotenv wrapper (the `db:deploy`
script uses `dotenv -e ../../.env`, which does not exist on Railway; never
use it here). Migrations run before the new container takes traffic, so a
broken migration blocks the deploy instead of half-applying at runtime.

Health check path: `/health`.

Name this service `api` so the internal hostname `api.railway.internal`
resolves; other services reference it by that name below.

Variables (the complete contract, matching
`apps/api/src/lib/config.ts`; variables not listed here have safe defaults
and do not need to be set):

| Variable | Required | Value |
| --- | --- | --- |
| `NODE_ENV` | optional, defaults to `development` | `production` |
| `PORT` | optional, defaults to `4000` | `4000` |
| `DATABASE_URL` | required | `${{Postgres.DATABASE_URL}}` (or your pgvector fallback service, section 2) |
| `REDIS_URL` | required | `${{Redis.REDIS_URL}}` |
| `MINIO_ENDPOINT` | required | the **public** MinIO domain from section 5, e.g. `https://minio-production-xxxx.up.railway.app` |
| `MINIO_PUBLIC_ENDPOINT` | optional, defaults to `MINIO_ENDPOINT` | the same public MinIO domain (set it explicitly rather than relying on the default; see the troubleshooting note in section 11) |
| `MINIO_ACCESS_KEY` | required | the MinIO service's `MINIO_ROOT_USER` |
| `MINIO_SECRET_KEY` | required | the MinIO service's `MINIO_ROOT_PASSWORD` |
| `MINIO_BUCKET` | optional, defaults to `waos-media` | leave default |
| `EVOLUTION_API_URL` | required | the **private** Evolution URL, `http://evolution.railway.internal:8080` (assumes the Evolution service is named `evolution`, section 8) |
| `EVOLUTION_API_KEY` | required | a strong generated key; must be identical to `AUTHENTICATION_API_KEY` on the evolution service |
| `EVOLUTION_WEBHOOK_SECRET` | required | a strong generated secret |
| `JWT_ACCESS_SECRET` | required, 32+ characters | a random string; the config rejects anything shorter |
| `JWT_REFRESH_SECRET` | required, 32+ characters | a random string, and a different one from `JWT_ACCESS_SECRET`; `config.ts` does not check that they differ, but reusing one secret for both weakens the access/refresh token boundary |
| `GEMINI_API_KEY` | required | your Gemini API key |
| `LLM_MODEL_ID` | required | e.g. `gemini-2.5-flash` |
| `EMBEDDING_PROVIDER` | required | `gemini` |
| `EMBEDDING_API_KEY` | required | your embedding key (can be the same value as `GEMINI_API_KEY`) |
| `EMBEDDING_MODEL_ID` | required | e.g. `gemini-embedding-001` |
| `EMBEDDING_DIM` | optional, defaults to `1536` | leave default |
| `AI_CONFIDENCE_THRESHOLD` | optional, defaults to `0.7` | leave default |
| `REMINDER_OFFSETS_MINUTES` | optional, defaults to `1440,120` | leave default |
| `SEND_RATE_PER_MINUTE` | optional, defaults to `6` | leave default |
| `WARMUP_DAILY_CAPS` | optional, has a 14-day default ramp | leave default |
| `WEB_ORIGIN` | optional, but its `localhost` default is wrong here | the public web domain, but that domain does not exist yet: the web service is not created until section 7. Leave it unset for now: its default of `http://localhost:3000` is a valid URL, so the api still boots, and you come back to it in section 9, step 6, once the web domain is generated; drives CORS (the entire API rejects cross-origin browser calls without it) and the Socket.IO origin. Accepts a comma-separated list, so a custom domain and the Railway-generated one can both be allowed |
| `API_PUBLIC_URL` | optional, but its `localhost` default is wrong here | the **private** api URL, `http://api.railway.internal:4000` (its only consumer is the webhook URL registered with Evolution, so the callback never leaves Railway) |

Generate a public domain for the api service, targeting **port 4000**.

## 7. The web service

From the same repo, root directory `/`, Dockerfile path
`apps/web/Dockerfile`.

Health check path: `/`.

Variables:

| Variable | Scope | Value |
| --- | --- | --- |
| `NEXT_PUBLIC_API_URL` | build | the public api domain from section 6 |
| `NEXT_PUBLIC_APP_NAME` | build | `WaOS` |
| `PORT` | runtime | `3000` |

These two are consumed as Docker **build arguments** and get inlined into
the client JavaScript bundle by `next build`. Setting or changing them as
ordinary runtime variables does nothing: the bundle was already built with
whatever value was present at build time. If you change either one, you
must trigger a new build (redeploy), not just a restart.

This is the single most common way this deployment breaks. The build now
fails outright if `NEXT_PUBLIC_API_URL` is missing (see the guard in
`apps/web/Dockerfile`), so the empty-string case should never reach
production. But a wrong value still builds successfully, and the symptom on
Railway is a dashboard that loads fine but every API call 404s, because the
browser's network tab shows requests going to the web service's own domain
instead of your api domain, and Socket.IO never connects. `localhost:4000`
only shows up this way in a local build where the build arg was genuinely
absent at build time.

Generate a public domain for the web service, targeting **port 3000**.

## 8. The Evolution service

From the Docker image `evoapicloud/evolution-api:v2.3.7`. Pin this exact
version: it matches `infra/docker-compose.yml` and is what this deployment
has actually been validated against. The reported reason the pin was chosen
is that 2.4.x requires a paid license, but that is not something recorded
or checked in this repository, so treat it as unverified and re-check
Evolution's current licensing terms yourself before attempting any upgrade.

- A volume mounted at `/evolution/instances`. This is where WhatsApp session
  credentials live; losing it logs the business out of WhatsApp and requires
  a fresh QR scan (see section 11 and RUNBOOK.md section 3).
- A generated public domain, targeting **port 8080**.

Name this service `evolution` so `evolution.railway.internal` (used by the
api service's `EVOLUTION_API_URL`) resolves.

Variables, ported from `infra/docker-compose.yml`:

| Variable | Value |
| --- | --- |
| `SERVER_URL` | this service's own public domain, e.g. `https://evolution-production-xxxx.up.railway.app` |
| `AUTHENTICATION_API_KEY` | the same strong key as the api service's `EVOLUTION_API_KEY` |
| `DATABASE_ENABLED` | `true` |
| `DATABASE_PROVIDER` | `postgresql` |
| `DATABASE_CONNECTION_URI` | the Postgres connection string from section 2, database name replaced with `evolution` (section 3) |
| `DATABASE_CONNECTION_CLIENT_NAME` | `waos` |
| `DATABASE_SAVE_DATA_INSTANCE` | `true` |
| `DATABASE_SAVE_DATA_NEW_MESSAGE` | `true` |
| `DATABASE_SAVE_MESSAGE_UPDATE` | `false` |
| `DATABASE_SAVE_DATA_CONTACTS` | `false` |
| `DATABASE_SAVE_DATA_CHATS` | `false` |
| `CACHE_REDIS_ENABLED` | `true` |
| `CACHE_REDIS_URI` | `${{Redis.REDIS_URL}}` with `/6` appended, e.g. `redis://default:pass@host:port/6` |
| `CACHE_REDIS_PREFIX_KEY` | `evolution` |
| `CACHE_LOCAL_ENABLED` | `false` |
| `LOG_LEVEL` | `ERROR,WARN,INFO` |
| `DEL_INSTANCE` | `false` |

`DATABASE_SAVE_DATA_NEW_MESSAGE=true` is easy to lose and load-bearing: with
it `false`, Evolution never persists inbound messages, so every customer
photo and voice note fails to download (the download call cannot find the
message it needs to decrypt).

## 9. First deploy and pairing

Deploy in this order, since later services reference earlier ones:

1. Postgres (section 2), then run the pgvector check and, if needed, the
   `CREATE DATABASE evolution` statement (section 3).
2. Redis (section 4).
3. MinIO (section 5).
4. The api service (section 6). Its pre-deploy migration needs Postgres and
   the api service needs Redis and MinIO's credentials, but it does not need
   Evolution to be up yet.
5. The web service and the evolution service (section 7 and 8), in either
   order.
6. Once the web service has deployed and its public domain exists (the
   domain generated at the end of section 7), return to the api service and
   set `WEB_ORIGIN` to that domain, then restart the api service. This is a
   variable change only: a restart is enough, you do not need to rebuild
   (unlike `NEXT_PUBLIC_API_URL` and `NEXT_PUBLIC_APP_NAME` in section 7,
   which are build arguments and do need a rebuild). Skip this step and
   login will fail: every browser call from the dashboard to the api is
   blocked with a CORS error, since the api still only allows the
   `localhost` default as its origin.

Once all six services are healthy and `WEB_ORIGIN` points at the web
domain (step 6 above):

1. Open the web service's public domain.
2. Sign up as the owner and go through onboarding.
3. On the connect screen, scan the QR code with the business's WhatsApp
   phone.
4. Confirm the channel reports connected. This is the one QR scan mentioned
   in section 1; after this the session persists in Evolution's volume.

## 10. Verification checklist

- `curl https://<api-domain>/health` returns 200.
- The dashboard loads and login works (this requires section 9, step 6 to
  be done first: `WEB_ORIGIN` set to the web domain and the api service
  restarted, otherwise login fails with a CORS error before the checklist
  gets this far).
- The browser's network tab shows requests going to the api domain, not
  `localhost`.
- The QR scan connects, and after a page refresh the channel still shows
  connected (this confirms Socket.IO delivered the status change live, not
  just on load).
- Sending a WhatsApp message to the connected number produces an inbound
  message in the inbox, and an AI reply if AI is enabled for that
  conversation.
- Uploading a product photo displays it in the dashboard. This exercises
  MinIO end to end: upload, presigned URL, and render.

## 11. Troubleshooting

| Symptom | Cause | Fix |
| --- | --- | --- |
| Dashboard loads but every API call 404s, and Socket.IO never connects (network tab shows requests going to the web service's own domain, not the api domain) | `NEXT_PUBLIC_API_URL` was set at runtime only, or changed without a rebuild, so the wrong value got baked into the bundle | Set it as a build-time variable on the web service and redeploy (rebuild) the web service, not just restart it. If the build arg is missing entirely, the build now fails outright instead of shipping this silently; this row is for a wrong value, not a missing one |
| Pre-deploy fails on `CREATE EXTENSION "vector"` | The Postgres service has no pgvector available | Follow the section 2 fallback: `pgvector/pgvector:pg16` as a Docker service |
| Inbound photos and voice notes never arrive; log shows `getBase64FromMediaMessage` with a 400 "Message not found" | Evolution's `DATABASE_SAVE_DATA_NEW_MESSAGE` is not `true` | Set `DATABASE_SAVE_DATA_NEW_MESSAGE=true` on the evolution service and restart it |
| Outbound media fails to send; log shows `sendMedia` with a 400 | `MINIO_PUBLIC_ENDPOINT` is not reachable from outside Railway | It must be the public MinIO domain, not the internal one; Evolution fetches media over the public internet, not Railway's private network |
| Evolution reports an instance "does not exist", or `connectionState` returns no state | The instance stalled | Restart the evolution service; the session restores from its volume, no re-scan needed |
| Boot fails with a config validation error naming a variable | A required variable is missing, or a JWT secret is under 32 characters | Set the named variable on the api service; the error names exactly which one |
| Login fails, and every API call from the dashboard fails with a CORS error visible in the browser console | `WEB_ORIGIN` is still the `localhost` default, or otherwise does not match the web domain at all: the entire api rejects the browser's origin | Set `WEB_ORIGIN` on the api service to the web domain from section 7 and restart it (section 9, step 6) |
| Milder variant: login and API calls work, but Socket.IO does not connect and the inbox only updates on navigation, never live | `WEB_ORIGIN` is close but not an exact match to the web domain (a trailing slash, or the wrong scheme, e.g. `http://` instead of `https://`) | Correct `WEB_ORIGIN` on the api service to match the web domain exactly, and restart |
| Channel shows disconnected after the Evolution volume was deleted or recreated | The session was stored only on that volume | Reconnect from the dashboard (provisions a fresh instance) and rescan the QR; conversation history is unaffected, it lives in Postgres, not Evolution |

## 12. What this deployment does not cover

Custom domains, database backups and restore drills, and staging or preview
environments are all out of scope for this guide.

The api service must run as a **single replica**. Its BullMQ workers
(outbound sends, AI replies, reminders, embeddings) run in-process, so a
second replica would duplicate scheduled reminders and AI replies rather
than sharing the load. Do not enable horizontal scaling on this service.
