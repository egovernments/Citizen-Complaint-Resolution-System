#!/usr/bin/env bash
#
# local-deploy.sh — bring up the standalone DIGIT compose stack locally, building
# a chosen subset of CCRS-owned services FROM LOCAL SOURCE while pulling every
# other image as the base compose declares.
#
# Single source of truth for what is buildable: build/build-config.yml (the same
# manifest CI and the nightly consume). This script parses it, and for each
# service you pass to --build it generates a gitignored compose override
# (local-setup/docker-compose.local-build.yml) with a build:+image:<name>:$LOCAL_TAG
# block, then runs:
#   docker compose -f docker-compose.egov-digit.yaml -f docker-compose.local-build.yml up -d --build
#
# With no --build it is a pure pull: docker compose -f docker-compose.egov-digit.yaml up -d.
#
# This script NEVER touches local-setup/ansible/ — the server deploy path
# (deploy.sh / playbook) is entirely separate. See docs/LOCAL-DEPLOY.md.
#
# Usage:
#   ./local-deploy.sh [--build "svc1 svc2"] [--build svc3] [--list] [--no-up] [-- <extra args to compose up>]
#
#   --build "a b"   Build these services from local source (repeatable; space-set
#                   accumulates). Each name must be a build-config.yml image-name
#                   AND a service in docker-compose.egov-digit.yaml.
#   --list          Print the buildable manifest (name / work-dir / dockerfile /
#                   mode / whether it is a service in this compose) and exit.
#   --no-up         Generate the override but do NOT run compose up.
#   --              Everything after is passed through to `docker compose ... up`
#                   (e.g. `-- --profile notifications` to enable a profile).
#
# Env:
#   LOCAL_TAG   tag for locally-built images (default: local).
#
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
BASE_COMPOSE="docker-compose.egov-digit.yaml"           # relative to SCRIPT_DIR
OVERRIDE_FILE="docker-compose.local-build.yml"          # relative to SCRIPT_DIR
BUILD_CONFIG="$REPO_ROOT/build/build-config.yml"
MAVEN_DOCKERFILE="build/maven/Dockerfile"
LOCAL_TAG="${LOCAL_TAG:-local}"

err()  { echo "ERROR: $*" >&2; }
die()  { err "$*"; exit 1; }
info() { echo "[local-deploy] $*"; }

# ---------------------------------------------------------------------------
# Dependency checks — fail fast with actionable messages.
# ---------------------------------------------------------------------------
check_deps() {
  command -v docker >/dev/null 2>&1 || die "docker not found on PATH."
  if ! docker compose version >/dev/null 2>&1; then
    die "docker compose v2 not available ('docker compose version' failed). Install the Compose v2 plugin."
  fi
  command -v python3 >/dev/null 2>&1 || die "python3 required to parse $BUILD_CONFIG."
  python3 -c 'import yaml' >/dev/null 2>&1 \
    || die "python3 'yaml' module (PyYAML) required. Install with: python3 -m pip install pyyaml"
  [ -f "$BUILD_CONFIG" ] || die "$BUILD_CONFIG not found."
  [ -f "$SCRIPT_DIR/$BASE_COMPOSE" ] || die "$SCRIPT_DIR/$BASE_COMPOSE not found."
}

# ---------------------------------------------------------------------------
# read_targets — flatten build/build-config.yml into TAB rows:
#   <image-name> <work-dir> <dockerfile|-> <mode:maven|plain>
# mode=maven iff the entry uses the shared build/maven/Dockerfile (repo-root
# context + WORK_DIR arg); everything else is a plain build (context=work-dir).
# Identical flatten to local-setup/ansible/files/nightly-build-push.sh.
# ---------------------------------------------------------------------------
read_targets() {
  python3 - "$BUILD_CONFIG" "$MAVEN_DOCKERFILE" <<'PY'
import sys, yaml
cfg_path, maven_df = sys.argv[1], sys.argv[2]
with open(cfg_path) as f:
    cfg = yaml.safe_load(f) or {}
for entry in (cfg.get("config") or []):
    for b in (entry.get("build") or []):
        img = (b.get("image-name") or "").strip()
        wd  = (b.get("work-dir") or "").strip()
        df  = (b.get("dockerfile") or "").strip()
        if not img or not wd:
            continue
        mode = "maven" if df.endswith(maven_df) else "plain"
        print("\t".join([img, wd, df or "-", mode]))
PY
}

