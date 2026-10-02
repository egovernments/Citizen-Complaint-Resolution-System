#!/usr/bin/env bash
# Run the screenshot suite the way CI runs it.
#
# Baselines must be rasterized by the same fonts and the same Chromium build as
# the CI runner, so this drives the pinned Playwright container on linux/amd64
# rather than the host. The container installs its own node_modules (the host's
# are built for the host's platform) into an anonymous volume, so nothing on
# the host is touched.
#
#   scripts/screenshots.sh                       compare against the baselines
#   scripts/screenshots.sh --update-snapshots    re-record them
set -euo pipefail

cd "$(dirname "$0")/.."
repo_root=$(cd ../../../.. && pwd)
theme_dir=backend/identity-bff/keycloak/theme-src
image="mcr.microsoft.com/playwright:v$(node -p "require('./scripts/playwright-version.cjs')")-noble"

exec docker run --rm --init --platform linux/amd64 \
    -v "$repo_root":/work \
    -v "/work/$theme_dir/node_modules" \
    -w "/work/$theme_dir" \
    -e CI=1 -e HOME=/tmp -e npm_config_cache=/tmp/.npm \
    "$image" \
    bash -lc "npm ci --no-audit --no-fund && npx playwright test $*"
