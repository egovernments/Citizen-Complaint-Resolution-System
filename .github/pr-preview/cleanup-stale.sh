#!/usr/bin/env bash
# cleanup-stale.sh — Remove PR previews older than 48 hours
#
# Intended to run as a cron job (every 6 hours).
# Reads state JSON files and removes deployments whose timestamp > 48h ago.
#
# Usage: bash .github/pr-preview/cleanup-stale.sh
# Cron:  0 */6 * * * bash /path/to/cleanup-stale.sh >> /var/log/pr-preview-cleanup.log 2>&1

set -euo pipefail

STATE_DIR="/etc/pr-preview/state"
PR_PREVIEW="$(cd "$(dirname "$0")" && pwd)"
MAX_AGE_SECONDS=$((48 * 3600))  # 48 hours
NOW=$(date +%s)

if [ ! -d "$STATE_DIR" ] || [ -z "$(ls "$STATE_DIR"/pr-*.json 2>/dev/null)" ]; then
    exit 0
fi

echo "[$(date -u +%Y-%m-%dT%H:%M:%SZ)] Checking for stale PR previews..."

for state_file in "$STATE_DIR"/pr-*.json; do
    PR_NUM=$(jq -r '.pr_number' "$state_file")
    DEPLOYED_EPOCH=$(jq -r '.deployed_at_epoch' "$state_file")
    AGE=$((NOW - DEPLOYED_EPOCH))

    if [ "$AGE" -gt "$MAX_AGE_SECONDS" ]; then
        AGE_HOURS=$((AGE / 3600))
        echo "  PR #${PR_NUM}: deployed ${AGE_HOURS}h ago — removing..."
        bash "$PR_PREVIEW/cleanup-pr.sh" "$PR_NUM"
    fi
done

echo "[$(date -u +%Y-%m-%dT%H:%M:%SZ)] Stale cleanup complete."
