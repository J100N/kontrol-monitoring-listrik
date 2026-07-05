#!/usr/bin/env bash
# Bootstrap bucket Influx + retention. Idempoten - aman dijalankan ulang.
set -euo pipefail

INFLUX_BIN="${INFLUX_BIN:-influx}"
INFLUX_HOST="${INFLUX_HOST:-http://localhost:8086}"
INFLUX_TOKEN="${INFLUX_TOKEN:?INFLUX_TOKEN harus diset}"
INFLUX_ORG="${INFLUX_ORG:-ta_org}"
BUCKET="${INFLUX_BUCKET:-telemetry}"
RETENTION="${INFLUX_RETENTION:-30d}"

echo "[init] memastikan bucket ${BUCKET} (retention ${RETENTION})"
if "${INFLUX_BIN}" bucket list \
    --host "${INFLUX_HOST}" --token "${INFLUX_TOKEN}" --org "${INFLUX_ORG}" \
  | awk 'NR>1 {print $2}' | grep -Fxq "${BUCKET}"; then
  echo "[init] bucket sudah ada, update retention"
  "${INFLUX_BIN}" bucket update \
    --host "${INFLUX_HOST}" --token "${INFLUX_TOKEN}" --org "${INFLUX_ORG}" \
    --name "${BUCKET}" --retention "${RETENTION}"
else
  echo "[init] membuat bucket baru"
  "${INFLUX_BIN}" bucket create \
    --host "${INFLUX_HOST}" --token "${INFLUX_TOKEN}" --org "${INFLUX_ORG}" \
    --name "${BUCKET}" --retention "${RETENTION}"
fi

echo "[init] selesai"
