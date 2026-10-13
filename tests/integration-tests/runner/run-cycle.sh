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
#   RUN_LIMIT   keep the full report (runs/<id>/: Playwright report, videos,
#               traces, run.log) for this many runs (default 5), or for more
#               while a run that still has its report was built with a larger
#               RUN_LIMIT (build-catalog). The catalog keeps results for 30 runs
#               (build-catalog's DEFAULT_HISTORY_LIMIT); older ones show results
#               but no report link.
#   BRANCH      branch label recorded in the catalog (default "deployed")
#   RUN_LOCK    lock this file or directory instead of $WEBROOT (optional)
#
# Single-flight via flock: a second cycle while one is running exits 1 without
# touching runs/ (the daemon already 409s the fast path; this guards restarts,
# cron and the nightly wrappers too). A cycle locks the two things it writes:
# the webroot it publishes and prunes, and the checkout it runs in. Each lock
# is flock(2) on the DIRECTORY itself, the same inode for every user and mount
# namespace. It used to be the file /tmp/digit-tests.lock, but the RUN-button
# daemon runs this script as digit-tests under PrivateTmp=true while the
# nightly wrappers run it as root, so each saw its own /tmp: a button run and a
# nightly could overlap, and one's prune could delete the other's runs/<id>/.
#
# Ownership: the RUN-button daemon runs this script as the webroot's owner
# (digit-tests; the playbook chowns the webroot to it), the nightly wrappers as
# root, and they also create runs/<id>/ and its run.log as root. A root run
# therefore hands everything it leaves in the webroot (its run folder,
# catalog.json, history.json, and any older root-owned runs/<id>/) back to the
# webroot's owner when it exits, and its artifacts in the checkout to the
# checkout's owner. Otherwise the daemon's next prune can't delete a root-owned
# folder, and its next run can't clear the checkout. A prune that fails anyway
# says so in run.log instead of failing silently.
set -uo pipefail

: "${RUN_ID:?RUN_ID required}"
REPO_DIR="${REPO_DIR:?REPO_DIR required}"
WEBROOT="${WEBROOT:?WEBROOT required}"
TENANT_ENV="${TENANT_ENV:-}"
RUN_LIMIT="${RUN_LIMIT:-5}"
BRANCH="${BRANCH:-deployed}"
LOCK="${RUN_LOCK:-$WEBROOT}"

RUN_DIR="$WEBROOT/runs/$RUN_ID"
phase() { echo "$1" > "$RUN_DIR/phase"; echo "===== phase: $1 ====="; }

# As root, give <paths> (recursively) the owner of <reference>; a no-op for
# anyone else, who can only have written files they own.
own_like() {
  local ref="$1"; shift
  (( EUID == 0 )) || return 0
  local p
  for p in "$@"; do
    [[ -e "$p" ]] || continue
    chown -R --reference="$ref" -- "$p" \
      || echo "[run-cycle] could not give $p the owner of $ref" >&2
  done
}

# Everything this run leaves behind, owned like where it lives: the webroot's
# runs/ (this run's folder and any older root-owned ones), catalog.json and
# history.json; in the checkout, the artifacts the run wrote there.
leave_owned() {
  own_like "$WEBROOT" "$WEBROOT/runs" "$WEBROOT/catalog.json" "$WEBROOT/history.json"
  own_like "$REPO_DIR" "$REPO_DIR/.git-sha" "$REPO_DIR/report.json" "$REPO_DIR/catalog.json" \
    "$REPO_DIR/history.json" "$REPO_DIR/playwright-report" "$REPO_DIR/test-results"
}

# Another cycle holds <path>: leave runs/ as it is. Only a folder made for this
# run before it started (the daemon's or a wrapper's, holding run.log) gets the
# phase, and the owner of the webroot, so the running cycle's prune removes it.
busy() {
  echo "[run-cycle] another run holds the lock on $1 — aborting" >&2
  if [[ -d "$RUN_DIR" ]]; then phase "aborted-locked"; own_like "$WEBROOT" "$RUN_DIR"; fi
  exit 1
}

