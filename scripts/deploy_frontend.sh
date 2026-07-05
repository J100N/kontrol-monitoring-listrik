#!/usr/bin/env bash
# Build dashboard React lalu redeploy container nginx pada compose stack.
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
FRONTEND_DIR="$ROOT_DIR/frontend/dashboard"
COMPOSE_DIR="$ROOT_DIR/infra/digitalocean"

cd "$FRONTEND_DIR"
echo "[deploy] install deps"
npm install
echo "[deploy] build production"
npm run build

cd "$COMPOSE_DIR"
echo "[deploy] restart container dashboard"
docker compose --profile app up -d dashboard
echo "[deploy] selesai"
