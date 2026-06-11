#!/usr/bin/env bash
# integration-tests-build.sh — build the react-admin test-catalog dashboard.
#
# Invoked by the playbook when `enable_integration_tests: true`. The source is
# VENDORED in-tree at CCRS tests/integration-tests/ (no clone). The vanilla
# dashboard/ is plain static files (no build); only the react-admin rebuild
# under dashboard-react-admin/ needs a vite build. The playbook syncs:
#   tests/integration-tests/dashboard/             -> /var/www/integration-tests/
#   tests/integration-tests/dashboard-react-admin/dist/ -> /var/www/integration-tests-v2/
#
# Usage: integration-tests-build.sh <integration_tests_dir> <dashboard_base>
#   <integration_tests_dir>  absolute path to the vendored tests/integration-tests
#   <dashboard_base>         vite base for the react-admin build (e.g. /tests-v2/)
#   prints the integration-tests source dir on the last line (playbook captures it).
set -uo pipefail

IT_DIR="$1"
DASHBOARD_BASE="${2:-/tests-v2/}"
NEED_NODE="20.0.0"

command -v npm >/dev/null 2>&1 || { echo "ERROR: npm not on PATH (need Node >= $NEED_NODE)" >&2; exit 1; }
NV="$(node -v 2>/dev/null | sed 's/^v//')"
ver_ge(){ [ "$(printf '%s\n%s\n' "$2" "$1" | sort -t. -k1,1n -k2,2n -k3,3n | head -1)" = "$2" ]; }
ver_ge "$NV" "$NEED_NODE" || { echo "ERROR: node v$NV < $NEED_NODE (Vite needs it)" >&2; exit 1; }

V2="$IT_DIR/dashboard-react-admin"
[ -f "$V2/package.json" ] || { echo "ERROR: no package.json at vendored $V2" >&2; exit 2; }
[ -f "$IT_DIR/dashboard/index.html" ] || { echo "ERROR: vanilla dashboard/index.html missing at $IT_DIR" >&2; exit 2; }

cd "$V2" || { echo "ERROR: cannot cd $V2" >&2; exit 2; }
echo "integration-tests-build: npm ci (fallback npm install)" >&2
npm ci >/dev/null 2>&1 || npm install >/dev/null 2>&1

echo "integration-tests-build: vite build (base=$DASHBOARD_BASE)" >&2
DASHBOARD_BASE="$DASHBOARD_BASE" npm run build >&2
[ -f dist/index.html ] || { echo "ERROR: dist/index.html missing after build" >&2; exit 3; }

# last line = source root, captured by the playbook for the two sync tasks
echo "$IT_DIR"
