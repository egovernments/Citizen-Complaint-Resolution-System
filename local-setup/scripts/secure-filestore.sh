#!/usr/bin/env bash
# =============================================================================
# Secure the file store on an EXISTING, RUNNING DIGIT server (VAPT #223:
# "Insecure File Storage" — files downloadable without login by fileStoreId).
#
# Steps (each one idempotent; safe to run again):
#   minio      Bucket egov-rainmaker private. Only */pgr-landing/* (pictures
#              shown on the landing page before login) stays readable, and
#              nothing can be listed. Presigned links keep working.
#   filestore  Presigned links last 1 hour instead of 24 (compose env, then
#              egov-filestore is recreated).
#   nginx      403 on bucket-root listings; upload rate limit per client IP.
#   ui         (--build-ui) Rebuild digit-ui and the configurator from this
#              checkout and deploy them, the same way as a manual update:
#                digit-ui      rsync to /opt/digit-ui-esbuild, npm ci, esbuild,
#                              tar into the digit-ui container
#                configurator  sync to <digit-dir>/.build, configurator-build.sh,
#                              copy dist to the nginx alias dir (config.js kept)
#              Both are backed up first and checked for the new code.
#   kong       Filestore paths need a login (GET and multipart upload; token
#              from auth-token header, Authorization: Bearer or ?access_token).
#              Needs the new UI (it sends the token with photo requests): run
#              with --build-ui, or with --ui-ready if you deployed it yourself.
#              With the old UI, complaint photos break and users get logged out.
#
# Usage
#   sudo ./secure-filestore.sh --dry-run                 # show what would change
#   sudo ./secure-filestore.sh                           # minio + filestore + nginx
#   sudo ./secure-filestore.sh --build-ui                # everything: storage, new UI, kong
#   sudo ./secure-filestore.sh --ui-ready                # ... kong too (UI already updated)
#   sudo ./secure-filestore.sh --only kong --ui-ready    # one step
#   sudo ./secure-filestore.sh --rollback <backup-dir>   # restore config files
#
# Options
#   --build-ui            Rebuild + deploy digit-ui and configurator, then kong
#   --ui-ready            Apply the Kong step (you deployed the new UI yourself)
#   --only <list>         Comma list of steps: minio,filestore,nginx,ui,kong
#   --ui-work <dir>       digit-ui build workspace (default /opt/digit-ui-esbuild)
#   --global-configs <f>  globalConfigs.js for the UI build
#                         (default <digit-dir>/nginx/globalConfigs.js)
#   --configurator-dir <d> Where nginx serves the configurator from
#                         (default: the alias in the nginx site, else /var/www/configurator)
#   --digit-dir <dir>     DIGIT deploy dir (default: from the egov-filestore container)
#   --nginx-site <file>   Host nginx site to patch (repeatable; default: every
#                         enabled site with a `location /file-store/` block)
#   --url <base>          Base URL for the final checks (default http://localhost)
#   --dry-run             Check everything, change nothing
#   --yes                 Don't ask for confirmation
#   --rollback <dir>      Restore kong.yml / compose / nginx / UI files from a
#                         backup made by this script and restart what uses them. The bucket
#                         stays private unless you add --reopen-bucket.
#
# Backups: <digit-dir>/backup-vapt223-<timestamp>/ before anything is written.
# Needs: docker, python3, the egovio/mc image (already used by minio-init);
#        for --build-ui also node >= 20.19, npm and rsync.
# =============================================================================
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PATCH="$SCRIPT_DIR/secure_filestore_patch.py"
MC_IMAGE="egovio/mc:RELEASE.2024-01-16T16-06-34Z"

UI_READY=false
BUILD_UI=false
UI_WORK=/opt/digit-ui-esbuild
GLOBAL_CONFIGS=""
CONF_DIR=""
ONLY=""
DIGIT_DIR=""
NGINX_SITES=()
BASE_URL="http://localhost"
DRY_RUN=false
YES=false
ROLLBACK=""
REOPEN=false

if [ -t 1 ]; then B=$'\e[1m'; G=$'\e[32m'; Y=$'\e[33m'; R=$'\e[31m'; N=$'\e[0m'; else B= G= Y= R= N=; fi
step() { echo; echo "${B}==> $*${N}"; }
ok()   { echo "   ${G}[ OK ]${N} $*"; }
warn() { echo "   ${Y}[WARN]${N} $*"; }
fail() { echo "   ${R}[FAIL]${N} $*" >&2; exit 1; }
info() { echo "          $*"; }
usage() { sed -n '2,/^# ====/p' "$0" | sed '$d; s/^# \{0,1\}//'; exit "${1:-0}"; }

