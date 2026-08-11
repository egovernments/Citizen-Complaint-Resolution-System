#!/usr/bin/env bash
# deploy-pr.sh — Deploy a PR preview environment
#
# Checks out the PR branch and starts pgr-services, digit-ui, and jupyter
# using the PR's own local-setup/docker-compose.yml. Core services must
# already be running (see setup-ci.sh).
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
LOCAL_SETUP="$REPO_ROOT/local-setup"
STATE_DIR="/etc/pr-preview/state"
STATE_FILE="$STATE_DIR/pr-${PR_NUMBER}.json"

echo "=== Deploying PR #${PR_NUMBER} Preview ==="
echo ""

# 1. Check if another PR is already deployed (one at a time)
ACTIVE=$(find "$STATE_DIR" -name 'pr-*.json' 2>/dev/null || true)
if [ -n "$ACTIVE" ]; then
    ACTIVE_PR=$(basename "$ACTIVE" .json | sed 's/pr-//')
    if [ "$ACTIVE_PR" != "$PR_NUMBER" ]; then
        echo "Another PR (#${ACTIVE_PR}) is currently deployed."
        echo "Cleaning it up first..."
        bash "$(dirname "$0")/cleanup-pr.sh" "$ACTIVE_PR"
    fi
fi

# 2. Fetch PR branch
echo "Fetching PR #${PR_NUMBER}..."
cd "$REPO_ROOT"
# Determine remote: prefer upstream, fall back to origin
PR_REMOTE="upstream"
if ! git remote | grep -q "^upstream$"; then
    PR_REMOTE="origin"
fi
git fetch "$PR_REMOTE" "pull/${PR_NUMBER}/head:pr-${PR_NUMBER}" --force
git checkout "pr-${PR_NUMBER}"
COMMIT_SHA="${COMMIT_SHA:-$(git rev-parse --short HEAD)}"
echo "  Branch: pr-${PR_NUMBER}"
echo "  Commit: $COMMIT_SHA"

# 3. Stop any existing app services (pgr-services, digit-ui, jupyter)
echo ""
echo "Stopping existing app services..."
cd "$LOCAL_SETUP"
docker compose -f docker-compose.yml down pgr-services digit-ui jupyter 2>/dev/null || true
# Force-remove in case compose down didn't catch them
docker rm -f pgr-services digit-ui digit-jupyter 2>/dev/null || true

# 4. Start app services from the PR's own compose
echo ""
echo "Starting PR #${PR_NUMBER} services from local-setup/docker-compose.yml..."
docker compose -f docker-compose.yml build jupyter 2>&1 || true
docker compose -f docker-compose.yml up -d --no-deps pgr-services digit-ui jupyter

# 5. Wait for health
echo ""
echo "Waiting for services to become healthy..."

# PGR services (Java, takes longest)
echo -n "  pgr-services..."
TIMEOUT=180
elapsed=0
while [ $elapsed -lt $TIMEOUT ]; do
    status=$(docker inspect --format='{{.State.Health.Status}}' pgr-services 2>/dev/null || echo "missing")
    if [ "$status" = "healthy" ]; then
        echo " OK"
        break
    fi
    # If container isn't running, try starting it
    if [ "$status" = "missing" ]; then
        docker compose -f docker-compose.yml up -d --no-deps pgr-services 2>/dev/null || true
    fi
    sleep 5
    elapsed=$((elapsed + 5))
    echo -n "."
done
if [ $elapsed -ge $TIMEOUT ]; then
    echo " TIMEOUT (status: $status — may still be starting)"
    echo "  Check logs: docker logs pgr-services"
fi

# digit-ui (fast, but healthcheck may fail due to Alpine IPv6 localhost issue)
echo -n "  digit-ui..."
elapsed=0
while [ $elapsed -lt 30 ]; do
    running=$(docker inspect --format='{{.State.Running}}' digit-ui 2>/dev/null || echo "false")
    if [ "$running" = "true" ]; then
        echo " OK (running)"
        break
    fi
    sleep 3
    elapsed=$((elapsed + 3))
    echo -n "."
done

# jupyter
echo -n "  jupyter..."
elapsed=0
while [ $elapsed -lt 30 ]; do
    running=$(docker inspect --format='{{.State.Running}}' digit-jupyter 2>/dev/null || echo "false")
    if [ "$running" = "true" ]; then
        echo " OK (running)"
        break
    fi
    sleep 3
    elapsed=$((elapsed + 3))
    echo -n "."
done

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
  "jupyter_url": "https://pr-${PR_NUMBER}.preview.egov.theflywheel.in/jupyter/",
  "grafana_url": "https://grafana.preview.egov.theflywheel.in/"
}
EOF

echo ""
echo "=== PR #${PR_NUMBER} Preview Deployed ==="
echo ""
echo "  UI:       https://pr-${PR_NUMBER}.preview.egov.theflywheel.in/digit-ui/"
echo "  API:      https://pr-${PR_NUMBER}.preview.egov.theflywheel.in/pgr-services/"
echo "  Jupyter:  https://pr-${PR_NUMBER}.preview.egov.theflywheel.in/jupyter/"
echo "  Grafana:  https://grafana.preview.egov.theflywheel.in/"
echo ""
echo "  Login:    ADMIN / eGov@123"
echo ""
