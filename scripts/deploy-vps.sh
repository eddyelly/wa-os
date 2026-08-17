#!/usr/bin/env bash
# WaOS single-VPS deployment (Ubuntu 22.04/24.04).
# Run as a sudoer:  sudo bash deploy-vps.sh
# Re-running is safe; it updates code and restarts services.
set -euo pipefail

# ----- settings (override via env before running) ---------------------------
DOMAIN="${DOMAIN:-mywaos.com}"
API_DOMAIN="${API_DOMAIN:-api.mywaos.com}"
APP_DIR="${APP_DIR:-/opt/waos}"
REPO="${REPO:-https://github.com/eddyelly/wa-os.git}"
BRANCH="${BRANCH:-claude/nifty-knuth-u73hw1}"
CERTBOT_EMAIL="${CERTBOT_EMAIL:-eddyelly24@gmail.com}"

say() { printf '\n\033[1;32m==> %s\033[0m\n' "$*"; }

if [ "$(id -u)" -ne 0 ]; then
  echo "Run with sudo: sudo bash deploy-vps.sh" >&2
  exit 1
fi

# ----- secrets --------------------------------------------------------------
mkdir -p "$APP_DIR"
SECRETS_FILE="$APP_DIR/.deploy-secrets"
if [ -f "$SECRETS_FILE" ]; then
  # shellcheck disable=SC1090
  . "$SECRETS_FILE"
fi

prompt_secret() {
  local var="$1" label="$2" current
  current="$(eval echo "\${$var:-}")"
  if [ -z "$current" ]; then
    read -r -p "$label: " current
    printf '%s="%s"\n' "$var" "$current" >> "$SECRETS_FILE"
    eval "$var=\"$current\""
  fi
}

say "Collecting secrets (stored root-only in $SECRETS_FILE)"
touch "$SECRETS_FILE" && chmod 600 "$SECRETS_FILE"
# GITHUB_TOKEN is only needed if the repo is private; export it before running
# to use one. The repo is public, so the default is an anonymous clone.
prompt_secret GEMINI_API_KEY "Gemini API key (aistudio.google.com/apikey)"

gen() { openssl rand -base64 48 | tr -d '/+=' | cut -c1-48; }
for var in PG_PASSWORD JWT_ACCESS_SECRET JWT_REFRESH_SECRET EVOLUTION_API_KEY EVOLUTION_WEBHOOK_SECRET MINIO_SECRET; do
  current="$(eval echo "\${$var:-}")"
  if [ -z "$current" ]; then
    value="$(gen)"
    printf '%s="%s"\n' "$var" "$value" >> "$SECRETS_FILE"
    eval "$var=\"$value\""
  fi
done

# ----- base packages --------------------------------------------------------
say "Installing base packages"
export DEBIAN_FRONTEND=noninteractive
apt-get update -y
apt-get install -y curl git nginx ca-certificates gnupg ufw certbot python3-certbot-nginx

if ! command -v docker >/dev/null 2>&1; then
  say "Installing docker"
  curl -fsSL https://get.docker.com | sh
fi

if ! command -v node >/dev/null 2>&1 || [ "$(node -e 'console.log(process.versions.node.split(".")[0])')" -lt 20 ]; then
  say "Installing node 20"
  curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
  apt-get install -y nodejs
fi
corepack enable || npm install -g pnpm@10 >/dev/null
command -v pnpm >/dev/null 2>&1 || npm install -g pnpm@10
command -v pm2 >/dev/null 2>&1 || npm install -g pm2

# ----- code -----------------------------------------------------------------
say "Fetching code ($BRANCH)"
if [ -n "${GITHUB_TOKEN:-}" ]; then
  AUTH_REPO="https://x-access-token:${GITHUB_TOKEN}@${REPO#https://}"
else
  AUTH_REPO="$REPO"
fi
# APP_DIR already holds the secrets file, so it is never empty; init in place
# instead of git clone (which refuses non-empty directories).
if [ ! -d "$APP_DIR/.git" ]; then
  git -C "$APP_DIR" init -q
fi
git -C "$APP_DIR" remote remove origin >/dev/null 2>&1 || true
git -C "$APP_DIR" remote add origin "$AUTH_REPO"
# Forced refspec: the branch history may be rewritten (e.g. rebased onto main).
git -C "$APP_DIR" fetch origin "+refs/heads/${BRANCH}:refs/remotes/origin/${BRANCH}"
git -C "$APP_DIR" checkout -f -B "$BRANCH" "origin/$BRANCH"
cd "$APP_DIR"

# ----- environment ----------------------------------------------------------
say "Writing $APP_DIR/.env"
cat > "$APP_DIR/.env" <<ENV
DATABASE_URL=postgresql://waos:${PG_PASSWORD}@localhost:5432/waos
REDIS_URL=redis://localhost:6379
MINIO_ENDPOINT=localhost:9000
MINIO_PUBLIC_ENDPOINT=host.docker.internal:9000
MINIO_ACCESS_KEY=waos
MINIO_SECRET_KEY=${MINIO_SECRET}
MINIO_BUCKET=waos-media
EVOLUTION_API_URL=http://localhost:8080
EVOLUTION_API_KEY=${EVOLUTION_API_KEY}
EVOLUTION_WEBHOOK_SECRET=${EVOLUTION_WEBHOOK_SECRET}
JWT_ACCESS_SECRET=${JWT_ACCESS_SECRET}
JWT_REFRESH_SECRET=${JWT_REFRESH_SECRET}
GEMINI_API_KEY=${GEMINI_API_KEY}
LLM_MODEL_ID=gemini-2.5-flash
EMBEDDING_PROVIDER=gemini
EMBEDDING_API_KEY=${GEMINI_API_KEY}
EMBEDDING_MODEL_ID=gemini-embedding-001
EMBEDDING_DIM=1536
AI_CONFIDENCE_THRESHOLD=0.7
REMINDER_OFFSETS_MINUTES=1440,120
SEND_RATE_PER_MINUTE=6
WARMUP_DAILY_CAPS=20,40,60,80,120,160,200,250,300,350,400,450,500,600
NEXT_PUBLIC_APP_NAME=WaOS
NEXT_PUBLIC_API_URL=https://${API_DOMAIN}
WEB_ORIGIN=https://${DOMAIN},https://www.${DOMAIN}
API_PUBLIC_URL=https://${API_DOMAIN}
PORT=4000
NODE_ENV=production
ENV
chmod 600 "$APP_DIR/.env"

