#!/usr/bin/env bash
#
# nightly-build-push.sh — build EVERY CCRS-owned container image from the current
# `develop` checkout and push it to the configured registry under a rolling
# `nightly-develop` tag (+ an immutable `develop-YYYYMMDD` tag for rollback).
#
# The build set is NOT hard-coded here: it is parsed from build/build-config.yml,
# the same manifest CI consumes. Add a service there and it is built nightly.
# Naming/tag governance lives in build/NIGHTLY-BUILDS.md — read that first.
#
# DIGIT core platform services (egov-*, kong, boundary-service, mdms-v2, …) are
# NOT in this repo and NOT built here; they come from the Digit-Core nightly.
#
# Intended to run on a box that (a) has the develop source, (b) has docker with
# the push registry trusted (insecure-registries for an HTTP VPC registry), and
# (c) can reach that registry. On bomet it's invoked by the nightly redeploy
# wrapper AFTER the develop sync and BEFORE the converge, so the nightly
# self-builds what it then deploys. amd64-only (deploy targets are linux/amd64).
#
# The push registry is taken from $NIGHTLY_PUSH_REGISTRY (e.g. host:5000/egovio)
# and is intentionally NOT hard-coded here — set it in the on-box cron/env so the
# internal address never lands in the public repo. Pull-side config (the public
# proxy) lives in the compose/host_vars, not here.
#
# Usage:  NIGHTLY_PUSH_REGISTRY=<host:port>/egovio  [REPO_DIR=/opt/ccrs]  nightly-build-push.sh
#   NIGHTLY_ONLY="img1 img2"   build only these canonical image names
#   NIGHTLY_SKIP="img1 img2"   build everything except these
# Exit:   0 only if every target built+pushed; non-zero if any failed (caller
#         decides whether to proceed — the wrapper continues with prior tags).

set -uo pipefail

REPO_DIR="${REPO_DIR:-/opt/ccrs}"
REGISTRY="${NIGHTLY_PUSH_REGISTRY:?set NIGHTLY_PUSH_REGISTRY, e.g. registry-host:5000/egovio}"
ROLLING="nightly-develop"
DATE_TAG="develop-$(date -u +%Y%m%d)"
MAVEN_DOCKERFILE="build/maven/Dockerfile"
BUILD_CONFIG="build/build-config.yml"
NIGHTLY_ONLY="${NIGHTLY_ONLY:-}"
NIGHTLY_SKIP="${NIGHTLY_SKIP:-}"

cd "$REPO_DIR" || { echo "FATAL: cannot cd $REPO_DIR" >&2; exit 2; }
[ -f "$BUILD_CONFIG" ] || { echo "FATAL: $BUILD_CONFIG not found under $REPO_DIR" >&2; exit 2; }
command -v python3 >/dev/null || { echo "FATAL: python3 required to parse $BUILD_CONFIG" >&2; exit 2; }
python3 -c 'import yaml' 2>/dev/null || { echo "FATAL: python3 'yaml' module (PyYAML) required to parse $BUILD_CONFIG" >&2; exit 2; }

log() { echo "[nightly-build $(date -u +%H:%M:%S)] $*"; }
declare -a OK=() FAIL=() SKIP=()

# Flatten build-config.yml into TAB-separated rows: <image-name> <work-dir>
# <dockerfile|-> <mode:maven|plain>. mode=maven iff the entry uses the shared
# build/maven/Dockerfile (repo-root context + WORK_DIR arg); everything else is
# a plain build (context = work-dir).
read_targets() {
  python3 - "$BUILD_CONFIG" "$MAVEN_DOCKERFILE" <<'PY'
import sys, yaml
cfg_path, maven_df = sys.argv[1], sys.argv[2]
with open(cfg_path) as f:
    cfg = yaml.safe_load(f) or {}
for entry in (cfg.get("config") or []):
    for b in (entry.get("build") or []):
        img = (b.get("image-name") or "").strip()
        wd  = (b.get("work-dir") or "").strip()
        df  = (b.get("dockerfile") or "").strip()
        if not img or not wd:
            continue
        mode = "maven" if df.endswith(maven_df) else "plain"
        print("\t".join([img, wd, df or "-", mode]))
PY
}

