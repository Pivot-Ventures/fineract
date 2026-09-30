#!/usr/bin/env bash
# Wrapper for Pivot SACCO Desk Fineract starter seed (idempotent).
set -euo pipefail
export PATH="${HOME}/.docker/bin:${PATH}"
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
exec python3 "${SCRIPT_DIR}/seed-fineract.py" "$@"
