#!/bin/bash
# Fast local build + deploy to running digit-ui container
# Usage: ./dev-build.sh
# Build: ~3s, Deploy: ~1s, Total: ~4s

set -e

CONTAINER_NAME="digit-ui"
DEPLOY_PATH="/var/web/digit-ui"

echo "=== Building with esbuild ==="
rm -rf build
node esbuild.build.js 2>&1 | grep -E "esbuild done|ERROR"

if [ $? -ne 0 ]; then
  echo "Build failed!"
  exit 1
fi

echo "=== Deploying to container ==="
docker cp build/. "${CONTAINER_NAME}:${DEPLOY_PATH}/"
echo "=== Done! Reload browser to see changes ==="
