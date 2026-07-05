#!/usr/bin/env bash
# =============================================================================
# deploy.sh — Deploy VoltGuard ke server DigitalOcean 167.71.195.81
#
# Cara pakai:
#   chmod +x deploy.sh
#   ./deploy.sh
#
# Yang dilakukan script ini:
#   1. Build frontend (npm run build)
#   2. Kirim seluruh repo ke server via rsync/scp
#   3. Jalankan docker compose di server
# =============================================================================

set -euo pipefail

SERVER="root@167.71.195.81"
REMOTE_DIR="/opt/voltguard"
LOCAL_ROOT="$(cd "$(dirname "$0")/../.." && pwd)"

echo "==> 1. Build frontend..."
cd "$LOCAL_ROOT/frontend/dashboard"
npm ci --silent
npm run build

echo "==> 2. Sync kode ke server $SERVER:$REMOTE_DIR ..."
rsync -az --delete \
  --exclude='node_modules' \
  --exclude='.git' \
  --exclude='frontend/dashboard/node_modules' \
  "$LOCAL_ROOT/" "$SERVER:$REMOTE_DIR/"

echo "==> 3. Jalankan Docker Compose di server..."
ssh "$SERVER" bash -s <<'REMOTE'
  set -euo pipefail
  cd /opt/voltguard/infra/digitalocean

  echo "--- Pull image terbaru..."
  docker compose pull --quiet

  echo "--- Restart semua service (profile app + infra)..."
  docker compose --profile app up -d --build --remove-orphans

  echo "--- Status container:"
  docker compose ps
REMOTE

echo ""
echo "==> Deploy selesai!"
echo "    Dashboard  : http://167.71.195.81"
echo "    API health : http://167.71.195.81/api/healthz"
echo "    EMQX Dash  : http://167.71.195.81:18083"
