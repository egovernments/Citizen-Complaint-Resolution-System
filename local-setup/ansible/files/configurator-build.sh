#!/usr/bin/env bash
# configurator-build.sh — clone + build the digit-configurator SPA dist.
#
# Invoked by the playbook when `build_configurator: true`. Produces a static
# dist/ the playbook then syncs to {{ configurator_www_dir }} (host nginx on
# Linux, the digit-nginx container bind-mount on macOS). Same recipe on both
# platforms — it's just node + vite.
#
# Usage: configurator-build.sh <repo_dir> <repo_url> <git_ref>
#   prints the absolute dist path on the last line (the playbook captures it).
#
# Why `vite build` directly (not the root `tsc -b && vite build`): root tsc -b
# has blocking app-level type errors upstream, but vite/esbuild emits a working
# SPA without type-checking. The file: sub-packages (e.g. data-provider) must
# be built first — their package.json `main` points at dist/ which npm install
# does NOT build.
set -uo pipefail

REPO_DIR="$1"; REPO_URL="$2"; REF="${3:-main}"
NEED_NODE="20.19.0"

command -v npm >/dev/null 2>&1 || { echo "ERROR: npm not on PATH (need Node >= $NEED_NODE)" >&2; exit 1; }
NV="$(node -v 2>/dev/null | sed 's/^v//')"
ver_ge(){ [ "$(printf '%s\n%s\n' "$2" "$1" | sort -t. -k1,1n -k2,2n -k3,3n | head -1)" = "$2" ]; }
ver_ge "$NV" "$NEED_NODE" || { echo "ERROR: node v$NV < $NEED_NODE (digit-configurator + Vite need it)" >&2; exit 1; }

# repo_url "-" = VENDORED: the source is already in the tree (CCRS configurator/);
# build it in place, no clone/checkout. This is the monorepo path — the digit-
# configurator upstream is being retired into CCRS. A real URL still clones (kept
# for transitional/standalone use).
if [ "$REPO_URL" = "-" ]; then
  echo "configurator-build: vendored source — building in place at $REPO_DIR" >&2
  [ -f "$REPO_DIR/package.json" ] || { echo "ERROR: no package.json at vendored $REPO_DIR" >&2; exit 2; }
elif [ -d "$REPO_DIR/.git" ]; then
  echo "configurator-build: updating $REPO_DIR → $REF" >&2
  git -C "$REPO_DIR" fetch origin --quiet
  git -C "$REPO_DIR" checkout "$REF" --quiet
  git -C "$REPO_DIR" pull --ff-only --quiet || true
else
  echo "configurator-build: cloning $REPO_URL → $REPO_DIR" >&2
  git clone --quiet --branch "$REF" --single-branch "$REPO_URL" "$REPO_DIR" 2>/dev/null \
    || git clone --quiet "$REPO_URL" "$REPO_DIR"
fi

cd "$REPO_DIR" || { echo "ERROR: cannot cd $REPO_DIR" >&2; exit 2; }

echo "configurator-build: npm ci (fallback npm install)" >&2
npm ci >/dev/null 2>&1 || npm install >/dev/null 2>&1

# Build any file: sub-package that has a build script (vite needs their dist/).
for sp in packages/*/; do
  [ -f "${sp}package.json" ] || continue
  hasbuild="$(node -p "(require('./${sp}package.json').scripts||{}).build||''" 2>/dev/null || true)"
  [ -n "$hasbuild" ] && { echo "configurator-build: sub-package $sp" >&2; ( cd "$sp" && npm run build >/dev/null 2>&1 ); }
done

echo "configurator-build: vite build --base=/configurator/" >&2
# Cap Node heap explicitly. On low-RAM repro envs (11GB ovh-cloud-dev) the
# default V8 heap budget plus the running docker stack ran the box out of
# memory mid-build, leaving the dist half-written and the host_vars
# `build_configurator: false` workaround in place (PR #644 cycle 4). 8192 MB
# is well under what a real production node can spare and is plenty for the
# current configurator bundle (~2.3 MB minified).
NODE_OPTIONS="${NODE_OPTIONS:---max-old-space-size=8192}" npx vite build --base=/configurator/ >&2

[ -f dist/index.html ] || { echo "ERROR: dist/index.html missing after build" >&2; exit 3; }
# Last line = the dist path (captured by the playbook).
echo "$REPO_DIR/dist"
