#!/usr/bin/env bash
# cleanup-pr.sh — Remove a PR preview environment
#
# Stops and removes PR-specific containers, images, and state.
# No nginx/Caddy cleanup needed — nginx simply gets DNS errors for removed
# containers (returns 502, which is correct behavior).
#
# Usage: bash .github/pr-preview/cleanup-pr.sh <pr-number>

set -euo pipefail

PR_NUMBER="${1:-}"

if [ -z "$PR_NUMBER" ] || ! [[ "$PR_NUMBER" =~ ^[0-9]+$ ]]; then
    echo "Usage: cleanup-pr.sh <pr-number>"
    exit 1
fi

REPO_ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
PR_PREVIEW="$REPO_ROOT/.github/pr-preview"
LOCAL_SETUP="$REPO_ROOT/local-setup"
STATE_DIR="/etc/pr-preview/state"
STATE_FILE="$STATE_DIR/pr-${PR_NUMBER}.json"

echo "=== Cleaning up PR #${PR_NUMBER} Preview ==="

# 1. Stop and remove containers via compose
echo "Stopping containers..."
cd "$LOCAL_SETUP"
PR_NUMBER="$PR_NUMBER" docker compose \
    -f "$PR_PREVIEW/docker-compose.pr.yml" \
    -p "pr-${PR_NUMBER}" \
    down --remove-orphans 2>/dev/null || true

# 2. Force-remove any orphan containers (safety net)
for name in "pgr-services-pr${PR_NUMBER}" "digit-ui-pr${PR_NUMBER}" "jupyter-pr${PR_NUMBER}"; do
    if docker ps -a --format '{{.Names}}' | grep -q "^${name}$"; then
        echo "  Force-removing orphan: $name"
        docker rm -f "$name" 2>/dev/null || true
    fi
done

# 3. Remove images
echo "Removing images..."
docker rmi "ccrs/pgr-services:pr-${PR_NUMBER}" 2>/dev/null || true
docker rmi "ccrs/digit-ui:pr-${PR_NUMBER}" 2>/dev/null || true
docker rmi "ccrs/jupyter:pr-${PR_NUMBER}" 2>/dev/null || true

# 4. Remove state file
if [ -f "$STATE_FILE" ]; then
    rm "$STATE_FILE"
    echo "State file removed."
fi

# 5. Clean git branch
cd "$REPO_ROOT"
git checkout main 2>/dev/null || git checkout - 2>/dev/null || true
git branch -D "pr-${PR_NUMBER}" 2>/dev/null || true

echo ""
echo "=== PR #${PR_NUMBER} Preview Cleaned Up ==="
