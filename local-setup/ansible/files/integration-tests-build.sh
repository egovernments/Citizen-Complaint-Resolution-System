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
# Normalize IT_DIR before anything consumes it. The playbook's default is
# `{{ playbook_dir }}/../../tests/integration-tests`, which carries `..` segments.
# That is harmless for cd/rsync, but this value is echoed back on the last line,
# captured as `integration_tests_dir`, and rendered verbatim into
# templates/integration-tests-runner.service.j2 — and systemd REFUSES to load a
# unit whose WorkingDirectory= is not normalized:
#   WorkingDirectory= path is not normalized: /opt/ccrs/local-setup/ansible/../../tests/integration-tests
#   Unit configuration has fatal error, unit will not be started.
# The failing task then ABORTS the play, so every later task — tenant bootstrap
# seeding, INTERNAL_USER, configurator-i18n, novu — silently never runs.
# Resolve once, here, so every consumer gets a clean absolute path.
IT_DIR="$(cd "$IT_DIR" 2>/dev/null && pwd -P)" \
  || { echo "ERROR: integration tests dir not found: $1" >&2; exit 2; }
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