# compose_services — every service declared in the base compose file, INCLUDING
# those gated behind a profile (novu-bridge-endpoint→notifications, otp-publisher→
# otp, etc.). `--profile '*'` enables all profiles so config --services lists them;
# without it, profile-gated services are hidden and would be wrongly rejected.
compose_services() {
  ( cd "$SCRIPT_DIR" && docker compose -f "$BASE_COMPOSE" --profile '*' config --services 2>/dev/null | sort )
}

# get_row <image-name> — echo the manifest row (TAB) for a name, or nothing.
get_row() {
  local name="$1"
  printf '%s\n' "${ROWS[@]}" | awk -F'\t' -v n="$name" '$1==n {print; exit}'
}

# in_list <needle> <space-separated haystack> — exact whitespace-delimited match.
in_list() {
  local needle="$1" hay="$2"
  [[ " $hay " == *" $needle "* ]]
}

# ---------------------------------------------------------------------------
# Load the manifest up front (hard-fail on parse error / empty manifest).
# ---------------------------------------------------------------------------
load_manifest() {
  ROWS=()
  while IFS= read -r row; do
    [ -n "$row" ] && ROWS+=("$row")
  done < <(read_targets)
  [ ${#ROWS[@]} -gt 0 ] || die "no build targets parsed from $BUILD_CONFIG (parse error or empty manifest)."
  # Space-separated list of all buildable image-names.
  ALL_IMAGES=""
  local r img
  for r in "${ROWS[@]}"; do
    img="${r%%$'\t'*}"
    ALL_IMAGES="$ALL_IMAGES $img"
  done
  ALL_IMAGES="${ALL_IMAGES# }"
  COMPOSE_SVCS="$(compose_services | tr '\n' ' ')"
}

# ---------------------------------------------------------------------------
# --list — print the manifest with a "service in this compose?" column.
# ---------------------------------------------------------------------------
do_list() {
  printf '%-32s %-46s %-40s %-6s %s\n' "IMAGE-NAME" "WORK-DIR" "DOCKERFILE" "MODE" "IN-COMPOSE?"
  local r img wd df mode incompose
  for r in "${ROWS[@]}"; do
    IFS=$'\t' read -r img wd df mode <<<"$r"
    if in_list "$img" "$COMPOSE_SVCS"; then incompose="yes"; else incompose="no"; fi
    printf '%-32s %-46s %-40s %-6s %s\n' "$img" "$wd" "$df" "$mode" "$incompose"
  done
  echo
  echo "buildable = image-name in build/build-config.yml; IN-COMPOSE? = also a service in $BASE_COMPOSE."
  echo "Only IN-COMPOSE?=yes services can be passed to --build."
}

# ---------------------------------------------------------------------------
# validate_service <name> — must be a build-config image-name AND a compose
# service. Errors are actionable.
# ---------------------------------------------------------------------------
validate_service() {
  local name="$1"
  if ! in_list "$name" "$ALL_IMAGES"; then
    err "'$name' is not an image-name in build/build-config.yml."
    err "Run '$0 --list' to see buildable services."
    exit 1
  fi
  if ! in_list "$name" "$COMPOSE_SVCS"; then
    err "'$name' is buildable but is NOT a service in $BASE_COMPOSE."
    err "(e.g. *-db flyway images, xstate-chatbot, configurator, digit-ui-v2 are built by the"
    err " nightly but are not services in this standalone compose — nothing to override here.)"
    exit 1
  fi
}

# ---------------------------------------------------------------------------
# emit_override <svc1> <svc2> ... — write $OVERRIDE_FILE with a build: block per
# service. All paths are relative to $SCRIPT_DIR (where the override lives).
# ---------------------------------------------------------------------------
emit_override() {
  local out="$SCRIPT_DIR/$OVERRIDE_FILE"
  {
    echo "# AUTO-GENERATED by local-setup/local-deploy.sh — DO NOT EDIT or COMMIT."
    echo "# Regenerated on every run; gitignored (see .gitignore)."
    echo "# Layers build: overrides onto $BASE_COMPOSE so the selected services build"
    echo "# from local source as <name>:$LOCAL_TAG instead of being pulled."
    echo "services:"
  } > "$out"

  local svc row wd df mode wd_clean prefix rel_df
  for svc in "$@"; do
    row="$(get_row "$svc")"
    [ -n "$row" ] || die "internal: no manifest row for '$svc' (should have been validated)."
    IFS=$'\t' read -r _img wd df mode <<<"$row"
    {
      echo "  ${svc}:"
      echo "    image: ${svc}:${LOCAL_TAG}"
      echo "    pull_policy: never"
      echo "    build:"
      if [ "$mode" = "maven" ]; then
        # Shared maven Dockerfile: repo-root context (.. from local-setup/), WORK_DIR arg.
        echo "      context: .."
        echo "      dockerfile: ${MAVEN_DOCKERFILE}"
        echo "      args:"
        echo "        WORK_DIR: ${wd}"
      else
        wd_clean="${wd%/}"
        echo "      context: ../${wd_clean}"
        if [ "$df" != "-" ]; then
          prefix="${wd_clean}/"
          if [[ "$df" == "$prefix"* ]]; then
            rel_df="${df#"$prefix"}"
            echo "      dockerfile: ${rel_df}"
          else
            die "dockerfile '$df' for '$svc' is not under its work-dir '$wd' — cannot compute a context-relative path. Fix build/build-config.yml."
          fi
        fi
        # plain with no dockerfile: omit dockerfile: (compose uses Dockerfile in context).
      fi
    } >> "$out"
  done
  info "generated override $out for: $*"
}

# ---------------------------------------------------------------------------
# Argument parsing.
# ---------------------------------------------------------------------------
BUILD_SVCS=()
EXTRA_ARGS=()
DO_LIST=0
NO_UP=0

while [ $# -gt 0 ]; do
  case "$1" in
    --build)
      shift
      [ $# -gt 0 ] || die "--build requires an argument (a service name or space-separated set)."
      # Split the space-set into tokens and accumulate.
      for tok in $1; do BUILD_SVCS+=("$tok"); done
      shift
      ;;
    --list)
      DO_LIST=1; shift ;;
    --no-up)
      NO_UP=1; shift ;;
    --)
      shift
      while [ $# -gt 0 ]; do EXTRA_ARGS+=("$1"); shift; done
      ;;
    -h|--help)
      sed -n '2,40p' "${BASH_SOURCE[0]}" | sed 's/^# \{0,1\}//'
      exit 0 ;;
    *)
      die "unknown argument: '$1' (see --help)." ;;
  esac