mkdir -p "$WEBROOT"
# A directory can only be opened read-only; flock does not need more.
if [[ -d "$LOCK" ]]; then exec 9<"$LOCK"; else exec 9>>"$LOCK"; fi \
  || { echo "[run-cycle] cannot open lock $LOCK" >&2; exit 2; }
flock -n 9 || busy "$LOCK"
if [[ ! "$REPO_DIR" -ef "$LOCK" ]]; then
  exec 8<"$REPO_DIR" || { echo "[run-cycle] cannot open $REPO_DIR" >&2; exit 2; }
  flock -n 8 || busy "$REPO_DIR"
fi
# From here on this cycle owns the webroot: on every exit, success or not,
# hand what it wrote back to the owners (while it still holds the locks).
trap leave_owned EXIT
mkdir -p "$RUN_DIR"

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
# Feed the live on-box history/catalog so the rolling history (30 runs)
# accumulates across button presses instead of resetting each run. RUN_LIMIT
# tells it which runs keep a report after the prune below (`hasReport`).
env BRANCH="$BRANCH" BASE_URL="${BASE_URL:-}" GIT_SHA="$(cat .git-sha)" RUN_LIMIT="$RUN_LIMIT" \
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

# The prune below follows the published history.json, so a run that could not
# publish it must not prune: it would delete its own folder.
if ! cp -f catalog.json history.json "$WEBROOT/"; then
  echo "[run-cycle] could not publish catalog.json/history.json to $WEBROOT — not pruning" >&2
  phase "failed-publish"
  exit 8
fi
# Copy run artifacts in alongside the daemon-written run.log (don't wipe the dir).
cp -f report.json "$RUN_DIR/" 2>/dev/null || true
rsync -a --delete --exclude=run.log --exclude=phase \
  playwright-report "$RUN_DIR/" 2>/dev/null \
  || cp -rf playwright-report "$RUN_DIR/"
rsync -a --delete test-results "$RUN_DIR/" 2>/dev/null \
  || cp -rf test-results "$RUN_DIR/"

# prune_run <id>: delete runs/<id>/, and say so in run.log if any of it stays.
prune_run() {
  local err
  err="$(rm -rf -- "$WEBROOT/runs/$1" 2>&1)"
  if [[ -e "$WEBROOT/runs/$1" ]]; then
    echo "[run-cycle] could not prune runs/$1 (owner $(stat -c %U "$WEBROOT/runs/$1" 2>/dev/null || echo ?), this run is $(id -un 2>/dev/null || id -u)): ${err%%$'\n'*}" >&2
  fi
}

# Prune runs/ to exactly the set the dashboard links into — the runs in the
# history.json we just published that still have a report (`hasReport` not
# false: the newest RUN_LIMIT runs whose folder existed). Older runs stay in
# history with their results, but their folder goes. This keeps runs/ in
# lockstep with the catalog: a failed-no-report run creates a runs/<id>/ folder
# but never a catalog entry, and the old mtime-based prune ("newest RUN_LIMIT
# folders") let those newer-but-reportless folders evict the runs the catalog
# still pointed at — so the dashboard showed a stale "last run" and 404'd on it
# (#907 skew). build-catalog decided `hasReport` from what is on disk, so
# honouring that set here converges disk == catalog. Falls back to the recency
# prune if the ids can't be read (missing/old node, malformed json).
KEEP_IDS="$(node -e 'const fs=require("fs");try{const h=JSON.parse(fs.readFileSync(process.argv[1],"utf8"));process.stdout.write((h.runs||[]).filter(r=>r.hasReport!==false).map(r=>r.id).join("\n"))}catch(e){}' "$WEBROOT/history.json" 2>/dev/null)"
if [[ -n "$KEEP_IDS" ]]; then
  shopt -s nullglob
  for d in "$WEBROOT"/runs/*/; do
    id="$(basename "$d")"
    grep -qxF -- "$id" <<<"$KEEP_IDS" || prune_run "$id"
  done
  shopt -u nullglob
else
  while IFS= read -r id; do prune_run "$id"; done \
    < <(cd "$WEBROOT/runs" 2>/dev/null && ls -1t | tail -n +"$((RUN_LIMIT+1))")
fi

phase "done"
echo "[run-cycle] done — RUN_ID=$RUN_ID"