while [ $# -gt 0 ]; do
  case "$1" in
    --ui-ready) UI_READY=true; shift ;;
    --build-ui) BUILD_UI=true; shift ;;
    --ui-work) UI_WORK="$2"; shift 2 ;;
    --global-configs) GLOBAL_CONFIGS="$2"; shift 2 ;;
    --configurator-dir) CONF_DIR="$2"; shift 2 ;;
    --only) ONLY="$2"; shift 2 ;;
    --digit-dir) DIGIT_DIR="$2"; shift 2 ;;
    --nginx-site) NGINX_SITES+=("$2"); shift 2 ;;
    --url) BASE_URL="${2%/}"; shift 2 ;;
    --dry-run) DRY_RUN=true; shift ;;
    --yes|-y) YES=true; shift ;;
    --rollback) ROLLBACK="$2"; shift 2 ;;
    --reopen-bucket) REOPEN=true; shift ;;
    -h|--help) usage 0 ;;
    *) echo "unknown option: $1" >&2; usage 2 ;;
  esac
done

want() {
  if [ -z "$ONLY" ]; then
    case "$1" in
      ui) $BUILD_UI ;;
      kong) $UI_READY || $BUILD_UI ;;
      *) return 0 ;;
    esac
  else
    [[ ",$ONLY," == *",$1,"* ]]
  fi
}
confirm() {
  $YES && return 0
  [ -t 0 ] || fail "not a terminal; rerun with --yes to confirm"
  read -r -p "   $1 [y/N] " a
  [[ "$a" =~ ^[Yy]$ ]] || { echo "   Aborted. Nothing more was changed."; exit 1; }
}
label() { docker inspect -f "{{index .Config.Labels \"$2\"}}" "$1" 2>/dev/null; }
health() { docker inspect -f '{{.State.Status}}{{if .State.Health}}/{{.State.Health.Status}}{{end}}' "$1" 2>/dev/null || echo missing; }
wait_healthy() { # container, seconds
  local i s
  for ((i = 0; i < $2; i += 3)); do
    s=$(health "$1")
    case "$s" in running/healthy) return 0 ;; running) [ "$i" -ge 15 ] && return 0 ;; esac
    sleep 3
  done
  return 1
}
code() { curl -s -o /dev/null -m 15 -w '%{http_code}' "$@" || true; }

# ── 1. pre-flight ────────────────────────────────────────────────────────────
step "1. Pre-flight"
command -v docker >/dev/null && docker info >/dev/null 2>&1 || fail "cannot talk to Docker (run with sudo)"
command -v python3 >/dev/null || fail "python3 not found"
[ -f "$PATCH" ] || fail "missing $PATCH (run from a checkout of the repo)"
ok "Docker and python3"

FS=egov-filestore
[ "$(health $FS)" != missing ] || fail "container $FS not found"
PROJECT=$(label $FS com.docker.compose.project)
WORKDIR=$(label $FS com.docker.compose.project.working_dir)
IFS=, read -r -a COMPOSE_FILES <<<"$(label $FS com.docker.compose.project.config_files)"
DIGIT_DIR="${DIGIT_DIR:-$WORKDIR}"
[ -n "$PROJECT" ] && [ -d "$DIGIT_DIR" ] || fail "could not read the compose project from $FS (pass --digit-dir)"
ok "Compose project $PROJECT in $DIGIT_DIR"

COMPOSE_MAIN=""
for f in "${COMPOSE_FILES[@]}"; do grep -q '^  egov-filestore:' "$f" 2>/dev/null && grep -q 'minio-init:' "$f" && { COMPOSE_MAIN="$f"; break; }; done
[ -n "$COMPOSE_MAIN" ] || fail "no compose file defines both egov-filestore and minio-init"
ok "Compose file $COMPOSE_MAIN"

MINIO=$(docker ps --format '{{.Names}} {{.Image}}' | awk '$2 ~ /(^|\/)minio(:|$)/ {print $1; exit}')
[ -n "$MINIO" ] || fail "MinIO container not found"
NETWORK=$(docker inspect "$MINIO" --format '{{range $k,$v := .NetworkSettings.Networks}}{{$k}} {{end}}' | tr ' ' '\n' | grep -m1 . )
ok "MinIO $MINIO on $NETWORK"

