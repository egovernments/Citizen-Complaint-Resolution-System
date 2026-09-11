#!/usr/bin/env bash
# Thin wrapper for run-notif-suite.js. Run ON the DIGIT host (needs docker + Kong).
#
#   E2E_EMP_USER=bometadmin E2E_EMP_PASS=eGov@123 \
#     ./run-notif-suite.sh --target=bomet --only=A,C
#
# NOVU_API_KEY is auto-resolved from the novu-bridge container when unset.
set -euo pipefail
DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
exec node "$DIR/run-notif-suite.js" "$@"
