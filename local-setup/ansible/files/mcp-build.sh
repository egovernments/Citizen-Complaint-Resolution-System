#!/usr/bin/env bash
# mcp-build.sh — clone + build the DIGIT-MCP image locally.
#
# Mirror of configurator-build.sh, for MCP. Invoked by the playbook when
# `build_mcp: true`. Builds the image from source and tags it with the
# image ref the compose .env references (MCP_IMAGE), so the deploy uses a
# locally-built image instead of pulling from a registry — no GHCR / VPC
# dependency. (DIGIT-MCP is node:22-alpine; cross-builds trivially.)
#
# Usage: mcp-build.sh <repo_dir> <repo_url> <git_ref> <image_tag> [platform]
#   prints the image tag on the last line (the playbook captures it).
set -uo pipefail

REPO_DIR="$1"; REPO_URL="$2"; REF="${3:-main}"; TAG="$4"; PLATFORM="${5:-}"

command -v docker >/dev/null 2>&1 || { echo "ERROR: docker not on PATH" >&2; exit 1; }

if [ -d "$REPO_DIR/.git" ]; then
  echo "mcp-build: updating $REPO_DIR → $REF" >&2
  git -C "$REPO_DIR" fetch origin --quiet
  git -C "$REPO_DIR" checkout "$REF" --quiet 2>/dev/null || git -C "$REPO_DIR" checkout -q "origin/$REF"
  git -C "$REPO_DIR" pull --ff-only --quiet 2>/dev/null || true
else
  echo "mcp-build: cloning $REPO_URL ($REF) → $REPO_DIR" >&2
  git clone --quiet --branch "$REF" --single-branch "$REPO_URL" "$REPO_DIR" 2>/dev/null \
    || git clone --quiet "$REPO_URL" "$REPO_DIR"
fi

cd "$REPO_DIR" || { echo "ERROR: cannot cd $REPO_DIR" >&2; exit 2; }

# Build for the target platform. On Apple-Silicon the rest of the stack runs
# amd64 under Rosetta (docker_default_platform); MCP is lightweight Node so
# amd64-under-Rosetta is fine and keeps one platform across the stack. On Linux
# leave PLATFORM empty → native host arch.
echo "mcp-build: docker build -t $TAG ${PLATFORM:+--platform $PLATFORM}" >&2
if [ -n "$PLATFORM" ]; then
  docker buildx build --platform "$PLATFORM" -t "$TAG" --load . >&2
else
  docker build -t "$TAG" . >&2
fi

docker image inspect "$TAG" >/dev/null 2>&1 || { echo "ERROR: image $TAG not present after build" >&2; exit 3; }
# Last line = the image tag (captured by the playbook).
echo "$TAG"