KONG=$(docker ps --format '{{.Names}} {{.Image}}' | awk '$2 ~ /kong/ {print $1; exit}')
[ -n "$KONG" ] || fail "Kong container not found"
KONG_DEST=$(docker inspect "$KONG" --format '{{range .Mounts}}{{if eq .Destination "/kong/kong.yml"}}{{.Destination}}{{end}}{{end}}')
KONG_FILE=$(docker inspect "$KONG" --format '{{range .Mounts}}{{if eq .Destination "/kong/kong.yml"}}{{.Source}}{{end}}{{end}}')
[ -f "$KONG_FILE" ] || fail "Kong config file not found (expected a mount at /kong/kong.yml)"
ok "Kong $KONG using $KONG_FILE"

if [ ${#NGINX_SITES[@]} -eq 0 ] && [ -d /etc/nginx/sites-enabled ]; then
  for f in /etc/nginx/sites-enabled/*; do
    [ -f "$f" ] && grep -q 'location /file-store/' "$f" && NGINX_SITES+=("$(readlink -f "$f")")
  done
fi
if [ ${#NGINX_SITES[@]} -gt 0 ]; then ok "nginx site(s): ${NGINX_SITES[*]}"; else warn "no host nginx site with /file-store/ found; nginx step will be skipped"; fi

# UI build inputs (only checked when the ui step runs, or for a rollback).
REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
UI_SRC="$REPO_ROOT/digit-ui-esbuild"
CONF_SRC="$REPO_ROOT/configurator"
UI_CTR=digit-ui
UI_WEB=/var/web/digit-ui
GLOBAL_CONFIGS="${GLOBAL_CONFIGS:-$DIGIT_DIR/nginx/globalConfigs.js}"
if [ -z "$CONF_DIR" ]; then
  for f in "${NGINX_SITES[@]}" /etc/nginx/sites-enabled/*; do
    [ -f "$f" ] || continue
    CONF_DIR=$(sed -nE 's#^[[:space:]]*alias[[:space:]]+([^;]*/configurator/);#\1#p' "$f" | head -1)
    [ -n "$CONF_DIR" ] && break
  done
  CONF_DIR="${CONF_DIR:-/var/www/configurator/}"
fi
CONF_DIR="${CONF_DIR%/}"
if want ui && [ -z "$ROLLBACK" ]; then
  command -v node >/dev/null && command -v npm >/dev/null || fail "node/npm not found (needed for --build-ui)"
  NV=$(node -v | sed 's/^v//')
  [ "$(printf '%s\n%s\n' 20.19.0 "$NV" | sort -t. -k1,1n -k2,2n -k3,3n | head -1)" = 20.19.0 ] || fail "node v$NV is older than 20.19 (needed for --build-ui)"
  command -v rsync >/dev/null || fail "rsync not found (needed for --build-ui)"
  [ -f "$UI_SRC/esbuild.build.js" ] || fail "digit-ui source not found at $UI_SRC"
  [ -f "$CONF_SRC/package.json" ] && [ -d "$REPO_ROOT/ui-shared" ] || fail "configurator source not found at $CONF_SRC (+ ui-shared)"
  [ -f "$REPO_ROOT/local-setup/ansible/files/configurator-build.sh" ] || fail "configurator-build.sh not found"
  [ -f "$GLOBAL_CONFIGS" ] || fail "globalConfigs.js not found at $GLOBAL_CONFIGS (pass --global-configs)"
  docker exec "$UI_CTR" test -d "$UI_WEB" 2>/dev/null || fail "container $UI_CTR with $UI_WEB not found"
  [ -f "$CONF_DIR/index.html" ] || fail "configurator not found at $CONF_DIR (pass --configurator-dir)"
  STATE_TENANT=$(sed -nE 's/^[[:space:]]*var[[:space:]]+stateTenantId[[:space:]]*=[[:space:]]*["'"'"']([^"'"'"']+)["'"'"'].*/\1/p' "$GLOBAL_CONFIGS" | head -1)
  ok "UI build: node v$NV; digit-ui -> $UI_CTR:$UI_WEB; configurator -> $CONF_DIR; state tenant ${STATE_TENANT:-?}"
fi

# ── rollback ─────────────────────────────────────────────────────────────────
if [ -n "$ROLLBACK" ]; then
  step "Rollback from $ROLLBACK"
  [ -d "$ROLLBACK" ] || fail "no such backup dir"
  confirm "Restore the config files saved in $ROLLBACK and restart Kong / filestore / nginx?"
  $DRY_RUN && { info "dry run: nothing restored"; exit 0; }
  [ -f "$ROLLBACK/kong.yml" ] && cp -a "$ROLLBACK/kong.yml" "$KONG_FILE" && docker restart "$KONG" >/dev/null && wait_healthy "$KONG" 120 && ok "Kong restored"
  if [ -f "$ROLLBACK/$(basename "$COMPOSE_MAIN")" ]; then
    cp -a "$ROLLBACK/$(basename "$COMPOSE_MAIN")" "$COMPOSE_MAIN"
    (cd "$WORKDIR" && docker compose -p "$PROJECT" "${COMPOSE_FILES[@]/#/-f}" up -d --no-deps $FS >/dev/null 2>&1) && wait_healthy $FS 300 && ok "filestore restored"
  fi
  for f in "$ROLLBACK"/nginx-*; do
    [ -f "$f" ] || continue
    case "$f" in *.path) continue ;; esac
    dest=$(head -1 "$f.path"); cp -a "$f" "$dest"
  done
  ls "$ROLLBACK"/nginx-*.path >/dev/null 2>&1 && nginx -t >/dev/null 2>&1 && systemctl reload nginx && ok "nginx restored"
  if [ -f "$ROLLBACK/digit-ui.tar" ]; then
    docker exec -i "$UI_CTR" tar -C "$UI_WEB" -xf - <"$ROLLBACK/digit-ui.tar" && ok "digit-ui files restored"
  fi
  if [ -d "$ROLLBACK/configurator" ]; then
    rsync -a --delete "$ROLLBACK/configurator/" "$CONF_DIR/" && ok "configurator files restored"
  fi
  if $REOPEN; then
    docker run --rm --network "$NETWORK" --env-file <(docker inspect "$MINIO" --format '{{range .Config.Env}}{{println .}}{{end}}' | grep -E '^MINIO_ROOT_(USER|PASSWORD)=') \
      -e MC_CONFIG_DIR=/tmp/.mc --entrypoint sh "$MC_IMAGE" -ec \
      "mc alias set m http://$MINIO:9000 \"\$MINIO_ROOT_USER\" \"\$MINIO_ROOT_PASSWORD\" >/dev/null; mc anonymous set download m/egov-rainmaker" >/dev/null
    warn "bucket egov-rainmaker is PUBLIC again (--reopen-bucket)"
  fi
  exit 0