# push_two <image-name> — tag the freshly-built <image>:staging as the rolling
# and dated tags and push both. Returns non-zero on any push failure.
push_two() {
  local img="$1"
  for tag in "$ROLLING" "$DATE_TAG"; do
    docker tag "$img:staging" "$REGISTRY/$img:$tag" || return 1
    docker push "$REGISTRY/$img:$tag" || return 1
  done
}

# build_one <image-name> <work-dir> <dockerfile|-> <mode> — build per mode and,
# on success, push the rolling + dated tags. Records OK/FAIL.
build_one() {
  local img="$1" wd="$2" df="$3" mode="$4"
  local -a build_cmd
  if [ "$mode" = "maven" ]; then
    log "build $img (maven, WORK_DIR=$wd)"
    build_cmd=(docker build --build-arg WORK_DIR="$wd" -f "$MAVEN_DOCKERFILE" -t "$img:staging" .)
  elif [ "$df" != "-" ]; then
    log "build $img (plain, ctx=$wd, -f $df)"
    build_cmd=(docker build -f "$df" -t "$img:staging" "$wd")
  else
    log "build $img (plain, ctx=$wd)"
    build_cmd=(docker build -t "$img:staging" "$wd")
  fi
  if "${build_cmd[@]}" && push_two "$img"; then
    OK+=("$img"); log "  -> $img pushed ($ROLLING, $DATE_TAG)"
  else
    FAIL+=("$img"); log "  -> $img FAILED"
  fi
}

# selected <image-name> — honour NIGHTLY_ONLY / NIGHTLY_SKIP allow/deny lists.
# Exact whitespace-delimited token match (NOT grep -w: a hyphen is a grep word
# boundary, so `grep -w pgr-services` spuriously matches "pgr-services-db").
selected() {
  local img="$1"
  if [ -n "$NIGHTLY_ONLY" ] && [[ " $NIGHTLY_ONLY " != *" $img "* ]]; then return 1; fi
  if [ -n "$NIGHTLY_SKIP" ] && [[ " $NIGHTLY_SKIP " == *" $img "* ]]; then return 1; fi
  return 0
}

log "registry=$REGISTRY  tags=$ROLLING,$DATE_TAG  repo=$REPO_DIR"
[ -n "$NIGHTLY_ONLY" ] && log "ONLY: $NIGHTLY_ONLY"
[ -n "$NIGHTLY_SKIP" ] && log "SKIP: $NIGHTLY_SKIP"

# Parse the manifest up front so a parse error / empty manifest is a hard FATAL,
# not a silent exit-0-having-built-nothing. Read into an array in THIS shell (a
# read loop, not `mapfile` — portable to bash 3.2; the build runs the loop here
# so OK/FAIL survive).
ROWS=()
while IFS= read -r row; do ROWS+=("$row"); done < <(read_targets)
if [ ${#ROWS[@]} -eq 0 ]; then
  echo "FATAL: no build targets parsed from $BUILD_CONFIG (parse error or empty manifest)" >&2
  exit 2
fi

for row in "${ROWS[@]}"; do
  IFS=$'\t' read -r img wd df mode <<<"$row"
  [ -n "$img" ] || continue
  if selected "$img"; then
    build_one "$img" "$wd" "$df" "$mode"
  else
    SKIP+=("$img")
  fi
done

[ ${#SKIP[@]} -gt 0 ] && log "skipped: ${SKIP[*]}"
# Guard against a NIGHTLY_ONLY typo (or all-skipped) building nothing yet exiting 0.
if [ $(( ${#OK[@]} + ${#FAIL[@]} )) -eq 0 ]; then
  echo "FATAL: nothing was built (NIGHTLY_ONLY/SKIP excluded every target?)" >&2
  exit 2
fi
log "DONE — OK: ${OK[*]:-none} | FAILED: ${FAIL[*]:-none}"
[ ${#FAIL[@]} -eq 0 ]
