#!/usr/bin/env bash
# setup-ci.sh — One-time CI machine setup for PR preview environments
#
# Starts the shared DIGIT core services + observability stack + Caddy/nginx.
# Run this once on the CI machine (89.167.55.190) before deploying any PRs.
#
# Usage: bash .github/pr-preview/setup-ci.sh

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
LOCAL_SETUP="$REPO_ROOT/local-setup"
PR_PREVIEW="$REPO_ROOT/.github/pr-preview"
STATE_DIR="/etc/pr-preview/state"

echo "=== PR Preview: CI Machine Setup ==="
echo "Repo root: $REPO_ROOT"
echo ""

# 1. Install jq if missing
if ! command -v jq &>/dev/null; then
    echo "Installing jq..."
    apt-get update -qq && apt-get install -y -qq jq
fi

# 2. Create state directories
echo "Creating state directories..."
mkdir -p "$STATE_DIR"

# 3. Copy OTEL Java agent into the pr-preview/otel directory (if not already there)
OTEL_AGENT_SRC="/root/code/tilt-demo/otel/opentelemetry-javaagent.jar"
OTEL_AGENT_DST="$PR_PREVIEW/otel/opentelemetry-javaagent.jar"
if [ ! -f "$OTEL_AGENT_DST" ] && [ -f "$OTEL_AGENT_SRC" ]; then
    echo "Copying OTEL Java agent..."
    cp "$OTEL_AGENT_SRC" "$OTEL_AGENT_DST"
elif [ ! -f "$OTEL_AGENT_DST" ]; then
    echo "WARNING: OTEL Java agent not found at $OTEL_AGENT_SRC"
    echo "Download it: curl -L -o $OTEL_AGENT_DST https://github.com/open-telemetry/opentelemetry-java-instrumentation/releases/download/v2.11.0/opentelemetry-javaagent.jar"
fi

# 4. Start shared core services with OTEL overlay
echo ""
echo "Starting shared core services..."
cd "$LOCAL_SETUP"

docker compose \
    -f docker-compose.yml \
    -f "$PR_PREVIEW/docker-compose.core.yml" \
    up -d

echo ""
echo "Waiting for core services to become healthy..."

# Wait for key services (timeout after 5 minutes)
TIMEOUT=300
SERVICES=(egov-mdms-service egov-user egov-workflow-v2 kong-gateway otel-collector)
for svc in "${SERVICES[@]}"; do
    echo -n "  Waiting for $svc..."
    elapsed=0
    while [ $elapsed -lt $TIMEOUT ]; do
        status=$(docker inspect --format='{{.State.Health.Status}}' "$svc" 2>/dev/null || echo "missing")
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
    fi
done

# 5. Setup cron for stale cleanup
CRON_CMD="0 */6 * * * bash $PR_PREVIEW/cleanup-stale.sh >> /var/log/pr-preview-cleanup.log 2>&1"
if ! crontab -l 2>/dev/null | grep -q "cleanup-stale.sh"; then
    echo "Installing cleanup cron job (every 6 hours)..."
    (crontab -l 2>/dev/null; echo "$CRON_CMD") | crontab -
else
    echo "Cleanup cron job already installed."
fi

# 6. Install PR monitor service (polls GitHub, auto-deploys/cleans PRs)
echo ""
echo "Installing PR monitor service..."
bash "$PR_PREVIEW/pr-monitor.sh" --install

echo ""
echo "=== Setup Complete ==="
echo ""
echo "Core services:  docker compose -f docker-compose.yml -f $PR_PREVIEW/docker-compose.core.yml ps"
echo "PR monitor:     systemctl status pr-monitor"
echo "Monitor logs:   journalctl -u pr-monitor -f"
echo "Deploy manual:  bash $PR_PREVIEW/deploy-pr.sh <pr-number>"
echo "List active:    bash $PR_PREVIEW/list-prs.sh"
echo "Grafana:        https://grafana.preview.egov.theflywheel.in/"
