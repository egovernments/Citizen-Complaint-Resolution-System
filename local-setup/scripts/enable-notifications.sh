#!/usr/bin/env bash
# =============================================================================
# enable-notifications.sh
#
# Turn on config-driven PGR notifications (SMS / Email / WhatsApp) on a *running*
# DIGIT / CCRS deployment. This is the self-narrating, resumable, validated
# installer form of the "enable notifications" runbook that was validated live on
# the ovh-8c24g reference box. It does NOT build images and does NOT deploy the
# stack from scratch — it assumes DIGIT is already up and flips the feature on.
#
# What it does, in 9 ordered steps (each is a resumable, idempotent shell fn):
#   1. PGR onto the config-driven path   (PGR_NOTIFICATION_CONFIG_DRIVEN=true)
#   2. Pin the bridge image + bring up the Novu stack
#   3. Mint the self-hosted Novu API key and wire it into the bridge
#   4. Open the channel gate (SMS,EMAIL,WHATSAPP) + config-admin proxy roles
#   5. Ingress for the Novu dashboard (SHOWCASE + VALIDATE — site-specific)
#   6. Seed the 4 notification MDMS masters at the state-root tenant
#   7. Add a provider + enter Twilio creds in Novu (SHOWCASE + VALIDATE — secrets
#      are entered by a human, never by this script)
#   8. Create the per-channel Novu workflows (complaints-sms/-email/-whatsapp)
#   9. Drive-and-verify: read nb_dispatch_log (SENT = trigger accepted, not proof
#      of delivery)
#
# Everything is tunable via the env vars in the CONFIG block below; the baked-in
# defaults are the exact values from the validated reference box.
#
# Usage:
#   ./enable-notifications.sh                 # run all steps in order
#   ./enable-notifications.sh --list          # print the ordered steps + exit
#   ./enable-notifications.sh --help          # full help
#   ./enable-notifications.sh --from step4    # resume from step 4 to the end
#   ./enable-notifications.sh --to   step3    # preflight + steps 1..3
#   ./enable-notifications.sh --only step6    # just seed the masters
#   ./enable-notifications.sh --only step6,step8
#   ./enable-notifications.sh --dry-run       # print what it WOULD do, run nothing
#   ./enable-notifications.sh --yes           # don't pause at manual/showcase steps
#
# NOTE: the human-facing "#" comments in here explain the WHY — an operator can
# ignore them and just watch the coloured CLI narration. The narration
# (==> [n/9] …, sub-lines, OK/WARN/FAIL) is the runtime story.
# =============================================================================

set -euo pipefail

# -----------------------------------------------------------------------------
# CONFIG — every tunable is an env var with a sane default and a "# what it is".
# Override any of these on the command line, e.g.:
#   PUBLIC_URL=http://1.2.3.4.nip.io ADMIN_USER=ADMIN ./enable-notifications.sh
# -----------------------------------------------------------------------------

# Filesystem layout on the box.
DIGIT_HOME="${DIGIT_HOME:-/opt/digit}"                    # where the compose stack + .env live
CCRS_HOME="${CCRS_HOME:-/opt/ccrs}"                       # the CCRS develop checkout (seed script, mint script)

# Two origins, and it matters which call uses which:
#   DIGIT_URL  = the in-box gateway origin. Used for host-local API calls.
#   PUBLIC_URL = the external nip.io / public origin. The oauth token mint and
#                the MDMS seed run against THIS (that's what the runbook used).
DIGIT_URL="${DIGIT_URL:-http://localhost:8080}"           # in-box gateway origin (host-local API calls)
PUBLIC_URL="${PUBLIC_URL:-${DIGIT_URL}}"                  # external origin (oauth + seed + ingress verify); default = DIGIT_URL

# Tenant + admin identity.
NOTIF_TENANT="${NOTIF_TENANT:-ke}"                        # state-root tenant to author config at; city tenants inherit
ADMIN_USER="${ADMIN_USER:-SUPERADMIN}"                    # admin user; SUPERADMIN on a DDH-seeded box, ADMIN on an MCP-bootstrapped one
ADMIN_PASS="${ADMIN_PASS:-eGov@123}"                      # admin password

# Novu.
NOVU_API_LOCAL="${NOVU_API_LOCAL:-http://localhost:14002}" # novu-api direct port (mint key + workflows talk to THIS, not the /novu/ dashboard)
NOVU_BRIDGE_IMAGE="${NOVU_BRIDGE_IMAGE:-registry.preview.egov.theflywheel.in/egovio/novu-bridge:develop-20260716}"
# ^ base image = SMS/email + FREE-FORM WhatsApp only. The Content-SID (approved
#   template) WhatsApp path needs a build off this PR branch — on the box that is
#   the locally-tagged novu-bridge:wa-sync / pgr-services:wa-contentsid images.
NOVU_BRIDGE_IMAGE_WA="${NOVU_BRIDGE_IMAGE_WA:-novu-bridge:wa-sync}"   # local tag carrying WhatsApp templates (this PR)
PGR_IMAGE_WA="${PGR_IMAGE_WA:-pgr-services:wa-contentsid}"            # local tag carrying WhatsApp templates (this PR)

# Feature toggles that get written into .env.
CHANNELS_ENABLED="${CHANNELS_ENABLED:-SMS,EMAIL,WHATSAPP}"           # NOVU_BRIDGE_CHANNELS_ENABLED (compose default is SMS,EMAIL)
PROXY_ALLOWED_ROLES="${PROXY_ALLOWED_ROLES:-EMPLOYEE,SUPERUSER,GRO,PGR_LME,MDMS_ADMIN}"
# ^ NOVU_BRIDGE_PROXY_ALLOWED_ROLES. MDMS_ADMIN is the config-admin; it is
#   EXCLUDED by the compose default, which 403s the configurator's own screens.

