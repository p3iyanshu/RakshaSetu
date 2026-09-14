#!/usr/bin/env bash
# Generates a self-signed dev TLS cert for running the dashboard backend
# over wss:// instead of ws://. Not for production use -- a real deployment
# needs a cert from a trusted CA. Output is gitignored; re-run any time to
# rotate it.
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CERT_DIR="$HERE/certs"
mkdir -p "$CERT_DIR"

# The leading "//" (not "/") on -subj stops Git Bash on Windows from
# mangling it into a filesystem path (e.g. "C:/Program Files/Git/C=IN/...")
# while leaving the -keyout/-out path arguments' normal conversion intact.
openssl req -x509 -newkey rsa:4096 \
  -keyout "$CERT_DIR/dev-key.pem" \
  -out "$CERT_DIR/dev-cert.pem" \
  -days 365 -nodes \
  -subj "//C=IN/O=RakshaSetu/OU=SIH-PS26053/CN=localhost"

echo "Wrote $CERT_DIR/dev-cert.pem and $CERT_DIR/dev-key.pem (gitignored, dev-only)."