# Next.js bakes NEXT_PUBLIC_* into the client bundle at build time and only
# reads env files from the app directory, so write them where next build looks.
cat > "$APP_DIR/apps/web/.env.production" <<ENV
NEXT_PUBLIC_APP_NAME=WaOS
NEXT_PUBLIC_API_URL=https://${API_DOMAIN}
ENV

# Compose reads its own env file next to the compose file.
cat > "$APP_DIR/infra/.env" <<ENV
POSTGRES_USER=waos
POSTGRES_PASSWORD=${PG_PASSWORD}
POSTGRES_DB=waos
MINIO_ACCESS_KEY=waos
MINIO_SECRET_KEY=${MINIO_SECRET}
MINIO_BUCKET=waos-media
EVOLUTION_API_KEY=${EVOLUTION_API_KEY}
EVOLUTION_SERVER_URL=http://localhost:8080
ENV
chmod 600 "$APP_DIR/infra/.env"

# ----- infra + app ----------------------------------------------------------
say "Starting infra containers"
docker compose -f "$APP_DIR/infra/docker-compose.yml" --env-file "$APP_DIR/infra/.env" up -d
say "Waiting for postgres to be healthy"
for _ in $(seq 1 30); do
  if docker compose -f "$APP_DIR/infra/docker-compose.yml" --env-file "$APP_DIR/infra/.env" ps postgres | grep -q healthy; then
    break
  fi
  sleep 2
done

say "Installing workspace dependencies"
pnpm install --frozen-lockfile

say "Generating the database client"
pnpm --filter @waos/api db:generate

say "Running database migrations and seed"
pnpm --filter @waos/api db:deploy
pnpm --filter @waos/api db:seed || true

say "Building the dashboard"
pnpm --filter @waos/web build

# ----- processes ------------------------------------------------------------
say "Starting api and web under pm2"
pm2 delete waos-api >/dev/null 2>&1 || true
pm2 delete waos-web >/dev/null 2>&1 || true
pm2 start "pnpm --filter @waos/api start" --name waos-api --cwd "$APP_DIR"
pm2 start "pnpm --filter @waos/web start" --name waos-web --cwd "$APP_DIR"
pm2 save
pm2 startup systemd -u root --hp /root >/dev/null || true

# ----- nginx ----------------------------------------------------------------
# Once certbot has installed TLS (listen 443) we leave the file alone so a
# re-run never wipes the certificates.
if [ -f /etc/nginx/sites-available/waos ] && grep -q "listen 443" /etc/nginx/sites-available/waos; then
  say "nginx already TLS-managed by certbot; leaving config untouched"
else
  say "Configuring nginx for $DOMAIN and $API_DOMAIN"
  cat > /etc/nginx/sites-available/waos <<NGINX
server {
    listen 80;
    server_name ${DOMAIN} www.${DOMAIN};
    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
    }
}
server {
    listen 80;
    server_name ${API_DOMAIN};
    client_max_body_size 12m;
    location / {
        proxy_pass http://127.0.0.1:4000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade \$http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
        proxy_read_timeout 120s;
    }
}
NGINX
  ln -sf /etc/nginx/sites-available/waos /etc/nginx/sites-enabled/waos
  rm -f /etc/nginx/sites-enabled/default
fi
nginx -t && systemctl reload nginx

# ----- firewall -------------------------------------------------------------
if ufw status | grep -q "Status: active"; then
  ufw allow 22/tcp >/dev/null; ufw allow 80/tcp >/dev/null; ufw allow 443/tcp >/dev/null
fi

# ----- tls (needs DNS pointing here first) ----------------------------------
if [ -f "/etc/letsencrypt/live/$DOMAIN/fullchain.pem" ]; then
  say "TLS certificates already present"
elif getent hosts "$DOMAIN" | grep -q "$(curl -s ifconfig.me || echo NONE)"; then
  say "DNS resolves here; requesting TLS certificates"
  certbot --nginx -d "$DOMAIN" -d "www.$DOMAIN" -d "$API_DOMAIN" \
    --non-interactive --agree-tos -m "$CERTBOT_EMAIL" --redirect || \
    echo "certbot failed; re-run later: sudo certbot --nginx -d $DOMAIN -d www.$DOMAIN -d $API_DOMAIN --redirect"
else
  say "DNS does not point here yet (or is behind the Cloudflare proxy). If TLS is not set up yet, run:"
  echo "  sudo certbot --nginx -d $DOMAIN -d www.$DOMAIN -d $API_DOMAIN --non-interactive --agree-tos -m $CERTBOT_EMAIL --redirect"
fi

say "Done. Checks:"
echo "  curl -s http://127.0.0.1:4000/health"
echo "  curl -s -o /dev/null -w '%{http_code}\n' http://127.0.0.1:3000/sw"
echo "  pm2 status | docker compose -f $APP_DIR/infra/docker-compose.yml ps"