fi

# ── plan ─────────────────────────────────────────────────────────────────────
step "Plan"
for s in minio filestore nginx ui kong; do
  if want $s; then info "$(printf '%-10s' $s) apply"; else info "$(printf '%-10s' $s) skip"; fi
done
if ! want kong && [ -z "$ONLY" ]; then
  warn "Kong step skipped: rerun with --build-ui (or --ui-ready if the new UI is already deployed)"
fi
if want kong && ! $UI_READY && ! want ui; then
  fail "the kong step needs the new UI: add --build-ui, or --ui-ready if you deployed it yourself"
fi
$DRY_RUN && warn "DRY RUN: nothing will be changed"
confirm "Proceed?"

BACKUP="$DIGIT_DIR/backup-vapt223-$(date +%Y%m%d%H%M%S)"
backup() { $DRY_RUN && return 0; mkdir -p "$BACKUP"; cp -a "$1" "$BACKUP/${2:-$(basename "$1")}"; }

# Runs the patcher; prints the result; returns 0 changed, 10 already, else fails.
run_patch() { # kind file [args]
  local out rc
  if $DRY_RUN; then out=$(python3 "$PATCH" check "$@") && rc=0 || rc=$?
  else out=$(python3 "$PATCH" "$@") && rc=0 || rc=$?; fi
  case $rc in
    0) if $DRY_RUN; then ok "$2: would be $out"; else ok "$2: $out"; fi ;;
    10) ok "$2: $out" ;;
    *) fail "$2: $out — not changed" ;;
  esac
  return $rc
}

