#!/usr/bin/env bash
#
# nightly-build-push.sh — build the high-churn CCRS services from the current
# `develop` checkout and push them to the configured registry under a rolling
# `nightly-develop` tag (+ an immutable `develop-YYYYMMDD` tag for rollback).
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
# Exit:   0 only if every target built+pushed; non-zero if any failed (caller
#         decides whether to proceed — the wrapper continues with prior tags).

set -uo pipefail

REPO_DIR="${REPO_DIR:-/opt/ccrs}"
REGISTRY="${NIGHTLY_PUSH_REGISTRY:?set NIGHTLY_PUSH_REGISTRY, e.g. registry-host:5000/egovio}"
ROLLING="nightly-develop"
DATE_TAG="develop-$(date -u +%Y%m%d)"
MAVEN_DOCKERFILE="build/maven/Dockerfile"

cd "$REPO_DIR" || { echo "FATAL: cannot cd $REPO_DIR" >&2; exit 2; }

log() { echo "[nightly-build $(date -u +%H:%M:%S)] $*"; }
declare -a OK=() FAIL=()

# push_two <image-name> — tag the freshly-built <image>:staging as the rolling
# and dated tags and push both. Returns non-zero on any push failure.
push_two() {
  local img="$1" r
  for tag in "$ROLLING" "$DATE_TAG"; do
    docker tag "$img:staging" "$REGISTRY/$img:$tag" || return 1
    docker push "$REGISTRY/$img:$tag" || return 1
  done
}

# maven_svc <image-name> <work-dir> — Spring Boot services built via the shared
# build/maven/Dockerfile (repo-root context + WORK_DIR arg).
maven_svc() {
  local img="$1" wd="$2"
  log "build $img (maven, WORK_DIR=$wd)"
  if docker build --build-arg WORK_DIR="$wd" -f "$MAVEN_DOCKERFILE" -t "$img:staging" . && push_two "$img"; then
    OK+=("$img"); log "  -> $img pushed ($ROLLING, $DATE_TAG)"
  else
    FAIL+=("$img"); log "  -> $img FAILED"
  fi
}

# node_svc <image-name> <context-dir> — Node services with a self-contained
# Dockerfile that assumes its own directory as the build context.
node_svc() {
  local img="$1" ctx="$2"
  log "build $img (node, ctx=$ctx)"
  if docker build -t "$img:staging" "$ctx" && push_two "$img"; then
    OK+=("$img"); log "  -> $img pushed ($ROLLING, $DATE_TAG)"
  else
    FAIL+=("$img"); log "  -> $img FAILED"
  fi
}

log "registry=$REGISTRY  tags=$ROLLING,$DATE_TAG  repo=$REPO_DIR"

# --- target set: high-churn, container-served services (runtime-configured,
# so one image serves every tenant). UIs are handled separately (their bundles
# bake tenant build-env). pgr published as pgr-services-dev to match the
# deployer's existing image reference.
maven_svc pgr-services-dev      backend/pgr-services
maven_svc default-data-handler  utilities/default-data-handler
node_svc  digit-mcp             digit-mcp
node_svc  otp-publisher         utilities/otp-publisher

log "DONE — OK: ${OK[*]:-none} | FAILED: ${FAIL[*]:-none}"
[ ${#FAIL[@]} -eq 0 ]
