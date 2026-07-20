#!/usr/bin/env bash
# Publish a test run to the host. Designed to be run from the runner
# (10.0.0.6) after Playwright + build-catalog.ts have produced
# playwright-report/, test-results/, report.json, catalog.json, history.json.
#
# Usage:
#   scripts/publish.sh <run-id>
#
# Env overrides:
#   HOST_SSH        — ssh target (default: egov-nairobi)
#   HOST_DIR        — remote directory (default: /var/www/tests)
#   RUN_LIMIT       — keep at most this many runs on host (default: 5)
#   RSYNC_RETRIES   — total attempts before giving up (default: 2)
set -euo pipefail

RUN_ID="${1:-}"
if [[ -z "$RUN_ID" ]]; then
  echo "usage: $0 <run-id>" >&2
  exit 2
fi

HOST_SSH="${HOST_SSH:-egov-nairobi}"
HOST_DIR="${HOST_DIR:-/var/www/tests}"
RUN_LIMIT="${RUN_LIMIT:-5}"
RSYNC_RETRIES="${RSYNC_RETRIES:-2}"

REPO_DIR="$(cd "$(dirname "$0")/.." && pwd)"
cd "$REPO_DIR"

# Sanity checks.
for f in catalog.json history.json playwright-report/index.html report.json; do
  if [[ ! -e "$f" ]]; then
    echo "[publish] missing $f — refusing to publish" >&2
    exit 3
  fi
done

# Refuse to publish if test-results/ is empty or near-empty. Videos and
# traces live under test-results/<test-dir>/. Publishing with an empty
# test-results would silently overwrite the host's existing run dir
# (lost 191 MB of videos this way once — never again).
if [[ ! -d test-results ]]; then
  echo "[publish] test-results/ directory is missing — refusing to publish (run playwright first)" >&2
  exit 3
fi
RESULTS_COUNT=$(find test-results -mindepth 1 -maxdepth 1 -type d | wc -l)
if [[ "$RESULTS_COUNT" -lt 2 ]]; then
  echo "[publish] test-results/ has only $RESULTS_COUNT entry — looks like Playwright didn't run here" >&2
  echo "[publish] aborting to avoid overwriting an existing run on the host" >&2
  exit 3
fi

# Free-space pre-check on host (best-effort: abort if <5GB free).
free_kb=$(ssh -o ConnectTimeout=10 "$HOST_SSH" "df --output=avail -k '$HOST_DIR' 2>/dev/null | tail -1" || echo 0)
if [[ "$free_kb" =~ ^[0-9]+$ ]] && [[ "$free_kb" -lt 5242880 ]]; then
  echo "[publish] host has only $((free_kb/1024)) MB free at $HOST_DIR; aborting" >&2
  exit 4
fi

# Ensure the run directory and dashboard exist on the host (idempotent).
ssh "$HOST_SSH" "mkdir -p '$HOST_DIR/runs/$RUN_ID' '$HOST_DIR/_incoming/$RUN_ID'"

# Push run artifacts to a staging dir, then atomically swap.
attempt=0
while : ; do
  attempt=$((attempt+1))
  if rsync -avh --delete \
      --exclude='*.tmp' \
      playwright-report/ "$HOST_SSH:$HOST_DIR/_incoming/$RUN_ID/playwright-report/" \
   && rsync -avh --delete \
      test-results/ "$HOST_SSH:$HOST_DIR/_incoming/$RUN_ID/test-results/" 2>/dev/null \
   ; then
    rsync -avh report.json "$HOST_SSH:$HOST_DIR/_incoming/$RUN_ID/report.json"
    break
  fi
  if [[ "$attempt" -ge "$RSYNC_RETRIES" ]]; then
    echo "[publish] rsync of run artifacts failed after $attempt attempts" >&2
    exit 5
  fi
  echo "[publish] rsync attempt $attempt failed, retrying in 30s..." >&2
  sleep 30
done

# Atomically move staged run into place; remove any prior dir for same run id.
ssh "$HOST_SSH" "
  set -e
  rm -rf '$HOST_DIR/runs/$RUN_ID'
  mv '$HOST_DIR/_incoming/$RUN_ID' '$HOST_DIR/runs/$RUN_ID'
"

# Push catalog + history + dashboard assets last so the dashboard never points
# at a half-uploaded run.
rsync -avh \
  catalog.json history.json \
  "$HOST_SSH:$HOST_DIR/"
# IMPORTANT: --delete on dashboard sync must NOT touch runs/, catalog.json,
# history.json, or _incoming/. Without these excludes, --delete wipes the
# entire host directory of everything not in dashboard/.
rsync -avh --delete \
  --exclude=runs \
  --exclude=_incoming \
  --exclude=catalog.json \
  --exclude=history.json \
  dashboard/ "$HOST_SSH:$HOST_DIR/"

# Prune older runs on host to RUN_LIMIT.
ssh "$HOST_SSH" "
  set -e
  cd '$HOST_DIR/runs'
  ls -1t | tail -n +$((RUN_LIMIT+1)) | xargs -r rm -rf
"

echo "[publish] done — https://naipepea.digit.org/tests/#test/<id> for individual tests"
