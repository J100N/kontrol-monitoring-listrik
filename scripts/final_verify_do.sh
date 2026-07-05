#!/usr/bin/env bash
set -euo pipefail

# Jalankan deploy DO + strict E2E + ringkasan dalam satu perintah.
# Usage:
#   DO_HOST=167.71.195.81 DO_KEY_PATH="$HOME/.ssh/id_ed25519" ./scripts/final_verify_do.sh

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

if [[ -z "${DO_HOST:-}" ]]; then
  echo "[final] ERROR: DO_HOST wajib diisi" >&2
  exit 1
fi

if [[ -z "${DO_KEY_PATH:-}" ]]; then
  echo "[final] ERROR: DO_KEY_PATH wajib diisi" >&2
  exit 1
fi

echo "[final] step 1/3 deploy backend DO"
DO_HOST="${DO_HOST}" \
DO_USER="${DO_USER:-root}" \
DO_STACK_DIR="${DO_STACK_DIR:-/opt/iot-listrik}" \
DO_KEY_PATH="${DO_KEY_PATH}" \
"${ROOT_DIR}/scripts/deploy_backend.sh"

echo "[final] step 2/3 run strict e2e"
E2E_OUTPUT_FILE="${ROOT_DIR}/.final_e2e_output.log"
pushd "${ROOT_DIR}/backend/mqtt_worker" >/dev/null
E2E_STRICT=true npm run e2e:live | tee "${E2E_OUTPUT_FILE}"
E2E_EXIT=${PIPESTATUS[0]}
popd >/dev/null

echo "[final] step 3/3 summary"
if grep -q '"ackOk": true' "${E2E_OUTPUT_FILE}"; then
  echo "[summary] ackOk=true"
else
  echo "[summary] ackOk=false"
fi

if grep -q '"telemetryEnvelope": true' "${E2E_OUTPUT_FILE}"; then
  echo "[summary] telemetryEnvelope=true"
else
  echo "[summary] telemetryEnvelope=false"
fi

if grep -q '"influxPlainMeasurement": true' "${E2E_OUTPUT_FILE}" && \
   grep -q '"influxEncryptedMeasurement": true' "${E2E_OUTPUT_FILE}"; then
  echo "[summary] influxDualWrite=true"
else
  echo "[summary] influxDualWrite=false"
fi

if [[ ${E2E_EXIT} -eq 0 ]]; then
  echo "[summary] FINAL PASS"
  rm -f "${E2E_OUTPUT_FILE}"
  exit 0
fi

echo "[summary] FINAL FAIL"
exit ${E2E_EXIT}
