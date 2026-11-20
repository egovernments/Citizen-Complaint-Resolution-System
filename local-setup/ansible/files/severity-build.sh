#!/usr/bin/env bash
# severity-build.sh — docker build the vendored severity-service image locally.
#
# Mirror of mcp-build.sh for severity-service. Invoked by the playbook when
# `enable_severity: true`. The source is always vendored (CCRS severity-service/,
# rsynced to the target), so there is no clone path. Only the runtime files are sent
# to the build (see the staging block below).
#
# Usage: severity-build.sh <repo_dir> <image_tag> [platform]
#   prints the image tag on the last line (the playbook captures it).
set -uo pipefail

REPO_DIR="$1"; TAG="$2"; PLATFORM="${3:-}"

command -v docker >/dev/null 2>&1 || { echo "ERROR: docker not on PATH" >&2; exit 1; }
[ -f "$REPO_DIR/Dockerfile" ] || { echo "ERROR: no Dockerfile at vendored $REPO_DIR" >&2; exit 2; }

# Build from a clean staging context holding ONLY what the runtime image needs, so a
# full severity-service/ folder (training data, labelling output, notebooks, .env,
# pickles, ...) is never sent to the Docker daemon or copied into the image. This
# mirrors the rsync excludes in the playbook and severity-service/.dockerignore.
# Allow-list: Dockerfile, .dockerignore, requirements.txt, app/*.py and the three
# model files the predictor loads (model/critical_rules.json and metrics.json are
# not read at runtime).
CTX="$(mktemp -d)" || { echo "ERROR: cannot create staging dir" >&2; exit 2; }
trap 'rm -rf "$CTX"' EXIT

for f in Dockerfile requirements.txt; do
  [ -f "$REPO_DIR/$f" ] || { echo "ERROR: $REPO_DIR/$f missing" >&2; exit 2; }
  cp "$REPO_DIR/$f" "$CTX/$f"
done
[ -f "$REPO_DIR/.dockerignore" ] && cp "$REPO_DIR/.dockerignore" "$CTX/.dockerignore"

[ -d "$REPO_DIR/app" ] || { echo "ERROR: $REPO_DIR/app missing" >&2; exit 2; }
mkdir -p "$CTX/app" "$CTX/model"
cp "$REPO_DIR"/app/*.py "$CTX/app/"
for f in severity_catboost.cbm label_map.json severity_predictor.py; do
  [ -f "$REPO_DIR/model/$f" ] || { echo "ERROR: $REPO_DIR/model/$f missing" >&2; exit 2; }
  cp "$REPO_DIR/model/$f" "$CTX/model/$f"
done

cd "$CTX" || { echo "ERROR: cannot cd $CTX" >&2; exit 2; }

# The Dockerfile downloads CPU torch + the MiniLM encoder (by its Hugging Face name,
# from model/label_map.json) at build time and bakes the HF cache into the image;
# the container then runs with HF_HUB_OFFLINE=1. Needs network on first build.
echo "severity-build: docker build -t $TAG ${PLATFORM:+--platform $PLATFORM} (context: $(du -sk . | cut -f1) KB)" >&2
if [ -n "$PLATFORM" ]; then
  docker buildx build --platform "$PLATFORM" -t "$TAG" --load . >&2
else
  docker build -t "$TAG" . >&2
fi

docker image inspect "$TAG" >/dev/null 2>&1 || { echo "ERROR: image $TAG not present after build" >&2; exit 3; }
# Last line = the image tag (captured by the playbook).
echo "$TAG"
