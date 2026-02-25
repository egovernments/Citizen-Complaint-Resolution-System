#!/usr/bin/env bash
# deploy-pr.sh — Deploy a PR preview environment
#
# Builds PR-specific images (pgr-services, digit-ui, jupyter) and starts them
# on the shared egov-network. nginx auto-discovers them via Docker DNS.
#
# Usage: bash .github/pr-preview/deploy-pr.sh <pr-number> [--sha <commit-sha>]

set -euo pipefail

PR_NUMBER="${1:-}"
COMMIT_SHA=""

# Parse args
shift || true
while [[ $# -gt 0 ]]; do
    case "$1" in
        --sha) COMMIT_SHA="$2"; shift 2 ;;
        *) echo "Unknown arg: $1"; exit 1 ;;
    esac
done

if [ -z "$PR_NUMBER" ] || ! [[ "$PR_NUMBER" =~ ^[0-9]+$ ]] || [ "$PR_NUMBER" -gt 9999 ]; then
    echo "Usage: deploy-pr.sh <pr-number> [--sha <commit-sha>]"
    echo "  pr-number must be a number between 1 and 9999"
    exit 1
fi

REPO_ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
PR_PREVIEW="$REPO_ROOT/.github/pr-preview"
LOCAL_SETUP="$REPO_ROOT/local-setup"
STATE_DIR="/etc/pr-preview/state"
STATE_FILE="$STATE_DIR/pr-${PR_NUMBER}.json"

echo "=== Deploying PR #${PR_NUMBER} Preview ==="
echo ""

# 1. Check concurrent PR limit
ACTIVE_COUNT=$(ls "$STATE_DIR"/pr-*.json 2>/dev/null | wc -l || echo 0)
if [ "$ACTIVE_COUNT" -ge 10 ]; then
    echo "ERROR: Maximum 10 concurrent PR previews reached ($ACTIVE_COUNT active)"
    echo "Run 'list-prs.sh' to see active previews, or 'cleanup-pr.sh <N>' to remove one."
    exit 1
fi

# 2. Fetch PR branch
echo "Fetching PR #${PR_NUMBER}..."
cd "$REPO_ROOT"
git fetch origin "pull/${PR_NUMBER}/head:pr-${PR_NUMBER}" --force
git checkout "pr-${PR_NUMBER}"
COMMIT_SHA="${COMMIT_SHA:-$(git rev-parse --short HEAD)}"
echo "  Commit: $COMMIT_SHA"

# 3. Build images (in parallel where possible)
echo ""
echo "Building images..."

echo "  Building pgr-services (this may take 3-5 minutes)..."
docker build \
    -t "ccrs/pgr-services:pr-${PR_NUMBER}" \
    -f backend/pgr-services/Dockerfile \
    backend/pgr-services/ &
PGR_PID=$!

echo "  Building digit-ui (this may take 3-5 minutes)..."
docker build \
    -t "ccrs/digit-ui:pr-${PR_NUMBER}" \
    -f frontend/micro-ui/web/docker/Dockerfile \
    --build-arg WORK_DIR=. \
    frontend/micro-ui/ &
UI_PID=$!

echo "  Building jupyter..."
docker build \
    -t "ccrs/jupyter:pr-${PR_NUMBER}" \
    -f local-setup/jupyter/Dockerfile \
    local-setup/jupyter/ &
JUP_PID=$!

# Wait for all builds
FAILED=0
wait $PGR_PID || { echo "ERROR: pgr-services build failed"; FAILED=1; }
wait $UI_PID || { echo "ERROR: digit-ui build failed"; FAILED=1; }
wait $JUP_PID || { echo "ERROR: jupyter build failed"; FAILED=1; }

if [ $FAILED -ne 0 ]; then
    echo "Build failed. Cleaning up..."
    exit 1
fi
echo "  All images built successfully."

# 4. Start PR services
echo ""
echo "Starting PR #${PR_NUMBER} services..."
cd "$LOCAL_SETUP"

PR_NUMBER="$PR_NUMBER" docker compose \
    -f "$PR_PREVIEW/docker-compose.pr.yml" \
    -p "pr-${PR_NUMBER}" \
    up -d

# 5. Wait for health
echo ""
echo "Waiting for services to become healthy..."

# PGR services (Java, takes longest)
echo -n "  pgr-services-pr${PR_NUMBER}..."
TIMEOUT=180
elapsed=0
while [ $elapsed -lt $TIMEOUT ]; do
    status=$(docker inspect --format='{{.State.Health.Status}}' "pgr-services-pr${PR_NUMBER}" 2>/dev/null || echo "starting")
    if [ "$status" = "healthy" ]; then
        echo " OK"
        break
    fi
    sleep 5
    elapsed=$((elapsed + 5))
    echo -n "."
done
if [ $elapsed -ge $TIMEOUT ]; then
    echo " TIMEOUT (status: $status)"
    echo "  Check logs: docker logs pgr-services-pr${PR_NUMBER}"
fi

# digit-ui (fast)
echo -n "  digit-ui-pr${PR_NUMBER}..."
elapsed=0
while [ $elapsed -lt 60 ]; do
    status=$(docker inspect --format='{{.State.Health.Status}}' "digit-ui-pr${PR_NUMBER}" 2>/dev/null || echo "starting")
    if [ "$status" = "healthy" ]; then
        echo " OK"
        break
    fi
    sleep 3
    elapsed=$((elapsed + 3))
    echo -n "."
done
if [ $elapsed -ge 60 ]; then
    echo " TIMEOUT"
fi

# 6. Write state file
mkdir -p "$STATE_DIR"
cat > "$STATE_FILE" <<EOF
{
  "pr_number": ${PR_NUMBER},
  "commit_sha": "${COMMIT_SHA}",
  "deployed_at": "$(date -u +%Y-%m-%dT%H:%M:%SZ)",
  "deployed_at_epoch": $(date +%s),
  "url": "https://pr-${PR_NUMBER}.preview.egov.theflywheel.in/digit-ui/",
  "api_url": "https://pr-${PR_NUMBER}.preview.egov.theflywheel.in/pgr-services/",
  "jupyter_url": "https://pr-${PR_NUMBER}.preview.egov.theflywheel.in/jupyter/?token=pr${PR_NUMBER}",
  "grafana_url": "https://grafana.preview.egov.theflywheel.in/"
}
EOF

echo ""
echo "=== PR #${PR_NUMBER} Preview Deployed ==="
echo ""
echo "  UI:       https://pr-${PR_NUMBER}.preview.egov.theflywheel.in/digit-ui/"
echo "  API:      https://pr-${PR_NUMBER}.preview.egov.theflywheel.in/pgr-services/"
echo "  Jupyter:  https://pr-${PR_NUMBER}.preview.egov.theflywheel.in/jupyter/?token=pr${PR_NUMBER}"
echo "  Grafana:  https://grafana.preview.egov.theflywheel.in/"
echo "  Traces:   Search for service 'pgr-services-pr${PR_NUMBER}'"
echo ""
echo "  Login:    ADMIN / eGov@123"
