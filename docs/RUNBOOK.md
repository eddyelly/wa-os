# WaOS Runbook

Operational guide for the single-VPS deployment. Keep this current: it is
what you reach for at 2 a.m.

## 1. Deploy on the VPS

Target: one Ubuntu 22.04+ VPS behind Nginx, Docker Compose for infra, pnpm
for the apps.

1. Install prerequisites:

   ```bash
   curl -fsSL https://get.docker.com | sh
   curl -fsSL https://fnm.vercel.app/install | bash   # or any Node 20+ install
   fnm install 20 && corepack enable
   ```

2. Clone and configure:

   ```bash
   git clone <repo-url> /opt/waos && cd /opt/waos
   cp .env.example .env
   # Set REAL values: strong JWT secrets, EVOLUTION_API_KEY,
   # EVOLUTION_WEBHOOK_SECRET, ANTHROPIC_API_KEY, EMBEDDING_API_KEY,
   # API_PUBLIC_URL=https://api.yourdomain, WEB_ORIGIN=https://app.yourdomain,
   # NEXT_PUBLIC_API_URL=https://api.yourdomain
   ```

3. Start infra, migrate, build, run:

   ```bash
   pnpm install
   pnpm infra:up
   pnpm -F @waos/api db:deploy
   pnpm -F @waos/web build
   ```

   Run the apps under a process manager (systemd units or pm2):

   ```bash
   pm2 start "pnpm -F @waos/api start" --name waos-api
   pm2 start "pnpm -F @waos/web start" --name waos-web
   pm2 save
   ```

4. Nginx: proxy `app.yourdomain` to :3000 and `api.yourdomain` to :4000,
   with websocket upgrade headers on the api server block (Socket.IO):

   ```nginx
   location / {
     proxy_pass http://127.0.0.1:4000;
     proxy_http_version 1.1;
     proxy_set_header Upgrade $http_upgrade;
     proxy_set_header Connection "upgrade";
     proxy_set_header Host $host;
   }
   ```

5. TLS via certbot, then verify:

   ```bash
   curl https://api.yourdomain/health
   ```

### Verify a deploy

- `curl https://api.yourdomain/health` returns `{"status":"ok"}`
- Dashboard loads, login works
- `docker compose -f infra/docker-compose.yml ps` shows every service healthy
- Channels page shows the WhatsApp connection still CONNECTED (boot
  reconcile ran)

## 2. Rotate keys

| Key | How |
| --- | --- |
| JWT secrets | Set new `JWT_ACCESS_SECRET`/`JWT_REFRESH_SECRET` in `.env`, restart the api. Everyone logs in again (access tokens die within 15 minutes anyway). |
| Evolution API key | Set the new value in `infra/.env` (compose) AND `.env` (api), then `pnpm infra:up` to recreate the evolution container and restart the api. |
| Webhook secret | Set new `EVOLUTION_WEBHOOK_SECRET` in `.env`, restart the api, then reconnect each channel from the dashboard so the instance webhook URL is re-registered with the new secret. |
| Anthropic / embedding keys | Update `.env`, restart the api. In-flight AI jobs retry with the new key. |
| MinIO credentials | Update compose env and `.env` together, `pnpm infra:up`, restart the api. |

After any rotation: `pm2 restart waos-api` and watch `pm2 logs waos-api`
for a clean boot (config parse fails fast and names the missing variable).

## 3. Recover a disconnected WhatsApp session

Symptoms: channel shows DISCONNECTED, customers get no replies, or the
dashboard warns after a deploy.

1. Check what Evolution thinks:

   ```bash
   curl -H "apikey: $EVOLUTION_API_KEY" \
     $EVOLUTION_API_URL/instance/connectionState/<channelId>
   ```

2. `state: "open"`: our side is stale. Restart the api; boot reconcile
   fixes the status.
3. `state: "close"` or `connecting`: from the dashboard, open Settings ->
   Connect (or the onboarding connect step) and press "Get a new code",
   then rescan the QR with the business phone. Scanning takes about 20
   seconds; the status flips to CONNECTED live.
4. Instance missing entirely (404): the evolution volume was lost. Create
   a fresh connection from the dashboard (it provisions a new instance)
   and rescan. Conversation history is unaffected; it lives in our
   Postgres, not Evolution's.
5. Repeated disconnects or a BANNED status: stop proactive sends (pause
   reminders by cancelling upcoming appointments), review recent send
   volume against the warm-up caps, and reconnect with a different number
   if WhatsApp has restricted the current one. This is the entry tier ban
   risk the connect screen discloses.

## 4. Everyday checks

- Queue backlog: `docker exec -it waos-redis-1 redis-cli llen bull:outbound:wait`
- Postgres backup: `pg_dump` the `waos_dev` database nightly (cron) and
  copy off-box.
- Disk: MinIO media and Postgres live in Docker volumes; watch `df -h`.
- Logs: `pm2 logs waos-api` (message ids only, never bodies).
