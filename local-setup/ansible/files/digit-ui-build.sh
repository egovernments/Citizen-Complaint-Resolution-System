#!/usr/bin/env bash
# digit-ui-build.sh — clone + build the digit-ui-esbuild SPA from source.
#
# Mirror of configurator-build.sh / mcp-build.sh, for digit-ui. Invoked by the
# playbook when `build_digit_ui: true`. Builds the SPA bundle from source so the
# deploy serves a freshly-built UI instead of a pinned (often stale) container
# image. The built build/ is mounted over the digit-ui container's web root via
# the docker-compose.digit-ui-build.yml overlay.
#
# Usage: digit-ui-build.sh <repo_dir> <repo_url> <git_ref>
#   prints the build/ path on the last line (the playbook captures it).
set -uo pipefail

REPO_DIR="$1"; REPO_URL="$2"; REF="${3:-main}"

command -v node >/dev/null 2>&1 || { echo "ERROR: node not on PATH" >&2; exit 1; }
NODE_MAJOR="$(node -p 'process.versions.node.split(".")[0]' 2>/dev/null || echo 0)"
if [ "${NODE_MAJOR:-0}" -lt 20 ]; then
  echo "ERROR: node >= 20 required for the esbuild build (have $(node -v 2>/dev/null))" >&2
  exit 1
fi

# repo_url "-" = VENDORED: source already in the tree (CCRS digit-ui-esbuild/);
# build it in place, no clone. Monorepo path — digit-ui-esbuild upstream retired
# into CCRS. A real URL still clones (transitional/standalone).
if [ "$REPO_URL" = "-" ]; then
  echo "digit-ui-build: vendored source — building in place at $REPO_DIR" >&2
  [ -f "$REPO_DIR/package.json" ] || { echo "ERROR: no package.json at vendored $REPO_DIR" >&2; exit 2; }
elif [ -d "$REPO_DIR/.git" ]; then
  echo "digit-ui-build: updating $REPO_DIR → $REF" >&2
  git -C "$REPO_DIR" fetch origin --quiet
  git -C "$REPO_DIR" checkout "$REF" --quiet 2>/dev/null || git -C "$REPO_DIR" checkout -q "origin/$REF"
  git -C "$REPO_DIR" pull --ff-only --quiet 2>/dev/null || true
else
  echo "digit-ui-build: cloning $REPO_URL ($REF) → $REPO_DIR" >&2
  git clone --quiet --branch "$REF" --single-branch "$REPO_URL" "$REPO_DIR" 2>/dev/null \
    || git clone --quiet "$REPO_URL" "$REPO_DIR"
fi

cd "$REPO_DIR" || { echo "ERROR: cannot cd $REPO_DIR" >&2; exit 2; }

# Install deps when stale (package.json/lock newer than node_modules, or absent).
if [ ! -d node_modules ] || [ package.json -nt node_modules ] || [ package-lock.json -nt node_modules ]; then
  echo "digit-ui-build: npm install --legacy-peer-deps" >&2
  npm install --legacy-peer-deps >&2
fi

# Build. ALWAYS `npm run build` — its `prebuild` lifecycle runs
# scripts/vendor-digit-ui-css.js, which a bare `node esbuild.build.js` skips,
# producing a broken bundle. (Burned on Bomet; never use bare esbuild.build.js.)
echo "digit-ui-build: npm run build" >&2
npm run build >&2

[ -f build/index.html ] || { echo "ERROR: build/index.html missing after build" >&2; exit 3; }
# Last line = the build dir (captured by the playbook).
echo "$REPO_DIR/build"
