#!/bin/sh
set -euo pipefail

CERT_NAME=${CERT_NAME:-blsk.fin-tech.com}
CERT_DIR=/etc/letsencrypt/live/${CERT_NAME}
FALLBACK_CERT=/etc/nginx/certs/cert.pem
FALLBACK_KEY=/etc/nginx/certs/key.pem

if [ -f "$CERT_DIR/fullchain.pem" ] && [ -f "$CERT_DIR/privkey.pem" ]; then
  exit 0
fi

echo "[ensure-certs] deploying fallback certificates"
mkdir -p "$CERT_DIR"

if [ -f "$FALLBACK_CERT" ] && [ -f "$FALLBACK_KEY" ]; then
  cp "$FALLBACK_CERT" "$CERT_DIR/fullchain.pem"
  cp "$FALLBACK_KEY" "$CERT_DIR/privkey.pem"
  echo "[ensure-certs] fallback certificates copied"
else
  echo "[ensure-certs] fallback certs not found, nginx will still fail" >&2
fi
