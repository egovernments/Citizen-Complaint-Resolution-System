#!/usr/bin/env bash
# list-prs.sh — List active PR preview environments
#
# Shows a table of all deployed PR previews with status, commit, and memory usage.
#
# Usage: bash .github/pr-preview/list-prs.sh

set -euo pipefail

STATE_DIR="/etc/pr-preview/state"

if [ ! -d "$STATE_DIR" ] || [ -z "$(ls "$STATE_DIR"/pr-*.json 2>/dev/null)" ]; then
    echo "No active PR previews."
    exit 0
fi

echo "=== Active PR Previews ==="
echo ""
printf "%-6s %-10s %-22s %-12s %-12s %-10s %s\n" \
    "PR#" "Commit" "Deployed At" "PGR" "UI" "Memory" "URL"
printf "%-6s %-10s %-22s %-12s %-12s %-10s %s\n" \
    "----" "------" "-----------" "---" "--" "------" "---"

for state_file in "$STATE_DIR"/pr-*.json; do
    PR_NUM=$(jq -r '.pr_number' "$state_file")
    COMMIT=$(jq -r '.commit_sha' "$state_file")
    DEPLOYED=$(jq -r '.deployed_at' "$state_file" | cut -c1-19 | tr 'T' ' ')

    # Container status
    PGR_STATUS=$(docker inspect --format='{{.State.Health.Status}}' "pgr-services-pr${PR_NUM}" 2>/dev/null || echo "gone")
    UI_STATUS=$(docker inspect --format='{{.State.Health.Status}}' "digit-ui-pr${PR_NUM}" 2>/dev/null || echo "gone")

    # Memory usage (sum of all PR containers)
    MEM_TOTAL=0
    for cname in "pgr-services-pr${PR_NUM}" "digit-ui-pr${PR_NUM}" "jupyter-pr${PR_NUM}"; do
        mem=$(docker stats --no-stream --format '{{.MemUsage}}' "$cname" 2>/dev/null | grep -oP '[\d.]+(?=MiB)' || echo "0")
        MEM_TOTAL=$(echo "$MEM_TOTAL + ${mem:-0}" | bc 2>/dev/null || echo "$MEM_TOTAL")
    done

    URL="https://pr-${PR_NUM}.preview.egov.theflywheel.in/digit-ui/"

    printf "%-6s %-10s %-22s %-12s %-12s %-10s %s\n" \
        "$PR_NUM" "$COMMIT" "$DEPLOYED" "$PGR_STATUS" "$UI_STATUS" "${MEM_TOTAL}MB" "$URL"
done

echo ""
echo "Grafana: https://grafana.preview.egov.theflywheel.in/"