# Per-channel Novu workflow ids (must match novu.bridge.workflow.id.* in the bridge).
WF_SMS="${WF_SMS:-complaints-sms}"                        # SMS workflow  (one `sms` step)
WF_EMAIL="${WF_EMAIL:-complaints-email}"                  # EMAIL workflow (one `email` step — NOT sms; common mistake)
WF_WA="${WF_WA:-complaints-whatsapp}"                     # WhatsApp workflow (one `sms` step; bridge adds whatsapp:+e164)

# Postgres (for the nb_dispatch_log verify).
DB_CONTAINER="${DB_CONTAINER:-docker-postgres}"           # postgres container name
DB_USER="${DB_USER:-egov}"                                # db user
DB_NAME="${DB_NAME:-egov}"                                # db name

# Compose file set. NAME SERVICES EXPLICITLY on every up — a bare `up -d` revives
# default-data-handler, which re-seeds MDMS.
COMPOSE_FILES="${COMPOSE_FILES:-docker-compose.egov-digit.yaml docker-compose.fast-path.yml docker-compose.migrations.yml docker-compose.migrations.ansible.yml}"
KONG_CONTAINER="${KONG_CONTAINER:-kong-gateway}"          # Kong container to restart after a bridge recreate (DNS cache flush)

# Step 5 ingress: auto | true | false. auto = validate only, mutate nothing.
ENABLE_INGRESS="${ENABLE_INGRESS:-auto}"

# Behaviour flags (also settable via CLI: --dry-run / --yes / --no-color).
DRY_RUN="${DRY_RUN:-false}"                               # true = print commands, run nothing
ASSUME_YES="${ASSUME_YES:-false}"                         # true = don't pause at manual/showcase steps

# -----------------------------------------------------------------------------
# The Basic auth for the DIGIT oauth client: `egov-user-client:` (empty secret),
# base64 -> ZWdvdi11c2VyLWNsaWVudDo=. Same value the seed script uses.
# -----------------------------------------------------------------------------
BASIC_OAUTH="Basic ZWdvdi11c2VyLWNsaWVudDo="

# =============================================================================
# Presentation helpers — colour narration (respects NO_COLOR / --no-color).
# =============================================================================
C_RESET=""; C_BOLD=""; C_RED=""; C_GRN=""; C_YEL=""; C_CYN=""; C_DIM=""
init_colors() {
  if [[ -n "${NO_COLOR:-}" ]] || [[ ! -t 1 ]]; then return; fi
  C_RESET=$'\033[0m'; C_BOLD=$'\033[1m'; C_RED=$'\033[31m'; C_GRN=$'\033[32m'
  C_YEL=$'\033[33m'; C_CYN=$'\033[36m'; C_DIM=$'\033[2m'
}

# step()  — the big per-step banner:  ==> [3/9] Minting the Novu API key…
step()    { printf '\n%s==> [%s/%s] %s%s\n' "${C_BOLD}${C_CYN}" "$(step_index "$1")" "${#ALL_STEPS[@]}" "$2" "${C_RESET}"; }
# sub-lines under a step ("Setting env variables…", "Seeding masters…")
log()     { printf '   %s%s%s\n' "${C_DIM}" "$*" "${C_RESET}"; }
ok()      { printf '   %s[ OK ]%s %s\n' "${C_GRN}" "${C_RESET}" "$*"; }
warn()    { printf '   %s[WARN]%s %s\n' "${C_YEL}" "${C_RESET}" "$*"; }
err()     { printf '   %s[FAIL]%s %s\n' "${C_RED}" "${C_RESET}" "$*" >&2; }
note()    { printf '   %sℹ  %s%s\n' "${C_DIM}" "$*" "${C_RESET}"; }

# =============================================================================
# Core helpers.
# =============================================================================

# run <desc> <command-string> — narrate + execute an ACTION (honours --dry-run).
run() {
  local desc="$1"; shift
  local cmd="$*"
  log "${desc}"
  if [[ "$DRY_RUN" == true ]]; then
    printf '   %s[dry-run]%s %s\n' "${C_YEL}" "${C_RESET}" "$cmd"
    return 0
  fi
  eval "$cmd"
}

# require <desc> <predicate> — PRECONDITION. Abort the step/script if it fails.
require() {
  local desc="$1"; shift
  if [[ "$DRY_RUN" == true ]]; then printf '   %s[dry-run]%s require: %s\n' "${C_YEL}" "${C_RESET}" "$desc"; return 0; fi
  if eval "$@" >/dev/null 2>&1; then ok "precondition: ${desc}"; return 0
  else err "PRECONDITION FAILED: ${desc}"; return 1; fi
}

# verify <desc> <predicate> — POSTCONDITION. Error if the step didn't take effect.
verify() {
  local desc="$1"; shift
  if [[ "$DRY_RUN" == true ]]; then printf '   %s[dry-run]%s verify: %s\n' "${C_YEL}" "${C_RESET}" "$desc"; return 0; fi
  if eval "$@" >/dev/null 2>&1; then ok "verify: ${desc}"; return 0
  else err "POSTCONDITION FAILED: ${desc}"; return 1; fi
}

# set_env KEY VALUE [redact] — idempotent .env mutation.
#   $DIGIT_HOME/.env is root-owned 600, so we need sudo to BOTH read and write it.
#   Replace an existing KEY=… line if present, else append. When [redact] is
#   given we never print the value (secrets: the Novu API key).
set_env() {
  local key="$1" val="$2" redact="${3:-}"
  local envf="$DIGIT_HOME/.env"
  if [[ -n "$redact" ]]; then log "Setting ${key} in .env (value redacted)"; else log "Setting ${key}=${val} in .env"; fi
  if [[ "$DRY_RUN" == true ]]; then
    printf '   %s[dry-run]%s set_env %s\n' "${C_YEL}" "${C_RESET}" "$key"
    return 0
  fi
  if sudo grep -qE "^${key}=" "$envf" 2>/dev/null; then
    # values here (image refs, comma lists, hex keys, true) contain no sed-special
    # chars for the `|` delimiter — safe replace-in-place.
    sudo sed -i "s|^${key}=.*|${key}=${val}|" "$envf"
  else
    printf '%s=%s\n' "$key" "$val" | sudo tee -a "$envf" >/dev/null
  fi
}

