#!/usr/bin/env bash
# pr-monitor.sh — Poll GitHub for PR changes, deploy/cleanup automatically
#
# Runs as a systemd service on the CI machine. Checks for open PRs every 60s,
# deploys new/updated ones, cleans up closed ones, and comments on the PR.
#
# Requires: gh (GitHub CLI, authenticated), jq, docker
#
# Usage:
#   bash .github/pr-preview/pr-monitor.sh              # run once
#   bash .github/pr-preview/pr-monitor.sh --daemon      # poll loop
#
# Install as service:
#   bash .github/pr-preview/pr-monitor.sh --install

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
PR_PREVIEW="$REPO_ROOT/.github/pr-preview"
STATE_DIR="/etc/pr-preview/state"
POLL_INTERVAL="${PR_MONITOR_INTERVAL:-60}"
GITHUB_REPO="${PR_MONITOR_REPO:-egovernments/Citizen-Complaint-Resolution-System}"
LOG_FILE="/var/log/pr-monitor.log"

mkdir -p "$STATE_DIR"

log() { echo "[$(date -u +%Y-%m-%dT%H:%M:%SZ)] $*"; }

# --- Comment on PR with preview URLs ---
comment_deploy() {
    local pr="$1" sha="$2"
    local short_sha="${sha:0:7}"
    local body
    body=$(cat <<COMMENT
## Preview Environment Ready

| Service | URL |
|---------|-----|
| **UI** | [pr-${pr}.preview.egov.theflywheel.in/digit-ui/](https://pr-${pr}.preview.egov.theflywheel.in/digit-ui/) |
| **API** | [pr-${pr}.preview.egov.theflywheel.in/pgr-services/](https://pr-${pr}.preview.egov.theflywheel.in/pgr-services/) |
| **Jupyter** | [pr-${pr}.preview.egov.theflywheel.in/jupyter/](https://pr-${pr}.preview.egov.theflywheel.in/jupyter/) |
| **Grafana** | [grafana.preview.egov.theflywheel.in](https://grafana.preview.egov.theflywheel.in/) |

**Login:** \`ADMIN\` / \`eGov@123\`
**Commit:** \`${short_sha}\`

> Preview auto-expires after 48 hours. Push new commits to redeploy.
COMMENT
    )

    # Find existing preview comment to update (avoid spam)
    local existing_id
    existing_id=$(gh api "repos/${GITHUB_REPO}/issues/${pr}/comments" --paginate -q \
        '.[] | select(.body | contains("Preview Environment Ready")) | .id' 2>/dev/null | head -1 || true)

    if [ -n "$existing_id" ]; then
        gh api "repos/${GITHUB_REPO}/issues/comments/${existing_id}" -X PATCH -f body="$body" >/dev/null 2>&1 || true
        log "  Updated PR #${pr} comment"
    else
        gh api "repos/${GITHUB_REPO}/issues/${pr}/comments" -f body="$body" >/dev/null 2>&1 || true
        log "  Posted PR #${pr} comment"
    fi
}

comment_cleanup() {
    local pr="$1"
    local body="## Preview Environment Cleaned Up\n\nPR #${pr} preview has been removed."

    local existing_id
    existing_id=$(gh api "repos/${GITHUB_REPO}/issues/${pr}/comments" --paginate -q \
        '.[] | select(.body | contains("Preview Environment")) | .id' 2>/dev/null | head -1 || true)

    if [ -n "$existing_id" ]; then
        gh api "repos/${GITHUB_REPO}/issues/comments/${existing_id}" -X PATCH -f body="$body" >/dev/null 2>&1 || true
    else
        gh api "repos/${GITHUB_REPO}/issues/${pr}/comments" -f body="$body" >/dev/null 2>&1 || true
    fi
    log "  Posted cleanup comment on PR #${pr}"
}

# --- Core: check all PRs and reconcile ---
reconcile() {
    log "Checking PRs on ${GITHUB_REPO}..."

    # Get all open PRs (number + head SHA)
    local open_prs
    open_prs=$(gh pr list --repo "$GITHUB_REPO" --state open --json number,headRefOid,headRefName \
        -q '.[] | "\(.number) \(.headRefOid) \(.headRefName)"' 2>/dev/null || true)

    if [ -z "$open_prs" ]; then
        log "  No open PRs found (or gh auth failed)"
    fi

    # Track which PRs are still open (for cleanup)
    local open_numbers=()

    # Deploy new or updated PRs
    while IFS=' ' read -r pr_num head_sha branch_name; do
        [ -z "$pr_num" ] && continue
        open_numbers+=("$pr_num")

        local state_file="$STATE_DIR/pr-${pr_num}.json"

        if [ -f "$state_file" ]; then
            # Already deployed — check if SHA changed
            local deployed_sha
            deployed_sha=$(jq -r '.commit_sha' "$state_file" 2>/dev/null || echo "")
            if [ "$deployed_sha" = "$head_sha" ] || [ "$deployed_sha" = "${head_sha:0:7}" ]; then
                continue  # No change, skip
            fi
            log "PR #${pr_num} updated: ${deployed_sha:0:7} → ${head_sha:0:7}"
        else
            log "PR #${pr_num} is new, deploying..."
        fi

        # Deploy (this blocks — one PR at a time to avoid resource contention)
        if bash "$PR_PREVIEW/deploy-pr.sh" "$pr_num" --sha "$head_sha" 2>&1 | tee -a "$LOG_FILE"; then
            comment_deploy "$pr_num" "$head_sha"
            log "PR #${pr_num} deployed successfully"
        else
            log "PR #${pr_num} deploy FAILED"
        fi

    done <<< "$open_prs"

    # Cleanup closed PRs (deployed but no longer in open list)
    for state_file in "$STATE_DIR"/pr-*.json; do
        [ -f "$state_file" ] || continue
        local deployed_pr
        deployed_pr=$(jq -r '.pr_number' "$state_file" 2>/dev/null || echo "")
        [ -z "$deployed_pr" ] && continue

        local still_open=false
        for num in "${open_numbers[@]+"${open_numbers[@]}"}"; do
            if [ "$num" = "$deployed_pr" ]; then
                still_open=true
                break
            fi
        done

        if [ "$still_open" = false ]; then
            log "PR #${deployed_pr} is closed, cleaning up..."
            bash "$PR_PREVIEW/cleanup-pr.sh" "$deployed_pr" 2>&1 | tee -a "$LOG_FILE" || true
            comment_cleanup "$deployed_pr"
            log "PR #${deployed_pr} cleaned up"
        fi
    done

    log "Reconcile done."
}

# --- Install as systemd service ---
install_service() {
    cat > /etc/systemd/system/pr-monitor.service <<EOF
[Unit]
Description=PR Preview Monitor
After=docker.service
Requires=docker.service

[Service]
Type=simple
ExecStart=$(readlink -f "$0") --daemon
Restart=always
RestartSec=10
Environment=PR_MONITOR_REPO=${GITHUB_REPO}
Environment=PR_MONITOR_INTERVAL=${POLL_INTERVAL}
StandardOutput=append:${LOG_FILE}
StandardError=append:${LOG_FILE}

[Install]
WantedBy=multi-user.target
EOF

    systemctl daemon-reload
    systemctl enable pr-monitor
    systemctl start pr-monitor
    echo "pr-monitor service installed and started."
    echo "  Logs:   journalctl -u pr-monitor -f"
    echo "  Status: systemctl status pr-monitor"
    echo "  Stop:   systemctl stop pr-monitor"
}

# --- Main ---
case "${1:-}" in
    --daemon)
        log "Starting PR monitor daemon (poll every ${POLL_INTERVAL}s, repo: ${GITHUB_REPO})"
        while true; do
            reconcile || log "ERROR: reconcile failed"
            sleep "$POLL_INTERVAL"
        done
        ;;
    --install)
        install_service
        ;;
    --once|"")
        reconcile
        ;;
    *)
        echo "Usage: pr-monitor.sh [--daemon|--install|--once]"
        exit 1
        ;;
esac