# ── 2. MinIO ─────────────────────────────────────────────────────────────────
if want minio; then
  step "2. MinIO bucket policy"
  CUR=$(docker run --rm --network "$NETWORK" --env-file <(docker inspect "$MINIO" --format '{{range .Config.Env}}{{println .}}{{end}}' | grep -E '^MINIO_ROOT_(USER|PASSWORD)=') \
    -e MC_CONFIG_DIR=/tmp/.mc --entrypoint sh "$MC_IMAGE" -ec \
    "mc alias set m http://$MINIO:9000 \"\$MINIO_ROOT_USER\" \"\$MINIO_ROOT_PASSWORD\" >/dev/null; mc anonymous get-json m/egov-rainmaker" 2>&1) \
    || fail "could not read the bucket policy: $CUR"
  if grep -q 'pgr-landing' <<<"$CUR" && ! grep -q 'ListBucket' <<<"$CUR" && ! grep -q 'egov-rainmaker/\*"' <<<"$CUR"; then
    ok "already private (only pgr-landing/ public)"
  elif $DRY_RUN; then
    ok "would make egov-rainmaker private, pgr-landing/ public (now: $(tr -d '\n ' <<<"$CUR" | cut -c1-120))"
  else
    docker run --rm --network "$NETWORK" --env-file <(docker inspect "$MINIO" --format '{{range .Config.Env}}{{println .}}{{end}}' | grep -E '^MINIO_ROOT_(USER|PASSWORD)=') \
      -e MC_CONFIG_DIR=/tmp/.mc --entrypoint sh "$MC_IMAGE" -ec "
      mc alias set m http://$MINIO:9000 \"\$MINIO_ROOT_USER\" \"\$MINIO_ROOT_PASSWORD\" >/dev/null
      mc anonymous set none m/egov-rainmaker >/dev/null
      echo '{\"Version\":\"2012-10-17\",\"Statement\":[{\"Effect\":\"Allow\",\"Principal\":{\"AWS\":[\"*\"]},\"Action\":[\"s3:GetObject\"],\"Resource\":[\"arn:aws:s3:::egov-rainmaker/*/pgr-landing/*\"]}]}' > /tmp/p.json
      mc anonymous set-json /tmp/p.json m/egov-rainmaker >/dev/null" || fail "could not set the bucket policy"
    ok "egov-rainmaker private; pgr-landing/ public (no listing)"
  fi
fi

# ── 3. filestore (compose) ───────────────────────────────────────────────────
if want filestore || want minio; then
  step "3. Compose file (minio-init policy, filestore link expiry)"
  backup "$COMPOSE_MAIN"
  if run_patch compose "$COMPOSE_MAIN"; then CHANGED_COMPOSE=true; else CHANGED_COMPOSE=false; fi
  if want filestore; then
    CUR_EXP=$(docker inspect $FS --format '{{range .Config.Env}}{{println .}}{{end}}' | sed -n 's/^PRESIGNED_URL_EXPIRY_TIME_IN_SECS=//p')
    if [ -n "$CUR_EXP" ] && ! $CHANGED_COMPOSE; then
      ok "egov-filestore already running with ${CUR_EXP}s links"
    elif $DRY_RUN; then
      ok "would recreate egov-filestore (links 1 hour)"
    else
      (cd "$WORKDIR" && docker compose -p "$PROJECT" "${COMPOSE_FILES[@]/#/-f}" up -d --no-deps $FS) >/dev/null 2>&1 \
        || fail "docker compose could not recreate $FS (compose file saved in $BACKUP)"
      wait_healthy $FS 300 || fail "$FS did not become healthy"
      ok "egov-filestore recreated: $(docker inspect $FS --format '{{range .Config.Env}}{{println .}}{{end}}' | grep PRESIGNED)"
    fi
  fi
fi