# compose <args…> — docker compose, run from $DIGIT_HOME (files are relative to it).
# Callers MUST name services explicitly (see COMPOSE_FILES comment above).
compose() {
  run "compose $*" "cd '$DIGIT_HOME' && ${DC} $*"
}

# container_of <service> — resolve the running container id for a compose service.
# Avoids guessing container names across compose project-name conventions.
container_of() { ( cd "$DIGIT_HOME" && eval "${DC} ps -q $1" 2>/dev/null | head -n1 ); }

# --- tiny HTTP predicates ---------------------------------------------------
http_code()      { curl -s -o /dev/null -w '%{http_code}' --max-time 10 "$1" 2>/dev/null || echo 000; }
http_reachable() { [[ "$(http_code "$1")" != "000" ]]; }          # anything but a connect failure
http_ok()        { [[ "$(http_code "$1")" =~ ^[23] ]]; }          # 2xx / 3xx

# --- container-state predicates (used by many verifies) ---------------------
_svc_running() {
  local cid; cid=$(container_of "$1"); [[ -n "$cid" ]] || return 1
  [[ "$(sudo docker inspect -f '{{.State.Running}}' "$cid" 2>/dev/null)" == "true" ]]
}
_svc_env_has() {   # _svc_env_has <service> <grep-ERE against the container env>
  local cid; cid=$(container_of "$1"); [[ -n "$cid" ]] || return 1
  sudo docker inspect "$cid" --format '{{range .Config.Env}}{{println .}}{{end}}' 2>/dev/null | grep -qE "$2"
}

# mint_token — DIGIT employee token via Basic egov-user-client: at the PUBLIC origin.
# Prints ONLY the token to stdout; callers must never log it.
mint_token() {
  curl -s -X POST "$PUBLIC_URL/user/oauth/token" \
    -H "Authorization: $BASIC_OAUTH" \
    -H "Content-Type: application/x-www-form-urlencoded" \
    --data-urlencode "grant_type=password" \
    --data-urlencode "username=$ADMIN_USER" \
    --data-urlencode "password=$ADMIN_PASS" \
    --data-urlencode "tenantId=$NOTIF_TENANT" \
    --data-urlencode "scope=read" \
    --data-urlencode "userType=EMPLOYEE" 2>/dev/null \
  | python3 -c 'import sys,json
try: print(json.load(sys.stdin).get("access_token","") or "")
except Exception: print("")' 2>/dev/null
}
_have_token() { [[ -n "$(mint_token)" ]]; }

# _read_novu_key — read the minted Novu key back out of .env (never printed).
_read_novu_key() { sudo grep -E '^NOVU_API_KEY=' "$DIGIT_HOME/.env" 2>/dev/null | head -n1 | cut -d= -f2-; }

# mdms_count <schemaCode> <token> — how many rows exist at NOTIF_TENANT.
mdms_count() {
  local code="$1" tok="$2"
  curl -s -X POST "$PUBLIC_URL/mdms-v2/v2/_search" \
    -H "Content-Type: application/json" \
    -d "{\"RequestInfo\":{\"apiId\":\"enable-notif\",\"authToken\":\"$tok\"},\"MdmsCriteria\":{\"tenantId\":\"$NOTIF_TENANT\",\"schemaCode\":\"$code\",\"limit\":200}}" 2>/dev/null \
  | python3 -c 'import sys,json
try: print(len(json.load(sys.stdin).get("mdms",[])))
except Exception: print(-1)' 2>/dev/null
}

# _adapter_not_503 — a proxied /novu-adapter call must not 503 (Kong resolves the
# upstream). 503 = Kong lost the bridge in its DNS cache (needs a Kong restart).
_adapter_not_503() { local c; c=$(http_code "$PUBLIC_URL/novu-bridge/novu-adapter/v1/logs"); [[ "$c" != "503" && "$c" != "000" ]]; }

# pause "<prompt>" — stop for a human at the manual/showcase steps (skip with --yes).
pause() {
  local prompt="$1"
  if [[ "$ASSUME_YES" == true || "$DRY_RUN" == true ]]; then note "(--yes) not pausing: $prompt"; return 0; fi
  read -r -p "   ⏸  $prompt  [Enter to continue] " _ || true
}

# =============================================================================
# STEP CATALOG — stable ids + one-line descriptions. Order == execution order.
# =============================================================================
ALL_STEPS=(step1 step2 step3 step4 step5 step6 step7 step8 step9)
step_title() {
  case "$1" in
    step1) echo "PGR onto the config-driven notification path" ;;
    step2) echo "Pin the bridge image + bring up the Novu stack" ;;
    step3) echo "Mint the Novu API key and wire it into the bridge" ;;
    step4) echo "Open the channel gate + config-admin proxy roles" ;;
    step5) echo "Ingress for the Novu dashboard (showcase + validate)" ;;
    step6) echo "Seed the notification MDMS masters" ;;
    step7) echo "Add a provider + Twilio creds in Novu (showcase + validate)" ;;
    step8) echo "Create the per-channel Novu workflows" ;;
    step9) echo "Drive-and-verify via nb_dispatch_log" ;;
    *)     echo "?" ;;
  esac
}
step_index() { local i=1 s; for s in "${ALL_STEPS[@]}"; do [[ "$s" == "$1" ]] && { echo "$i"; return; }; i=$((i+1)); done; echo "?"; }
# normalize "6" -> "step6"; "step6" -> "step6"
normalize_step() { local x="$1"; [[ "$x" =~ ^[0-9]+$ ]] && x="step$x"; echo "$x"; }

