#!/usr/bin/env bash
# deploy-pilot-fe.sh — one-shot build + deploy of both frontends on the pilot
# server. Run ON the server (e.g. `ssh cms-ansible-pilot 'bash ~/Citizen-Complaint-Resolution-System/local-setup/scripts/deploy-pilot-fe.sh'`).
#
# Replaces the manual runbook:
#   0. git checkout release-v2.12-moz && git pull  (confirm merged PRs)
#   A. digit-ui (esbuild): rsync repo → /opt/digit-ui-esbuild, npm ci, build
#      with the server's globalConfigs.js, tar the bundle into the digit-ui
#      container (keeping the container's own globalConfigs.js / sso html)
#   B. configurator: configurator-build.sh in vendored mode, rsync dist/ to
#      the host-nginx docroot
#
# Usage:
#   deploy-pilot-fe.sh [target] [branch] [--no-pull]
#     target: all (default) | ui | configurator
#     branch: any bare argument that isn't a target is taken as the branch to
#             checkout+pull+deploy (default: release-v2.12-moz).
#             `--branch <name>` works too.
#     --no-pull   deploy whatever is currently checked out
#
#   examples:
#     deploy-pilot-fe.sh                          # release-v2.12-moz, both FEs
#     deploy-pilot-fe.sh ui fix/my-hotfix         # hotfix branch, digit-ui only
#     deploy-pilot-fe.sh feat/testing-tenant-flag # feature branch, both FEs
#
# ⚠️ The digit-ui copy is ephemeral: if the digit-ui container is recreated
#    (compose up / image redeploy) it reverts to the baked build — re-run
#    `deploy-pilot-fe.sh ui --no-pull`.

set -euo pipefail

REPO="${REPO:-$HOME/Citizen-Complaint-Resolution-System}"
BRANCH="release-v2.12-moz"
UI_BUILD_DIR="${UI_BUILD_DIR:-/opt/digit-ui-esbuild}"
GLOBAL_CONFIGS="${GLOBAL_CONFIGS:-/opt/digit/nginx/globalConfigs.js}"
CONF_WWW="${CONF_WWW:-/var/www/configurator}"

TARGET=all DO_PULL=1
while [ $# -gt 0 ]; do
  case "$1" in
    all|ui|configurator) TARGET="$1" ;;
    --no-pull) DO_PULL=0 ;;
    --branch)  BRANCH="$2"; shift ;;
    -h|--help) sed -n '2,29p' "$0"; exit 0 ;;
    -*) echo "unknown flag: $1 (try --help)" >&2; exit 1 ;;
    *) BRANCH="$1" ;;  # bare non-target arg = branch name to deploy
  esac
  shift
done

log() { echo -e "\n[deploy-pilot-fe] $*"; }

# ---------- 0. pull ----------
if [ "$DO_PULL" = 1 ]; then
  log "pulling $BRANCH in $REPO"
  git -C "$REPO" fetch origin "$BRANCH"   # so brand-new remote branches are checkout-able
  git -C "$REPO" checkout "$BRANCH"
  git -C "$REPO" pull --ff-only
  log "HEAD is now:"
  git -C "$REPO" log --oneline -3

  # the executed copy usually lives in ~ (outside the repo); warn when the
  # freshly-pulled repo version differs so the operator refreshes it
  if ! cmp -s "$0" "$REPO/local-setup/scripts/deploy-pilot-fe.sh"; then
    log "NOTE: the repo has a newer deploy-pilot-fe.sh than the copy you are running."
    log "      refresh it after this run: cp $REPO/local-setup/scripts/deploy-pilot-fe.sh ~/"
  fi
fi