# ── 4. nginx ─────────────────────────────────────────────────────────────────
if want nginx && [ ${#NGINX_SITES[@]} -gt 0 ]; then
  step "4. nginx"
  command -v nginx >/dev/null || fail "nginx not found on the host"
  HAVE_ZONE=false; nginx -T 2>/dev/null | grep -q 'zone=digit_filestore_upload' && HAVE_ZONE=true
  i=0; NGX_CHANGED=false
  for f in "${NGINX_SITES[@]}"; do
    i=$((i + 1)); backup "$f" "nginx-$i"; $DRY_RUN || echo "$f" >"$BACKUP/nginx-$i.path"
    args=(nginx "$f"); $HAVE_ZONE || { args+=(--with-zone); HAVE_ZONE=true; }
    if run_patch "${args[@]}"; then NGX_CHANGED=true; fi
  done
  if $NGX_CHANGED && ! $DRY_RUN; then
    if nginx -t >/dev/null 2>&1; then systemctl reload nginx && ok "nginx reloaded"
    else
      for j in $(seq 1 $i); do cp -a "$BACKUP/nginx-$j" "$(cat "$BACKUP/nginx-$j.path")"; done
      fail "nginx -t failed; site files restored: $(nginx -t 2>&1 | tail -2 | tr '\n' ' ')"
    fi
  fi
fi

# ── 5. UI (digit-ui + configurator) ──────────────────────────────────────────
if want ui; then
  step "5. Rebuild and deploy digit-ui and configurator"
  if $DRY_RUN; then
    ok "would build digit-ui in $UI_WORK and copy it into $UI_CTR:$UI_WEB"
    ok "would build the configurator in $DIGIT_DIR/.build and copy dist to $CONF_DIR (config.js kept)"
  else
    mkdir -p "$BACKUP"
    UI_LOG="$BACKUP/ui-build.log"

    # digit-ui — the manual update: rsync, npm ci, esbuild, tar into the container.
    info "digit-ui: syncing source to $UI_WORK"
    mkdir -p "$UI_WORK"
    rsync -a --delete --exclude=node_modules --exclude=build "$UI_SRC/" "$UI_WORK/"
    LOCK_SHA=$(sha256sum "$UI_WORK/package-lock.json" | cut -d' ' -f1)
    if [ "$(cat "$UI_WORK/node_modules/.vapt223-lock.sha" 2>/dev/null)" != "$LOCK_SHA" ]; then
      info "digit-ui: npm ci --legacy-peer-deps (dependencies changed)"
      (cd "$UI_WORK" && npm ci --legacy-peer-deps >>"$UI_LOG" 2>&1) || fail "digit-ui npm ci failed (log: $UI_LOG)"
      echo "$LOCK_SHA" >"$UI_WORK/node_modules/.vapt223-lock.sha"
    fi
    info "digit-ui: building"
    (cd "$UI_WORK" && GLOBAL_CONFIGS="$GLOBAL_CONFIGS" node esbuild.build.js >>"$UI_LOG" 2>&1) \
      && grep -q "Build complete" "$UI_LOG" || fail "digit-ui build failed (log: $UI_LOG); nothing deployed"
    grep -oh 'Filefetch:async.\{0,700\}' "$UI_WORK"/build/index.js "$UI_WORK"/build/chunks/*.js 2>/dev/null | grep -q 'auth-token' \
      || fail "built digit-ui does not send the token with photo requests (is this the right branch?); nothing deployed"
    NEW_ID=$(sed -n 's/.*"buildId":"\([^"]*\)".*/\1/p' "$UI_WORK/build/build-info.json" 2>/dev/null)
    ok "digit-ui built (build $NEW_ID; photo requests send the token)"

    # configurator — the Ansible build_configurator path.
    info "configurator: syncing source to $DIGIT_DIR/.build"
    mkdir -p "$DIGIT_DIR/.build/configurator" "$DIGIT_DIR/.build/ui-shared"
    rsync -a --exclude=node_modules --exclude=dist "$CONF_SRC/" "$DIGIT_DIR/.build/configurator/"
    rsync -a "$REPO_ROOT/ui-shared/" "$DIGIT_DIR/.build/ui-shared/"
    info "configurator: building (VITE_STATE_TENANT_ID=${STATE_TENANT:-})"
    CONF_DIST=$(VITE_STATE_TENANT_ID="${STATE_TENANT:-}" VITE_ENABLE_LEGACY_PGR_DASHBOARD=false VITE_OVERPASS_URL="${VITE_OVERPASS_URL:-}" \
      bash "$REPO_ROOT/local-setup/ansible/files/configurator-build.sh" "$DIGIT_DIR/.build/configurator" - "" 2>>"$UI_LOG" | tail -1)
    [ -f "$CONF_DIST/index.html" ] || fail "configurator build failed (log: $UI_LOG); nothing deployed"
    grep -q 'pgr-landing' "$CONF_DIST"/assets/*.js && grep -q 'Re-select to publish' "$CONF_DIST"/assets/*.js \
      || fail "built configurator lacks the landing-picture change (is this the right branch?); nothing deployed"
    ok "configurator built"

    # Both built: back up what is live, then deploy.
    docker exec "$UI_CTR" tar -C "$UI_WEB" -cf - . >"$BACKUP/digit-ui.tar" || fail "could not back up $UI_CTR files"
    cp -a "$CONF_DIR" "$BACKUP/configurator" || fail "could not back up $CONF_DIR"
    tar -C "$UI_WORK/build" --exclude=globalConfigs.js --exclude=silent-check-sso.html -cf - . \
      | docker exec -i "$UI_CTR" tar -C "$UI_WEB" -xf - || fail "could not copy digit-ui into $UI_CTR (backup: $BACKUP/digit-ui.tar)"
    rsync -a --exclude=config.js --exclude=telemetry-config.js "$CONF_DIST/" "$CONF_DIR/" \
      || fail "could not copy the configurator into $CONF_DIR (backup: $BACKUP/configurator)"
    LIVE_ID=$(curl -s -m 15 "$BASE_URL/digit-ui/build-info.json" | sed -n 's/.*"buildId":"\([^"]*\)".*/\1/p')
    if [ -n "$NEW_ID" ] && [ "$LIVE_ID" = "$NEW_ID" ]; then ok "digit-ui deployed and served (build $LIVE_ID)"
    else warn "digit-ui copied, but $BASE_URL serves build '${LIVE_ID:-?}' (expected $NEW_ID); check --url"; fi
    [ "$(code "$BASE_URL/configurator/")" = 200 ] && ok "configurator deployed and served" || warn "configurator copied, but $BASE_URL/configurator/ did not answer 200"
    UI_READY=true
  fi
fi

# ── 6. Kong ──────────────────────────────────────────────────────────────────
if want kong && { $UI_READY || $DRY_RUN; }; then
  step "6. Kong (filestore needs a login)"
  backup "$KONG_FILE" kong.yml
  if run_patch kong "$KONG_FILE" && ! $DRY_RUN; then
    if ! docker exec "$KONG" kong config parse "$KONG_DEST" >/dev/null 2>&1; then
      cp -a "$BACKUP/kong.yml" "$KONG_FILE"; fail "Kong rejected the new config; kong.yml restored"
    fi
    docker restart "$KONG" >/dev/null
    if ! wait_healthy "$KONG" 120; then
      cp -a "$BACKUP/kong.yml" "$KONG_FILE"; docker restart "$KONG" >/dev/null
      fail "Kong did not come back healthy; kong.yml restored and Kong restarted"
    fi
    ok "Kong restarted with the new config"
  fi
fi

# ── 7. verify ────────────────────────────────────────────────────────────────
step "7. Checks against $BASE_URL"
$DRY_RUN && { ok "Dry run finished. Nothing was changed."; exit 0; }
BAD=0
expect() { # label expected-codes actual
  if [[ " $2 " == *" $3 "* ]]; then ok "$1 -> $3"; else warn "$1 -> $3 (expected $2)"; BAD=1; fi
}
if want minio || want nginx; then
  expect "bucket listing, no login" "403" "$(code "$BASE_URL/file-store/egov-rainmaker")"
  expect "unsigned object, no login" "403 404" "$(code "$BASE_URL/file-store/egov-rainmaker/x/PGR/none.txt")"
fi
if want kong; then
  expect "GET /filestore/v1/files/url, no login" "401" "$(code "$BASE_URL/filestore/v1/files/url?tenantId=x&fileStoreIds=x")"
  expect "GET /filestore/v1/files/id, no login" "401" "$(code "$BASE_URL/filestore/v1/files/id?tenantId=x&fileStoreId=x")"
  expect "upload, no login" "401 429" "$(code -X POST -F 'file=@/etc/hostname' "$BASE_URL/filestore/v1/files")"
fi
expect "localization search still open" "200" "$(code -X POST -H 'Content-Type: application/json' -d '{"RequestInfo":{}}' "$BASE_URL/localization/messages/v1/_search?locale=en_IN&tenantId=x")"
[ -d "$BACKUP" ] && info "Backup: $BACKUP   (undo: $0 --rollback $BACKUP)"
if ! want kong; then info "Next: $0 --build-ui   (rebuilds the UI, then turns on the Kong step)"; fi
info "Users must reload the page (Ctrl+Shift+R) to get the new UI."
[ $BAD -eq 0 ] && ok "Done." || { warn "Some checks did not match; see above."; exit 1; }