# =============================================================================
# STEP 1 — PGR onto the config-driven path.
#   pre : pgr-services exists as a compose service
#   act : set PGR_NOTIFICATION_CONFIG_DRIVEN=true; up -d pgr-services
#   post: container env shows the flag true AND the container is running
# =============================================================================
do_step1() {
  step step1 "$(step_title step1)"
  require "pgr-services is a service in the compose stack" \
    "( cd '$DIGIT_HOME' && ${DC} config --services 2>/dev/null | grep -qx pgr-services )"

  log "Setting the config-driven flag…"
  set_env PGR_NOTIFICATION_CONFIG_DRIVEN true
  # NOTE: for WhatsApp *templates* you also need this PR's pgr image. We only pin
  # it if the local tag exists — otherwise the base image (SMS/email + free-form
  # WhatsApp) stays in place. Compose var is PGR_SERVICES_IMAGE on most stacks.
  if [[ "$DRY_RUN" != true ]] && sudo docker image inspect "$PGR_IMAGE_WA" >/dev/null 2>&1; then
    log "Local WhatsApp-template image ${PGR_IMAGE_WA} present — pinning it"
    set_env PGR_SERVICES_IMAGE "$PGR_IMAGE_WA"
  else
    note "Local ${PGR_IMAGE_WA} not found — keeping current pgr image (SMS/email + free-form WhatsApp)"
  fi

  log "Recreating pgr-services…"
  compose up -d pgr-services

  verify "pgr-services env has PGR_NOTIFICATION_CONFIG_DRIVEN=true" \
    "_svc_env_has pgr-services '^PGR_NOTIFICATION_CONFIG_DRIVEN=true'"
  verify "pgr-services container is running" "_svc_running pgr-services"
}

# =============================================================================
# STEP 2 — Pin the bridge image + bring up Novu.
#   pre : the bridge image is pullable OR the local WhatsApp tag exists
#   act : set NOVU_BRIDGE_IMAGE; up -d the whole Novu stack (named services only)
#   post: novu-api reachable; novu-bridge + digit-config-service running
# =============================================================================
do_step2() {
  step step2 "$(step_title step2)"

  # pre: either the registry image is reachable/pullable, or the local WA tag exists.
  require "bridge image available (registry pull OR local ${NOVU_BRIDGE_IMAGE_WA})" \
    "sudo docker image inspect '$NOVU_BRIDGE_IMAGE_WA' >/dev/null 2>&1 || sudo docker pull '$NOVU_BRIDGE_IMAGE' >/dev/null 2>&1 || sudo docker image inspect '$NOVU_BRIDGE_IMAGE' >/dev/null 2>&1"

  log "Pinning the bridge image…"
  if [[ "$DRY_RUN" != true ]] && sudo docker image inspect "$NOVU_BRIDGE_IMAGE_WA" >/dev/null 2>&1; then
    log "Local WhatsApp-template bridge ${NOVU_BRIDGE_IMAGE_WA} present — pinning it"
    set_env NOVU_BRIDGE_IMAGE "$NOVU_BRIDGE_IMAGE_WA"
  else
    set_env NOVU_BRIDGE_IMAGE "$NOVU_BRIDGE_IMAGE"
  fi

  # Bring up ONLY the Novu stack services + their migrations. Never a bare `up -d`.
  log "Bringing up the Novu stack (named services only — never a bare up -d)…"
  compose up -d novu-mongo novu-api novu-worker novu-ws novu-dashboard novu-bridge \
    digit-config-service novu-bridge-migration digit-config-service-migration

  verify "novu-api responds on ${NOVU_API_LOCAL}" "http_reachable '$NOVU_API_LOCAL'"
  verify "novu-bridge container is running" "_svc_running novu-bridge"
  verify "digit-config-service container is running" "_svc_running digit-config-service"
}

# =============================================================================
# STEP 3 — Mint the Novu API key and wire it into the bridge.
#   pre : novu-api healthy AND the mint script exists in the CCRS checkout
#   act : mint the Development key, write NOVU_API_KEY to .env (REDACTED), up bridge
#   post: bridge env carries a non-empty NOVU_API_KEY; /novu-adapter reachable
# =============================================================================
do_step3() {
  step step3 "$(step_title step3)"
  local mint="$CCRS_HOME/backend/novu-bridge/config/novu-mint-key.sh"

  require "novu-api is healthy on ${NOVU_API_LOCAL}" "http_reachable '$NOVU_API_LOCAL'"
  require "mint script exists ($mint)" "test -f '$mint'"

  log "Minting the self-hosted Novu Development key…"
  if [[ "$DRY_RUN" == true ]]; then
    printf '   %s[dry-run]%s KEY=$(NOVU_API_URL=%s bash %s); set_env NOVU_API_KEY <redacted>\n' \
      "${C_YEL}" "${C_RESET}" "$NOVU_API_LOCAL" "$mint"
  else
    local KEY
    # The mint script prints ONLY the key on stdout (diagnostics to stderr).
    KEY="$(NOVU_API_URL="$NOVU_API_LOCAL" bash "$mint")"
    if [[ -z "$KEY" ]]; then err "mint returned an empty key"; return 1; fi
    ok "minted a Novu key (${KEY:0:4}… — redacted)"
    # NEVER echo the key anywhere else.
    set_env NOVU_API_KEY "$KEY" redact
    unset KEY
  fi

  log "Recreating novu-bridge with the key…"
  compose up -d novu-bridge

  verify "novu-bridge env carries a non-empty NOVU_API_KEY" "_svc_env_has novu-bridge '^NOVU_API_KEY=.+'"
  verify "/novu-adapter is reachable through the gateway" "http_reachable '$PUBLIC_URL/novu-bridge/novu-adapter/v1/logs'"
}

