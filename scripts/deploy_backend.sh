#!/usr/bin/env bash
set -euo pipefail

# Deploy backend stack DO non-interaktif (wajib SSH key).
# Usage:
#   DO_HOST=167.71.195.81 DO_KEY_PATH="$HOME/.ssh/id_ed25519" ./scripts/deploy_backend.sh

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
REMOTE_USER="${DO_USER:-root}"
REMOTE_HOST="${DO_HOST:-}"
REMOTE_DIR="${DO_STACK_DIR:-/opt/iot-listrik}"
DO_KEY_PATH="${DO_KEY_PATH:-}"

if [[ -z "${REMOTE_HOST}" ]]; then
	echo "[deploy] ERROR: DO_HOST wajib diisi" >&2
	exit 1
fi

if [[ -z "${DO_KEY_PATH}" ]]; then
	echo "[deploy] ERROR: DO_KEY_PATH wajib diisi agar non-interaktif" >&2
	exit 1
fi

if [[ ! -f "${DO_KEY_PATH}" ]]; then
	echo "[deploy] ERROR: SSH key tidak ditemukan: ${DO_KEY_PATH}" >&2
	exit 1
fi

SSH_OPTS=(
	-i "${DO_KEY_PATH}"
	-o BatchMode=yes
	-o IdentitiesOnly=yes
	-o StrictHostKeyChecking=accept-new
)

ARCHIVE_PATH="${ROOT_DIR}/do_sync.tgz"

echo "[deploy] pack source -> ${ARCHIVE_PATH}"
tar -C "${ROOT_DIR}" \
	--exclude='backend/mqtt_worker/node_modules' \
	--exclude='backend/api/node_modules' \
	--exclude='backend/realtime_gateway/node_modules' \
	--exclude='backend/mqtt_worker/data' \
	--exclude='backend/mqtt_worker/.git' \
	--exclude='backend/api/.env' \
	--exclude='backend/mqtt_worker/.env' \
	--exclude='backend/realtime_gateway/.env' \
	--exclude='backend/common/.env' \
	-czf "${ARCHIVE_PATH}" \
	backend/mqtt_worker backend/api backend/realtime_gateway backend/common \
	database/device_registry firmware/shared_protocol \
	infra/digitalocean

echo "[deploy] upload archive"
scp "${SSH_OPTS[@]}" "${ARCHIVE_PATH}" "${REMOTE_USER}@${REMOTE_HOST}:${REMOTE_DIR}/do_sync.tgz"

echo "[deploy] apply remote deploy"
ssh "${SSH_OPTS[@]}" "${REMOTE_USER}@${REMOTE_HOST}" "DO_STACK_DIR='${REMOTE_DIR}' bash -s" <<'REMOTE_EOF'
set -euo pipefail

REMOTE_DIR="${DO_STACK_DIR:-/opt/iot-listrik}"
cd "${REMOTE_DIR}"

tar -xzf do_sync.tgz
rm -f do_sync.tgz

cp -f infra/digitalocean/docker-compose.yml ./docker-compose.yml

if [[ ! -f .env && -f infra/digitalocean/.env ]]; then
	cp -f infra/digitalocean/.env ./.env
fi

if [[ ! -f .env && -f infra/digitalocean/.env.example ]]; then
	cp -f infra/digitalocean/.env.example ./.env
fi

if [[ ! -f mqtt_worker.env && -f infra/digitalocean/mqtt_worker.env ]]; then
	cp -f infra/digitalocean/mqtt_worker.env ./mqtt_worker.env
fi

if [[ ! -f mqtt_worker.env && -f infra/digitalocean/mqtt_worker.env.example ]]; then
	cp -f infra/digitalocean/mqtt_worker.env.example ./mqtt_worker.env
fi

if ! grep -q '^MQTT_WORKER_SRC=' .env; then
	cat <<'ENV_EOF' >> .env
MQTT_WORKER_SRC=./backend/mqtt_worker
API_SRC=./backend/api
REALTIME_SRC=./backend/realtime_gateway
COMMON_SRC=./backend/common
SHARED_PROTOCOL_SRC=./firmware/shared_protocol
DEVICE_REGISTRY_DIR=./database/device_registry
FRONTEND_DIST=./frontend/dashboard/dist
ENV_EOF
fi

if [[ ! -f api.env && -f infra/digitalocean/api.env.example ]]; then
	cp -f infra/digitalocean/api.env.example ./api.env
fi
if [[ ! -f realtime_gateway.env && -f infra/digitalocean/realtime_gateway.env.example ]]; then
	cp -f infra/digitalocean/realtime_gateway.env.example ./realtime_gateway.env
fi

mkdir -p ./backend/common ./database/device_registry ./firmware/shared_protocol
cp -rf backend/common/. ./backend/common/ 2>/dev/null || true
cp -rf database/device_registry/. ./database/device_registry/ 2>/dev/null || true
cp -rf firmware/shared_protocol/. ./firmware/shared_protocol/ 2>/dev/null || true

# Bersihkan container backend lama yang berpotensi bentrok nama.
# CATATAN: 'dashboard' TIDAK dihapus di sini karena dikelola deploy_frontend.sh.
# Kalau ikut dihapus tapi tidak dinyalakan lagi, situs jadi tidak bisa diakses.
docker rm -f mqtt_worker api realtime_gateway emqx influxdb >/dev/null 2>&1 || true

docker compose --env-file .env --profile app up -d emqx influxdb mqtt_worker api realtime_gateway

# Restart dashboard (jika ada) supaya nginx me-resolve ulang IP container api/realtime
# yang baru dibuat ulang — mencegah error "Network Error" akibat upstream IP basi.
docker restart dashboard >/dev/null 2>&1 || true

echo "[deploy] docker ps"
docker ps --format 'table {{.Names}}\t{{.Status}}\t{{.Image}}'

echo "[deploy] health"
docker inspect --format '{{.Name}} => {{if .State.Health}}{{.State.Health.Status}}{{else}}no-healthcheck{{end}}' emqx influxdb mqtt_worker api realtime_gateway

echo "[deploy] influx localhost health"
curl -sS -m 10 http://127.0.0.1:8086/health
echo
REMOTE_EOF

echo "[deploy] done"

# Cleanup arsip lokal supaya workspace tetap rapi.
rm -f "${ARCHIVE_PATH}"
