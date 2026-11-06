#!/usr/bin/env bash
# severity-build.sh — docker build the vendored severity-service image locally.
#
# Mirror of mcp-build.sh for severity-service. Invoked by the playbook when
# `enable_severity: true`. The source is always vendored (CCRS severity-service/,
# rsynced to the target), so there is no clone path.
#
# Usage: severity-build.sh <repo_dir> <image_tag> [platform]
#   prints the image tag on the last line (the playbook captures it).
set -uo pipefail

REPO_DIR="$1"; TAG="$2"; PLATFORM="${3:-}"

command -v docker >/dev/null 2>&1 || { echo "ERROR: docker not on PATH" >&2; exit 1; }
[ -f "$REPO_DIR/Dockerfile" ] || { echo "ERROR: no Dockerfile at vendored $REPO_DIR" >&2; exit 2; }

cd "$REPO_DIR" || { echo "ERROR: cannot cd $REPO_DIR" >&2; exit 2; }

# The Dockerfile downloads CPU torch + the MiniLM encoder at build time (baked
# into the image, so nothing is fetched at runtime). Needs network on first build.
echo "severity-build: docker build -t $TAG ${PLATFORM:+--platform $PLATFORM}" >&2
if [ -n "$PLATFORM" ]; then
  docker buildx build --platform "$PLATFORM" -t "$TAG" --load . >&2
else
  docker build -t "$TAG" . >&2
fi

docker image inspect "$TAG" >/dev/null 2>&1 || { echo "ERROR: image $TAG not present after build" >&2; exit 3; }
# Last line = the image tag (captured by the playbook).
echo "$TAG"