# =============================================================================
# STEP 4 — Channel gate + config-admin proxy roles.
#   pre : bridge running
#   act : set NOVU_BRIDGE_CHANNELS_ENABLED + NOVU_BRIDGE_PROXY_ALLOWED_ROLES;
#         up -d --force-recreate novu-bridge; then restart Kong (a bridge recreate
#         poisons Kong's DNS cache — flush it).
#   post: bridge env shows WHATSAPP in channels + MDMS_ADMIN in roles; a proxied
#         /novu-adapter call does NOT 503 (Kong resolved the upstream).
# =============================================================================
do_step4() {
  step step4 "$(step_title step4)"
  require "novu-bridge is running" "_svc_running novu-bridge"

  log "Setting env variables (channel gate + proxy roles)…"
  set_env NOVU_BRIDGE_CHANNELS_ENABLED "$CHANNELS_ENABLED"
  set_env NOVU_BRIDGE_PROXY_ALLOWED_ROLES "$PROXY_ALLOWED_ROLES"

  log "Force-recreating novu-bridge…"
  compose up -d --force-recreate novu-bridge

  # A bridge recreate changes its container IP; Kong caches the old one → 503s.
  log "Restarting Kong to flush its DNS cache…"
  run "restart ${KONG_CONTAINER}" "sudo docker restart '$KONG_CONTAINER'"
  # Give Kong a moment to re-resolve before the postcondition probe.
  [[ "$DRY_RUN" == true ]] || sleep 5

  verify "bridge channels include WHATSAPP" "_svc_env_has novu-bridge 'NOVU_BRIDGE_CHANNELS_ENABLED=.*WHATSAPP'"
  verify "bridge proxy roles include MDMS_ADMIN" "_svc_env_has novu-bridge 'NOVU_BRIDGE_PROXY_ALLOWED_ROLES=.*MDMS_ADMIN'"
  verify "proxied /novu-adapter does not 503 (Kong resolved the upstream)" "_adapter_not_503"
}

# =============================================================================
# STEP 5 — Ingress for the Novu dashboard (SHOWCASE + VALIDATE).
#   Editing nginx is site-specific, so unless ENABLE_INGRESS=true this step
#   SHOWCASES the exact blocks/envs to add and then VALIDATES the endpoint. It
#   mutates only ufw (allow 80/tcp), which is safe + idempotent.
#   pre : nginx present
#   post: curl -sI $PUBLIC_URL/novu returns 2xx/3xx
# =============================================================================
do_step5() {
  step step5 "$(step_title step5)"

  # auto = validate-only; skip entirely if the dashboard is already reachable.
  if [[ "$ENABLE_INGRESS" == "auto" ]] && http_ok "$PUBLIC_URL/novu"; then
    ok "ingress already serving /novu (deployed with enable_novu:true) — nothing to do"
    return 0
  fi

  require "nginx is present on the host" "command -v nginx >/dev/null 2>&1 || sudo test -d /etc/nginx"

  warn "MANUAL / site-specific: add these nginx server blocks + dashboard envs, then reload nginx."
  cat <<EOF
   ----------------------------------------------------------------------------
   nginx: add proxy locations for  /novu  /novu-api  /novu-ws
   Novu dashboard public-URL envs (the real set from the reference box):
     VITE_PUBLIC_PATH=/novu
     VITE_BASE_PATH=/novu
     VITE_API_HOSTNAME=${PUBLIC_URL}/novu-api
     VITE_WEBSOCKET_HOSTNAME=${PUBLIC_URL}/novu-ws
     VITE_SELF_HOSTED=true
   ----------------------------------------------------------------------------
EOF

  # The one safe, idempotent mutation: open port 80.
  log "Opening port 80 (ufw)…"
  run "ufw allow 80/tcp" "sudo ufw allow 80/tcp || true"

  pause "Apply the nginx blocks + dashboard envs above, then reload nginx."

  verify "dashboard reachable at ${PUBLIC_URL}/novu (2xx/3xx)" "http_ok '$PUBLIC_URL/novu'"
}

