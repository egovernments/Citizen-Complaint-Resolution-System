#!/usr/bin/env bash
# cleanup-pr.sh — Remove a PR preview environment
#
# Stops pgr-services, digit-ui, jupyter containers and cleans up state.
# Core services are left running.
#
# Usage: bash .github/pr-preview/cleanup-pr.sh <pr-number>

set -euo pipefail

PR_NUMBER="${1:-}"

if [ -z "$PR_NUMBER" ] || ! [[ "$PR_NUMBER" =~ ^[0-9]+$ ]]; then
    echo "Usage: cleanup-pr.sh <pr-number>"
    exit 1
fi

REPO_ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
LOCAL_SETUP="$REPO_ROOT/local-setup"
STATE_DIR="/etc/pr-preview/state"
STATE_FILE="$STATE_DIR/pr-${PR_NUMBER}.json"

echo "=== Cleaning up PR #${PR_NUMBER} Preview ==="

# 1. Stop app services
echo "Stopping app services..."
cd "$LOCAL_SETUP"
docker compose -f docker-compose.yml stop pgr-services digit-ui jupyter 2>/dev/null || true
docker compose -f docker-compose.yml rm -f pgr-services digit-ui jupyter 2>/dev/null || true

# 2. Force-remove in case compose didn't catch them
for name in pgr-services digit-ui digit-jupyter; do
    if docker ps -a --format '{{.Names}}' | grep -q "^${name}$"; then
        echo "  Force-removing: $name"
        docker rm -f "$name" 2>/dev/null || true
    fi
done

# 3. Remove state file
if [ -f "$STATE_FILE" ]; then
    rm "$STATE_FILE"
    echo "State file removed."
fi

# 4. Clean git branch
cd "$REPO_ROOT"
DEFAULT_BRANCH=$(git symbolic-ref refs/remotes/origin/HEAD 2>/dev/null | sed 's@^refs/remotes/origin/@@' || echo "main")
git checkout "$DEFAULT_BRANCH" 2>/dev/null || git checkout main 2>/dev/null || true
git branch -D "pr-${PR_NUMBER}" 2>/dev/null || true

echo ""
echo "=== PR #${PR_NUMBER} Preview Cleaned Up ==="