done

# ---------------------------------------------------------------------------
# Main.
# ---------------------------------------------------------------------------
check_deps
load_manifest

if [ "$DO_LIST" -eq 1 ]; then
  do_list
  exit 0
fi

# De-duplicate + validate requested services (preserve order).
CHOSEN=()
if [ ${#BUILD_SVCS[@]} -gt 0 ]; then
  for svc in "${BUILD_SVCS[@]}"; do
    [ -n "$svc" ] || continue
    if ! in_list "$svc" "${CHOSEN[*]:-}"; then
      validate_service "$svc"
      CHOSEN+=("$svc")
    fi
  done
fi

if [ ${#CHOSEN[@]} -gt 0 ]; then
  emit_override "${CHOSEN[@]}"
else
  # Pure pull — make sure a stale override from a prior run doesn't leak in.
  rm -f "$SCRIPT_DIR/$OVERRIDE_FILE"
  info "no --build services — pure pull of $BASE_COMPOSE."
fi

# Summary of what will build vs pull.
if [ ${#CHOSEN[@]} -gt 0 ]; then
  info "will BUILD locally (:$LOCAL_TAG): ${CHOSEN[*]}"
  info "every other service is PULLED as $BASE_COMPOSE declares."
else
  info "all services PULLED as $BASE_COMPOSE declares."
fi

if [ "$NO_UP" -eq 1 ]; then
  info "--no-up: skipping compose up."
  [ ${#CHOSEN[@]} -gt 0 ] && info "inspect the generated override: $SCRIPT_DIR/$OVERRIDE_FILE"
  exit 0
fi

cd "$SCRIPT_DIR"
if [ ${#CHOSEN[@]} -gt 0 ]; then
  set -- docker compose -f "$BASE_COMPOSE" -f "$OVERRIDE_FILE" up -d --build
else
  set -- docker compose -f "$BASE_COMPOSE" up -d
fi
if [ ${#EXTRA_ARGS[@]} -gt 0 ]; then
  info "${*} ${EXTRA_ARGS[*]}"
  "$@" "${EXTRA_ARGS[@]}"
else
  info "${*}"
  "$@"
fi

echo
info "done. Verify running images with:"
echo "  docker ps --format '{{.Names}}\t{{.Image}}'"