# =============================================================================
# STEP 6 — Seed the notification MDMS masters.
#   pre : MDMS reachable + we can mint an admin token
#   act : copy the schema + the 3 RAINMAKER-PGR.Notification* data files into a
#         notification-seed/ dir, then run seed-notifications.py (its env interface)
#   post: MDMS _search shows Routing/Template/ProviderTemplate rows (expect
#         24/42/14; assert each >= 1 and log the actual counts)
# =============================================================================
do_step6() {
  step step6 "$(step_title step6)"
  local scripts="$CCRS_HOME/local-setup/scripts"
  local seeddir="$scripts/notification-seed"
  local ddh="$CCRS_HOME/utilities/default-data-handler/src/main/resources"

  require "MDMS reachable at ${PUBLIC_URL}" "http_reachable '$PUBLIC_URL/mdms-v2/v2/_search' || http_reachable '$PUBLIC_URL'"
  require "admin token can be minted (user=${ADMIN_USER}, tenant=${NOTIF_TENANT})" "_have_token"
  require "seed script exists" "test -f '$scripts/seed-notifications.py'"
  require "DDH source JSON present (schema + data)" "test -f '$ddh/schema/RAINMAKER-PGR.json'"

  # Single source of truth: the SAME JSON that ships in the default-data-handler
  # image. Copy it into a scoped dir the seeder reads from.
  log "Staging schema + Notification* data into notification-seed/…"
  run "mkdir + copy seed JSON" \
    "mkdir -p '$seeddir' && cp '$ddh/schema/RAINMAKER-PGR.json' '$ddh/mdmsData-dev/RAINMAKER-PGR/'RAINMAKER-PGR.Notification*.json '$seeddir/'"

  log "Seeding masters…"
  # seed-notifications.py env interface: DIGIT_URL/NOTIF_TENANT/DIGIT_USERNAME/
  # DIGIT_PASSWORD/SCHEMA_FILE/DATA_DIR. It auths with Basic egov-user-client: at
  # /user/oauth/token. Idempotent — re-runs skip already-present rows.
  run "run seed-notifications.py" \
    "cd '$scripts' && DIGIT_URL='$PUBLIC_URL' NOTIF_TENANT='$NOTIF_TENANT' DIGIT_USERNAME='$ADMIN_USER' DIGIT_PASSWORD='$ADMIN_PASS' SCHEMA_FILE='$seeddir/RAINMAKER-PGR.json' DATA_DIR='$seeddir' python3 seed-notifications.py"

  # Independent postcondition: count the rows ourselves and assert each >= 1.
  if [[ "$DRY_RUN" == true ]]; then
    verify "Routing/Template/ProviderTemplate rows >= 1 each" "true"
    return 0
  fi
  local tok; tok="$(mint_token)"
  local nr nt np
  nr="$(mdms_count RAINMAKER-PGR.NotificationRouting "$tok")"
  nt="$(mdms_count RAINMAKER-PGR.NotificationTemplate "$tok")"
  np="$(mdms_count RAINMAKER-PGR.NotificationProviderTemplate "$tok")"
  log "MDMS row counts — Routing=${nr} (expect 24), Template=${nt} (expect 42), ProviderTemplate=${np} (expect 14)"
  verify "NotificationRouting has >= 1 row (got ${nr})"          "[[ '${nr:-0}' -ge 1 ]]"
  verify "NotificationTemplate has >= 1 row (got ${nt})"         "[[ '${nt:-0}' -ge 1 ]]"
  verify "NotificationProviderTemplate has >= 1 row (got ${np})" "[[ '${np:-0}' -ge 1 ]]"
}

