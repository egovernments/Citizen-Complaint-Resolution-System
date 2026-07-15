#!/usr/bin/env bash
# run-cycle.sh — one test cycle, triggered by the RUN button via server.mjs.
#
# This is the Makefile's run+catalog plus publish.sh, with the ssh/rsync publish
# swapped for a LOCAL copy: serving and running are the same host now, so results
# go straight into $WEBROOT (which nginx serves and the v2 dashboard symlinks to).
#
# Inherited from the daemon's env (server.mjs sets all of these):
#   RUN_ID      run id the daemon minted (also the runs/<id>/ dir + log)
#   REPO_DIR    vendored tests/integration-tests checkout
#   WEBROOT     served dir (catalog.json/history.json/runs live here)
#   TENANT_ENV  optional env file to source (BASE_URL/DIGIT_TENANT/LOCALITY_CODE/…)
#   RUN_LIMIT   keep at most this many runs (default 5)
#   BRANCH      branch label recorded in the catalog (default "deployed")
#
# Single-flight via flock — a second cycle while one is running exits 1 (the
# daemon already 409s the fast path; this guards restarts/cron overlap too).
set -uo pipefail

: "${RUN_ID:?RUN_ID required}"
REPO_DIR="${REPO_DIR:?REPO_DIR required}"
WEBROOT="${WEBROOT:?WEBROOT required}"
TENANT_ENV="${TENANT_ENV:-}"
RUN_LIMIT="${RUN_LIMIT:-5}"
BRANCH="${BRANCH:-deployed}"
LOCK="/tmp/digit-tests.lock"

RUN_DIR="$WEBROOT/runs/$RUN_ID"
mkdir -p "$RUN_DIR"
phase() { echo "$1" > "$RUN_DIR/phase"; echo "===== phase: $1 ====="; }

exec 9>"$LOCK"
if ! flock -n 9; then
  echo "[run-cycle] another run holds $LOCK — aborting" >&2
  phase "aborted-locked"
  exit 1
fi

cd "$REPO_DIR" || { echo "[run-cycle] cannot cd $REPO_DIR" >&2; exit 2; }

# Source the deployed tenant's env so the run targets THIS box's tenant, exactly
# like the nightly. Never bakes tenant values into the runner.
if [[ -n "$TENANT_ENV" && -f "$TENANT_ENV" ]]; then
  echo "[run-cycle] sourcing $TENANT_ENV"
  set -a; # shellcheck disable=SC1090
  source "$TENANT_ENV"; set +a
fi

git rev-parse --short HEAD > .git-sha 2>/dev/null || echo unknown > .git-sha
rm -rf playwright-report test-results report.json

# ---- run ---- (nice'd so the live DIGIT stack on this box keeps priority)
phase "running"
# --global-timeout fires BEFORE the shell `timeout` SIGKILL, so Playwright's json
# reporter still flushes report.json (written at onEnd) with the partial results
# gathered so far. A slow run then degrades to a partial dashboard update instead
# of blanking it entirely (#907). Keep it comfortably under the shell timeout.
timeout 90m nice -n 10 npx playwright test \
  --global-timeout="${PW_GLOBAL_TIMEOUT_MS:-4800000}" \
  || echo "[run-cycle] playwright exited non-zero (failures or global-timeout reached); continuing to catalog"

# ---- catalog ----
phase "catalog"
if [[ ! -f report.json ]]; then
  echo "[run-cycle] no report.json — Playwright crashed before producing one" >&2
  phase "failed-no-report"
  exit 6
fi
# Feed the live on-box history/catalog so the rolling 5-run history accumulates
# across button presses instead of resetting each run.
env BRANCH="$BRANCH" BASE_URL="${BASE_URL:-}" GIT_SHA="$(cat .git-sha)" \
  PUBLIC_HISTORY_JSON="$WEBROOT/history.json" \
  PUBLIC_CATALOG_JSON="$WEBROOT/catalog.json" \
  npx tsx scripts/build-catalog.ts "$RUN_ID" \
  || { echo "[run-cycle] build-catalog failed" >&2; phase "failed-catalog"; exit 7; }

# ---- publish (local copy) ----
# publish.sh's guard, kept verbatim in spirit: refuse to publish an empty
# test-results, which would replace a good run with nothing.
phase "publishing"
RESULTS_COUNT=$(find test-results -mindepth 1 -maxdepth 1 -type d 2>/dev/null | wc -l | tr -d ' ')
if [[ "${RESULTS_COUNT:-0}" -lt 1 ]]; then
  echo "[run-cycle] test-results/ empty — refusing to publish (keeping prior run)" >&2
  phase "failed-empty-results"
  exit 3
fi

cp -f catalog.json history.json "$WEBROOT/" 2>/dev/null || true
# Copy run artifacts in alongside the daemon-written run.log (don't wipe the dir).
cp -f report.json "$RUN_DIR/" 2>/dev/null || true
rsync -a --delete --exclude=run.log --exclude=phase \
  playwright-report "$RUN_DIR/" 2>/dev/null \
  || cp -rf playwright-report "$RUN_DIR/"
rsync -a --delete test-results "$RUN_DIR/" 2>/dev/null \
  || cp -rf test-results "$RUN_DIR/"

# Prune runs/ to exactly the set the dashboard references — the run ids in the
# history.json we just published. This keeps runs/ in lockstep with the catalog:
# a failed-no-report run creates a runs/<id>/ folder but never a catalog entry,
# and the old mtime-based prune ("newest RUN_LIMIT folders") let those
# newer-but-reportless folders evict the runs the catalog still pointed at — so
# the dashboard showed a stale "last run" and 404'd on it (#907 skew).
# build-catalog already dropped dead ids from history, so honouring that set here
# converges disk == catalog. Falls back to the recency prune if the ids can't be
# read (missing/old node, malformed json).
KEEP_IDS="$(node -e 'const fs=require("fs");try{const h=JSON.parse(fs.readFileSync(process.argv[1],"utf8"));process.stdout.write((h.runs||[]).map(r=>r.id).join("\n"))}catch(e){}' "$WEBROOT/history.json" 2>/dev/null)"
if [[ -n "$KEEP_IDS" ]]; then
  ( shopt -s nullglob; cd "$WEBROOT/runs" 2>/dev/null || exit 0
    for d in */; do
      id="${d%/}"
      grep -qxF -- "$id" <<<"$KEEP_IDS" || rm -rf -- "$id"
    done ) || true
else
  ( cd "$WEBROOT/runs" && ls -1t | tail -n +"$((RUN_LIMIT+1))" | xargs -r rm -rf ) || true
fi

phase "done"
echo "[run-cycle] done — RUN_ID=$RUN_ID"