# ---------- A. digit-ui (esbuild) ----------
deploy_ui() {
  log "=== digit-ui (esbuild) ==="

  # node 20 gate — the esbuild build needs v20.x. If the default node isn't
  # v20, auto-pick one: $NODE20_BIN (a .../bin dir) first, then the newest
  # nvm-installed v20.
  case "$(node -v 2>/dev/null || true)" in
    v20.*) ;;
    *)
      local N20="${NODE20_BIN:-}"
      [ -n "$N20" ] || N20="$(ls -d "$HOME"/.nvm/versions/node/v20.*/bin 2>/dev/null | sort -V | tail -1 || true)"
      if [ -n "$N20" ] && [ -x "$N20/node" ]; then
        export PATH="$N20:$PATH"
        log "default node is not v20 → using $N20 ($(node -v))"
      fi
      case "$(node -v 2>/dev/null || true)" in v20.*) ;; *)
        echo "ERROR: node is $(node -v 2>/dev/null || echo missing), need v20.x." >&2
        echo "       Install one ('nvm install 20') or point NODE20_BIN at a v20 bin dir." >&2
        exit 1 ;;
      esac ;;
  esac

  [ -f "$GLOBAL_CONFIGS" ] || { echo "ERROR: $GLOBAL_CONFIGS not found" >&2; exit 1; }
  docker ps --format '{{.Names}}' | grep -qx digit-ui \
    || { echo "ERROR: digit-ui container is not running" >&2; exit 1; }

  log "syncing source into $UI_BUILD_DIR (no --delete, keeps node_modules)"
  sudo rsync -a "$REPO/digit-ui-esbuild/" "$UI_BUILD_DIR/"
  sudo chown -R "$USER:$USER" "$UI_BUILD_DIR"

  cd "$UI_BUILD_DIR"

  # npm ci only when the lockfile changed since the last successful ci —
  # saves ~minutes on the usual code-only deploy
  local STAMP=node_modules/.deploy-lock-hash
  local HASH; HASH="$(md5sum package-lock.json | cut -d' ' -f1)"
  if [ ! -d node_modules ] || [ "$(cat "$STAMP" 2>/dev/null)" != "$HASH" ]; then
    log "lockfile changed (or first run) → npm ci --legacy-peer-deps"
    npm ci --legacy-peer-deps
    echo "$HASH" > "$STAMP"
  else
    log "lockfile unchanged → skipping npm ci"
  fi

  log "building with server runtime config ($GLOBAL_CONFIGS)"
  GLOBAL_CONFIGS="$GLOBAL_CONFIGS" node esbuild.build.js

  log "copying bundle into the digit-ui container (keeping its config files)"
  tar -C build --exclude=globalConfigs.js --exclude=silent-check-sso.html -cf - . \
    | sudo docker exec -i digit-ui tar -C /var/web/digit-ui -xf -

  log "verify: Last-Modified of /digit-ui/index.js (expect today)"
  local LM; LM="$(curl -sI http://localhost/digit-ui/index.js | tr -d '\r' | grep -i '^last-modified' || true)"
  echo "  $LM"
  echo "$LM" | grep -q "$(date -u '+%d %b %Y')" \
    || { echo "ERROR: index.js Last-Modified is not today — deploy did not land" >&2; exit 1; }
  log "digit-ui OK (no restart needed; note: reverts if the container is recreated)"
}

# ---------- B. configurator ----------
deploy_configurator() {
  log "=== configurator ==="

  log "fixing ownership (dist/ + node_modules can be root-owned from past runs)"
  sudo chown -R "$USER:$USER" "$REPO/configurator"

  # VITE_STATE_TENANT_ID is baked into the SPA login screen; the manual runbook
  # forgot it (configurator-build.sh warns → login tenant pre-fill regresses).
  # Pull it from the server's globalConfigs.js, overridable via env.
  if [ -z "${VITE_STATE_TENANT_ID:-}" ] && [ -f "$GLOBAL_CONFIGS" ]; then
    VITE_STATE_TENANT_ID="$(grep -oP "stateTenantId['\"]?\s*[:=]\s*['\"]\K[a-z.]+" "$GLOBAL_CONFIGS" | head -1 || true)"
  fi
  export VITE_STATE_TENANT_ID="${VITE_STATE_TENANT_ID:-mz}"
  log "building (vendored mode, VITE_STATE_TENANT_ID=$VITE_STATE_TENANT_ID)"
  bash "$REPO/local-setup/ansible/files/configurator-build.sh" "$REPO/configurator" - ""

  log "publishing dist/ → $CONF_WWW"
  sudo rsync -a --delete "$REPO/configurator/dist/" "$CONF_WWW/"

  local CODE; CODE="$(curl -s -o /dev/null -w '%{http_code}' http://localhost/configurator/)"
  log "verify: /configurator/ → HTTP $CODE"
  [ "$CODE" = 200 ] || { echo "ERROR: configurator returned HTTP $CODE" >&2; exit 1; }
  log "configurator OK (static behind host nginx, served immediately)"
}

case "$TARGET" in
  ui)           deploy_ui ;;
  configurator) deploy_configurator ;;
  all)          deploy_ui; deploy_configurator ;;
esac

log "DONE ($TARGET)"