# =============================================================================
# STEP 7 — Add a provider + enter Twilio creds in Novu (SHOWCASE + VALIDATE).
#   This script NEVER handles the Twilio secrets. A human enters them in the Novu
#   dashboard (Integration Store → Twilio): Account SID + Auth token +
#   From = whatsapp:+<sender>, then Create Integration. We then VERIFY that a
#   Twilio integration WITH credentials exists — without ever reading the secrets.
# =============================================================================
do_step7() {
  step step7 "$(step_title step7)"
  require "novu-api reachable" "http_reachable '$NOVU_API_LOCAL'"

  warn "MANUAL: add the provider + enter Twilio credentials in Novu — this script will not."
  cat <<EOF
   ----------------------------------------------------------------------------
   Configurator → Notification Providers → Add   (or Novu dashboard → Integration
   Store → Twilio), then enter, server-side in Novu:
     Account SID : AC••••••••••••••••••••••••••••••   (your Twilio account)
     Auth token  : ••••••••••••••••••••••••••••••••   (never entered here)
     From        : whatsapp:+<your-approved-sender>
   → Create Integration.
   ----------------------------------------------------------------------------
EOF
  pause "Create the Twilio integration in Novu, then continue to verify it exists."

  # Postcondition: a Twilio integration with credentials exists. We read the
  # integration listing (which does NOT expose the secret token) and check that
  # a providerId=twilio integration with an accountSid is present.
  if [[ "$DRY_RUN" == true ]]; then verify "a Twilio integration exists in Novu" "true"; return 0; fi
  local key; key="$(_read_novu_key)"
  if [[ -z "$key" ]]; then err "no NOVU_API_KEY in .env — run step3 first"; return 1; fi
  verify "a Twilio integration with credentials exists in Novu" \
    "curl -s '$NOVU_API_LOCAL/v1/integrations' -H 'Authorization: ApiKey ${key}' | python3 -c 'import sys,json
d=json.load(sys.stdin); data=d.get(\"data\", d)
def walk(o):
 if isinstance(o,dict):
  if str(o.get(\"providerId\",\"\")).lower()==\"twilio\" and (o.get(\"credentials\") or {}).get(\"accountSid\"): return True
  return any(walk(v) for v in o.values())
 if isinstance(o,list): return any(walk(v) for v in o)
 return False
sys.exit(0 if walk(data) else 1)'"
  unset key
}

# =============================================================================
# STEP 8 — Create the per-channel Novu workflows.
#   act : POST complaints-sms (sms step), complaints-email (EMAIL step — NOT sms),
#         complaints-whatsapp (sms step) to $NOVU_API_LOCAL/v2/workflows if absent.
#   post: GET /v2/workflows lists all three with the right step types.
# =============================================================================
_ensure_workflow() {   # _ensure_workflow <workflowId> <steps-json>
  local wid="$1" steps="$2" key
  key="$(_read_novu_key)"
  [[ -n "$key" ]] || { err "no NOVU_API_KEY in .env — run step3 first"; return 1; }
  if curl -s "$NOVU_API_LOCAL/v2/workflows?limit=100" -H "Authorization: ApiKey $key" 2>/dev/null \
       | grep -q "\"workflowId\":\"$wid\""; then
    ok "workflow ${wid} already exists"
    return 0
  fi
  log "Creating workflow ${wid}…"
  local payload
  payload="$(printf '{"workflowId":"%s","name":"%s","active":true,"validatePayload":false,"isTranslationEnabled":false,"steps":%s}' "$wid" "$wid" "$steps")"
  curl -s -o /dev/null -w '' -X POST "$NOVU_API_LOCAL/v2/workflows" \
    -H "Authorization: ApiKey $key" -H "Content-Type: application/json" -d "$payload"
  unset key
}
do_step8() {
  step step8 "$(step_title step8)"
  require "a NOVU_API_KEY is available (step3 done)" "test -n \"\$(_read_novu_key)\""

  if [[ "$DRY_RUN" == true ]]; then
    log "Would create ${WF_SMS} (sms), ${WF_EMAIL} (email), ${WF_WA} (sms)"
    verify "all three workflows exist with correct step types" "true"
    return 0
  fi

  # sms/whatsapp use an `sms` step; email uses an `email` step (NOT sms — the
  # single most common mistake wiring these up).
  local sms_step='[{"name":"sms-step","type":"sms","controlValues":{"body":"{{ payload.body }}"}}]'
  local email_step='[{"name":"email-step","type":"email","controlValues":{"subject":"{{ payload.subject }}","body":"{{ payload.body }}","editorType":"html","disableOutputSanitization":true}}]'

  _ensure_workflow "$WF_SMS"   "$sms_step"
  _ensure_workflow "$WF_EMAIL" "$email_step"
  _ensure_workflow "$WF_WA"    "$sms_step"

  # Postcondition: all three present, each with the expected step type.
  local key; key="$(_read_novu_key)"
  verify "workflows ${WF_SMS}(sms) ${WF_EMAIL}(email) ${WF_WA}(sms) all present with right step types" \
    "curl -s '$NOVU_API_LOCAL/v2/workflows?limit=100' -H 'Authorization: ApiKey ${key}' | WF_SMS='$WF_SMS' WF_EMAIL='$WF_EMAIL' WF_WA='$WF_WA' python3 -c 'import os,sys,json
want={os.environ[\"WF_SMS\"]:\"sms\",os.environ[\"WF_EMAIL\"]:\"email\",os.environ[\"WF_WA\"]:\"sms\"}
d=json.load(sys.stdin); wfs=[]
def walk(o):
 if isinstance(o,dict):
  if \"workflowId\" in o and \"steps\" in o: wfs.append(o)
  for v in o.values(): walk(v)
 elif isinstance(o,list):
  for v in o: walk(v)
walk(d)
by={w.get(\"workflowId\"):w for w in wfs}
ok=True
for wid,t in want.items():
 w=by.get(wid); types=[s.get(\"type\") for s in (w.get(\"steps\") or [])] if w else []
 good=w is not None and t in types
 sys.stderr.write(\"     %-22s %s (steps=%s)\\n\"%(wid,\"OK\" if good else \"MISSING/BADTYPE\",\",\".join(map(str,types))))
 ok=ok and good
sys.exit(0 if ok else 1)'"
  unset key
}

# =============================================================================
# STEP 9 — Drive-and-verify via nb_dispatch_log.
#   We do NOT create a complaint automatically — a real send is a separate action.
#   We SHOWCASE the verify query and print any recent dispatch rows.
#   SENT = Novu accepted the trigger, NOT proof of delivery.
# =============================================================================
do_step9() {
  step step9 "$(step_title step9)"
  require "postgres container ${DB_CONTAINER} is reachable" \
    "sudo docker exec '$DB_CONTAINER' pg_isready -U '$DB_USER' >/dev/null 2>&1"

  log "Reading the last 10 nb_dispatch_log rows…"
  run "query nb_dispatch_log" \
    "sudo docker exec '$DB_CONTAINER' psql -U '$DB_USER' -d '$DB_NAME' -c \"select event_name,channel,status,last_error_code from nb_dispatch_log order by createdtime desc limit 10;\""

  note "SENT = Novu accepted the trigger — NOT proof of delivery. Drive a real"
  note "complaint through PGR to populate this log (that's a separate action)."

  verify "nb_dispatch_log table exists and is queryable" \
    "sudo docker exec '$DB_CONTAINER' psql -U '$DB_USER' -d '$DB_NAME' -c 'select 1 from nb_dispatch_log limit 1;' >/dev/null 2>&1 || sudo docker exec '$DB_CONTAINER' psql -U '$DB_USER' -d '$DB_NAME' -c \"select to_regclass('public.nb_dispatch_log');\" | grep -q nb_dispatch_log"
}

# =============================================================================
# PREFLIGHT — global preconditions. Always runs before any step (read-only/safe).
# =============================================================================
preflight() {
  printf '\n%s==> Preflight — validating the box before touching anything%s\n' "${C_BOLD}${C_CYN}" "${C_RESET}"
  require "docker is installed"                 "command -v docker >/dev/null 2>&1"
  require "docker compose v2 is available"       "docker compose version >/dev/null 2>&1 || sudo docker compose version >/dev/null 2>&1"
  require "DIGIT_HOME exists ($DIGIT_HOME)"       "test -d '$DIGIT_HOME'"

  # every compose file listed must exist under DIGIT_HOME
  local f
  for f in $COMPOSE_FILES; do
    require "compose file present ($f)" "test -f '$DIGIT_HOME/$f'"
  done

  require "CCRS checkout present ($CCRS_HOME)"    "test -d '$CCRS_HOME/local-setup' || test -d '$CCRS_HOME/.git'"
  require "$DIGIT_HOME/.env exists (root-owned)"  "sudo test -f '$DIGIT_HOME/.env'"

  # .env should be 600 — warn (don't abort) if it isn't.
  if [[ "$DRY_RUN" != true ]]; then
    local perms; perms="$(sudo stat -c '%a' "$DIGIT_HOME/.env" 2>/dev/null || echo '?')"
    if [[ "$perms" == "600" ]]; then ok "precondition: .env is mode 600"; else warn ".env is mode ${perms} (expected 600)"; fi
  fi

  require "public gateway reachable ($PUBLIC_URL)" "http_reachable '$PUBLIC_URL'"
  require "admin creds mint a token (user=$ADMIN_USER, tenant=$NOTIF_TENANT)" "_have_token"
  require "tenant resolves ($NOTIF_TENANT via MDMS)" "http_reachable '$PUBLIC_URL/mdms-v2/v2/_search' || _have_token"
}

# =============================================================================
# CLI.
# =============================================================================
usage() {
  cat <<EOF
enable-notifications.sh — enable config-driven PGR notifications (SMS/Email/WhatsApp)
on a running DIGIT/CCRS deployment. Self-narrating, resumable, validated.

USAGE:
  enable-notifications.sh [options]

OPTIONS:
  --list                Print the ordered steps and exit.
  --help, -h            Show this help and exit.
  --from  <step>        Run from <step> to the end (e.g. --from step4 or --from 4).
  --to    <step>        Run up to and including <step>.
  --only  <step[,...]>  Run only these steps (e.g. --only step6 or --only step6,step8).
  --dry-run             Print what would run; execute nothing.
  --yes                 Do not pause at the manual/showcase steps (5 and 7).
  --no-color            Disable coloured output (also honours NO_COLOR).

STEPS (run in order by default; preflight always runs first):
$(for s in "${ALL_STEPS[@]}"; do printf '  %-7s %s\n' "$s" "$(step_title "$s")"; done)

KEY ENV VARS (override on the command line; defaults are the reference-box values):
  DIGIT_HOME=$DIGIT_HOME   CCRS_HOME=$CCRS_HOME
  DIGIT_URL=$DIGIT_URL   (in-box gateway origin, host-local API calls)
  PUBLIC_URL=$PUBLIC_URL   (external origin — oauth + seed + ingress verify)
  NOTIF_TENANT=$NOTIF_TENANT   ADMIN_USER=$ADMIN_USER   ADMIN_PASS=******
  NOVU_API_LOCAL=$NOVU_API_LOCAL
  NOVU_BRIDGE_IMAGE=$NOVU_BRIDGE_IMAGE
  CHANNELS_ENABLED=$CHANNELS_ENABLED
  PROXY_ALLOWED_ROLES=$PROXY_ALLOWED_ROLES
  DB_CONTAINER=$DB_CONTAINER   DB_USER=$DB_USER   DB_NAME=$DB_NAME
  ENABLE_INGRESS=$ENABLE_INGRESS   DRY_RUN=$DRY_RUN

EXAMPLES:
  enable-notifications.sh --list
  enable-notifications.sh --from step4
  enable-notifications.sh --only step6
  enable-notifications.sh --dry-run
  PUBLIC_URL=http://1.2.3.4.nip.io ADMIN_USER=ADMIN enable-notifications.sh
EOF
}

list_steps() {
  printf 'Ordered steps (preflight always runs first):\n'
  local s
  for s in "${ALL_STEPS[@]}"; do
    printf '  [%s/%s] %-7s %s\n' "$(step_index "$s")" "${#ALL_STEPS[@]}" "$s" "$(step_title "$s")"
  done
}

CURRENT_STEP=""
_on_err() { err "ABORTED in ${CURRENT_STEP:-preflight} — see the failed require/verify above."; }

main() {
  local FROM="" TO="" ONLY=""
  while [[ $# -gt 0 ]]; do
    case "$1" in
      --list)     init_colors; list_steps; exit 0 ;;
      --help|-h)  init_colors; usage; exit 0 ;;
      --from)     FROM="$(normalize_step "$2")"; shift 2 ;;
      --to)       TO="$(normalize_step "$2")"; shift 2 ;;
      --only)     ONLY="$2"; shift 2 ;;
      --dry-run)  DRY_RUN=true; shift ;;
      --yes)      ASSUME_YES=true; shift ;;
      --no-color) NO_COLOR=1; shift ;;
      *) echo "unknown option: $1 (try --help)" >&2; exit 2 ;;
    esac
  done

  init_colors
  trap '_on_err' ERR

  # Build the compose helper — mirrors the runbook's `C=` (sudo docker compose -f …).
  local args="" f
  for f in $COMPOSE_FILES; do args+=" -f $f"; done
  DC="sudo docker compose${args}"

  # Resolve the step list to run.
  local -a RUN_STEPS=()
  if [[ -n "$ONLY" ]]; then
    local raw; IFS=',' read -r -a raw <<< "$ONLY"
    for f in "${raw[@]}"; do RUN_STEPS+=("$(normalize_step "$f")"); done
  else
    local start=1 end=${#ALL_STEPS[@]}
    [[ -n "$FROM" ]] && start="$(step_index "$FROM")"
    [[ -n "$TO"   ]] && end="$(step_index "$TO")"
    if [[ "$start" == "?" || "$end" == "?" ]]; then echo "bad --from/--to step" >&2; exit 2; fi
    RUN_STEPS=("${ALL_STEPS[@]:start-1:end-start+1}")
  fi

  printf '%s%s enable-notifications %s%s\n' "${C_BOLD}" "${C_CYN}" "$([[ "$DRY_RUN" == true ]] && echo '(DRY RUN)')" "${C_RESET}"
  log "tenant=${NOTIF_TENANT}  public=${PUBLIC_URL}  digit_home=${DIGIT_HOME}"
  log "running: ${RUN_STEPS[*]}"

  # Preflight always runs — it's read-only and validates the box.
  CURRENT_STEP="preflight"
  preflight

  local s
  for s in "${RUN_STEPS[@]}"; do
    CURRENT_STEP="$s"
    if ! declare -F "do_$s" >/dev/null; then err "no such step: $s"; exit 2; fi
    "do_$s"
  done

  CURRENT_STEP=""
  trap - ERR
  printf '\n%s✔ Done — ran: %s%s\n' "${C_GRN}${C_BOLD}" "${RUN_STEPS[*]}" "${C_RESET}"
}

main "$@"
