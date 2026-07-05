#!/usr/bin/env bash
set -euo pipefail

# Flash firmware untuk smart_socket.
# Pemakaian:
#   ./flash_socket.sh COM5
#   ./flash_socket.sh /dev/ttyUSB0 --monitor

PORT="${1:-}"
EXTRA="${2:-}"

if [[ -z "${PORT}" ]]; then
	echo "[ERROR] Port serial wajib diisi. Contoh: ./flash_socket.sh COM5"
	exit 1
fi

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/../.." && pwd)"

cd "${REPO_ROOT}"

echo "[INFO] Build varian smart_socket..."
idf.py -B build -DDEVICE_VARIANT=smart_socket build

echo "[INFO] Flash ke port ${PORT}..."
idf.py -B build -DDEVICE_VARIANT=smart_socket -p "${PORT}" flash

if [[ "${EXTRA}" == "--monitor" ]]; then
	echo "[INFO] Membuka monitor serial..."
	idf.py -B build -DDEVICE_VARIANT=smart_socket -p "${PORT}" monitor
fi

echo "[OK] Flash smart_socket selesai"
