#!/usr/bin/env bash
# =============================================================================
# enable-escalation.sh
#
# Turn on pgr-services auto-escalation (EscalationScheduler) on a *running*
# DIGIT / CMS deployment. This is the scripted form of the runbook validated
# live against tenant `mz`. It does NOT build the pgr-services image — you
# provide an already-built/pushed image tag (PGR_SERVICES_IMAGE) — and it
# does NOT guess your org chart — you provide the case-manager -> supervisor
# UUID pair to link in HRMS (EMPLOYEE_UUID / SUPERVISOR_UUID).
#
# Each step is independent and non-dependent on the others having run in the
# same invocation: every step re-derives whatever it needs (a fresh token,
# a fresh business-service fetch, a fresh env read) rather than relying on
# in-memory state from an earlier step. Run them in any order, any subset,
# any number of times.
#
# Steps:
#   1. workflow-action     Add ESCALATE (self-loop, role SYSTEM) to a state
#                           on the target BusinessService. Idempotent — skips
#                           if that state already has an ESCALATE action.
#   2. mdms-check           Report whether RAINMAKER-PGR.EscalationConfig
#                           exists for TENANT. With ESCALATION_SEED=true,
#                           creates it (schema + data) from the committed
#                           JSON in utilities/default-data-handler if missing.
#   3. hrms-link            Point EMPLOYEE_UUID's current HRMS assignment at
#                           SUPERVISOR_UUID (reportingTo). Required inputs,
#                           no defaults — this is org-chart data, not a knob.
#   4. lookup-system-user   Discover the tenant's INTERNAL_MICROSERVICE_ROLE
#                           user uuid via egov-user (prints it; does not
#                           mutate anything). Feeds step 5 unless you already
#                           know SYSTEM_USER_UUID.
#   5. deploy               Set PGR_SERVICES_IMAGE / PGR_ESCALATION_STATES /
#                           EGOV_INTERNAL_MICROSERVICE_USER_UUID in the
#                           deployed compose + .env, then recreate pgr-services
#                           (--no-deps, so one-shot migration containers that
#                           already ran once are never re-triggered).
#   6. verify               Tail pgr-services logs for an escalation scan and
#                           report the last scan's scanned/escalated/skipped.
#
# Usage:
#   ./enable-escalation.sh --list                     # print steps + exit
#   ./enable-escalation.sh --only workflow-action      # just step 1
#   ./enable-escalation.sh --only hrms-link            # just step 3
#   ./enable-escalation.sh --from deploy               # steps 5..6
#   ./enable-escalation.sh --dry-run                   # print, run nothing
#
#   PGR_SERVICES_IMAGE=egovio/pgr-services:my-tag \
#   EMPLOYEE_UUID=eca6a910-... SUPERVISOR_UUID=97430b68-... \
#     ./enable-escalation.sh
#
# NOTE: PGR_SERVICES_IMAGE (step 5), EMPLOYEE_UUID + SUPERVISOR_UUID (step 3)
# have NO default — they must be supplied. Every other step/variable is
# tunable via env vars in the CONFIG block below.
# =============================================================================

set -euo pipefail

# -----------------------------------------------------------------------------
# CONFIG — every tunable is an env var with a sane default and a "# what it is".
# -----------------------------------------------------------------------------

# Filesystem + gateway.
DIGIT_HOME="${DIGIT_HOME:-/opt/digit}"                    # where the compose stack + .env live
DIGIT_URL="${DIGIT_URL:-http://localhost:18000}"          # in-box Kong gateway origin

# Tenant + admin identity.
TENANT="${TENANT:-mz}"                                    # tenant to operate on
ADMIN_USER="${ADMIN_USER:-ADMIN}"                         # admin user
ADMIN_PASS="${ADMIN_PASS:-eGov@123}"                      # admin password

# Workflow target (step 1).
BUSINESS_SERVICE="${BUSINESS_SERVICE:-PGR}"               # BusinessService code to patch
ESCALATE_STATE="${ESCALATE_STATE:-INVESTIGATION}"         # state to add the ESCALATE action to (self-loop)
ESCALATE_ROLE="${ESCALATE_ROLE:-SYSTEM}"                  # role allowed to fire it (matches the scheduler's RequestInfo)

# MDMS (step 2). No default seed — off unless explicitly requested.
ESCALATION_SEED="${ESCALATION_SEED:-false}"               # true = create schema+data if missing
MAX_DEPTH="${MAX_DEPTH:-3}"                               # only used when seeding
SLA_BY_LEVEL="${SLA_BY_LEVEL:-3600000,14400000,86400000}" # only used when seeding (ms, one per level)
REPO_ROOT="${REPO_ROOT:-$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)}"

# HRMS link (step 3). REQUIRED — no default, this is org-chart data.
EMPLOYEE_UUID="${EMPLOYEE_UUID:-}"                        # REQUIRED for step 3 — case manager (or any) employee uuid
SUPERVISOR_UUID="${SUPERVISOR_UUID:-}"                    # REQUIRED for step 3 — their new reportingTo target
DB_CONTAINER="${DB_CONTAINER:-docker-postgres}"           # postgres container name
DB_USER="${DB_USER:-egov}"                                # db user
DB_NAME="${DB_NAME:-egov}"                                # db name

# Deploy (step 5). PGR_SERVICES_IMAGE REQUIRED — this script never builds it.
PGR_SERVICES_IMAGE="${PGR_SERVICES_IMAGE:-}"              # REQUIRED for step 5 — pre-built/pushed image tag
PGR_ESCALATION_STATES="${PGR_ESCALATION_STATES:-INVESTIGATION}" # comma-separated applicationStatus values to scan
SYSTEM_USER_UUID="${SYSTEM_USER_UUID:-}"                  # optional — if empty, deploy runs lookup-system-user itself
COMPOSE_FILES="${COMPOSE_FILES:-docker-compose.egov-digit.yaml docker-compose.fast-path.yml docker-compose.migrations.yml docker-compose.monitoring.yml docker-compose.bomet.yml}"
COMPOSE_PROFILES="${COMPOSE_PROFILES:-mcp,notifications}"
PGR_SERVICE_NAME="${PGR_SERVICE_NAME:-pgr-services}"      # compose service name
PGR_CONTAINER="${PGR_CONTAINER:-digit-pgr-services-1}"    # actual container name (project-prefixed)

DRY_RUN="${DRY_RUN:-false}"                               # true = print commands, run nothing

BASIC_OAUTH="Basic ZWdvdi11c2VyLWNsaWVudDo="               # egov-user-client: (empty secret) — same for every DIGIT tenant

# -----------------------------------------------------------------------------
# Presentation helpers.
# -----------------------------------------------------------------------------
C_RESET=""; C_BOLD=""; C_RED=""; C_GRN=""; C_YEL=""; C_CYN=""; C_DIM=""
init_colors() {
  if [[ -n "${NO_COLOR:-}" ]] || [[ ! -t 1 ]]; then return; fi
  C_RESET=$'\033[0m'; C_BOLD=$'\033[1m'; C_RED=$'\033[31m'; C_GRN=$'\033[32m'
  C_YEL=$'\033[33m'; C_CYN=$'\033[36m'; C_DIM=$'\033[2m'
}
step()  { printf '\n%s==> [%s] %s%s\n' "${C_BOLD}${C_CYN}" "$1" "$2" "${C_RESET}"; }
log()   { printf '   %s%s%s\n' "${C_DIM}" "$*" "${C_RESET}"; }
ok()    { printf '   %s[ OK ]%s %s\n' "${C_GRN}" "${C_RESET}" "$*"; }
warn()  { printf '   %s[WARN]%s %s\n' "${C_YEL}" "${C_RESET}" "$*"; }
err()   { printf '   %s[FAIL]%s %s\n' "${C_RED}" "${C_RESET}" "$*" >&2; }
note()  { printf '   %sℹ  %s%s\n' "${C_DIM}" "$*" "${C_RESET}"; }

run() {
  local desc="$1"; shift
  local cmd="$*"
  log "$desc"
  if [[ "$DRY_RUN" == true ]]; then
    printf '   %s[dry-run]%s %s\n' "${C_YEL}" "${C_RESET}" "$cmd"
    return 0
  fi
  eval "$cmd"
}

require() {
  local desc="$1"; shift
  if [[ "$DRY_RUN" == true ]]; then printf '   %s[dry-run]%s require: %s\n' "${C_YEL}" "${C_RESET}" "$desc"; return 0; fi
  if eval "$@" >/dev/null 2>&1; then ok "precondition: $desc"; return 0
  else err "PRECONDITION FAILED: $desc"; return 1; fi
}

# -----------------------------------------------------------------------------
# Core helpers.
# -----------------------------------------------------------------------------
mint_token() {
  curl -s -X POST "$DIGIT_URL/user/oauth/token" \
    -H "Authorization: $BASIC_OAUTH" \
    -H "Content-Type: application/x-www-form-urlencoded" \
    --data-urlencode "grant_type=password" \
    --data-urlencode "username=$ADMIN_USER" \
    --data-urlencode "password=$ADMIN_PASS" \
    --data-urlencode "tenantId=$TENANT" \
    --data-urlencode "scope=read" \
    --data-urlencode "userType=EMPLOYEE" 2>/dev/null \
  | python3 -c 'import sys,json
try: print(json.load(sys.stdin).get("access_token","") or "")
except Exception: print("")' 2>/dev/null
}

db_psql() {
  # db_psql <sql> — run a SQL statement in $DB_CONTAINER, print tuples-only output.
  # No -it here: every call site captures stdout via $(...), and -t needs a
  # real TTY, which a captured subprocess doesn't have — it fails hard with
  # "the input device is not a TTY". For interactive ad-hoc use, run
  # `sudo docker exec -it "$DB_CONTAINER" psql -U "$DB_USER" -d "$DB_NAME"` by hand instead.
  sudo docker exec "$DB_CONTAINER" psql -U "$DB_USER" -d "$DB_NAME" -tAc "$1"
}

compose() {
  local files=() f
  for f in $COMPOSE_FILES; do files+=(-f "$f"); done
  run "compose $*" "cd '$DIGIT_HOME' && sudo COMPOSE_PROFILES='$COMPOSE_PROFILES' docker compose ${files[*]} $*"
}

# =============================================================================
# STEP 1 — workflow-action: add ESCALATE (self-loop) to ESCALATE_STATE.
#   pre : token mints; BusinessService exists for TENANT
#   act : fetch BusinessService, append the action if not already present
#   post: DB shows the action with the expected role
# =============================================================================
do_workflow_action() {
  step "workflow-action" "Add ESCALATE ($ESCALATE_STATE self-loop, role $ESCALATE_ROLE) to $BUSINESS_SERVICE / $TENANT"

  local tok; tok=$(mint_token)
  require "obtained an admin token for tenant $TENANT" '[[ -n "$tok" ]]' || return 1

  log "Fetching $BUSINESS_SERVICE business service for $TENANT…"
  local bs_json
  bs_json=$(curl -s -X POST "$DIGIT_URL/egov-workflow-v2/egov-wf/businessservice/_search?tenantId=$TENANT&businessServices=$BUSINESS_SERVICE" \
    -H 'Content-Type: application/json' \
    -d "{\"RequestInfo\":{\"apiId\":\"enable-escalation\",\"authToken\":\"$tok\"}}")

  local already
  already=$(python3 -c "
import json,sys
d = json.loads('''$bs_json''')
bs = d['BusinessServices'][0]
for s in bs['states']:
    if s.get('state') == '$ESCALATE_STATE':
        print('yes' if any(a['action']=='ESCALATE' for a in (s.get('actions') or [])) else 'no')
        break
else:
    print('no-state')
")

  if [[ "$already" == "yes" ]]; then
    ok "ESCALATE already present on $ESCALATE_STATE — nothing to do"
    return 0
  fi
  if [[ "$already" == "no-state" ]]; then
    err "state $ESCALATE_STATE not found on $BUSINESS_SERVICE for $TENANT"
    return 1
  fi

  log "Appending ESCALATE action and pushing the update…"
  if [[ "$DRY_RUN" == true ]]; then
    printf '   %s[dry-run]%s would POST businessservice/_update with ESCALATE added to %s\n' "${C_YEL}" "${C_RESET}" "$ESCALATE_STATE"
    return 0
  fi
  local update_payload
  update_payload=$(python3 -c "
import json
d = json.loads('''$bs_json''')
bs = d['BusinessServices'][0]
for s in bs['states']:
    if s.get('state') == '$ESCALATE_STATE':
        s['actions'].append({'tenantId': '$TENANT', 'currentState': s['uuid'], 'action': 'ESCALATE',
                              'nextState': s['uuid'], 'roles': ['$ESCALATE_ROLE'], 'active': True})
print(json.dumps({'RequestInfo': {'apiId': 'enable-escalation', 'authToken': '$tok'}, 'BusinessServices': [bs]}))
")
  curl -s -X POST "$DIGIT_URL/egov-workflow-v2/egov-wf/businessservice/_update" \
    -H 'Content-Type: application/json' -d "$update_payload" >/dev/null

  # workflow-v2's businessservice/_update returns 200 once the write is
  # accepted, not once it's visible in postgres (same async persist-then-index
  # lag PGR's own records have) — poll briefly instead of checking once.
  local roles i=0
  while [[ $i -lt 10 ]]; do
    roles=$(db_psql "
select a.roles from eg_wf_businessservice_v2 b
join eg_wf_state_v2 s on s.businessserviceid=b.uuid
join eg_wf_action_v2 a on a.currentstate=s.uuid
where b.businessservice='$BUSINESS_SERVICE' and b.tenantid='$TENANT' and s.state='$ESCALATE_STATE' and a.action='ESCALATE';")
    [[ -n "$roles" ]] && break
    sleep 1; i=$((i+1))
  done
  if [[ "$roles" == *"$ESCALATE_ROLE"* ]]; then
    ok "verified: ESCALATE on $ESCALATE_STATE now has role(s) $roles"
  else
    err "ESCALATE action not found after update (waited ${i}s)"
    return 1
  fi
}

# =============================================================================
# STEP 2 — mdms-check: report (and optionally seed) RAINMAKER-PGR.EscalationConfig.
# =============================================================================
do_mdms_check() {
  step "mdms-check" "Check RAINMAKER-PGR.EscalationConfig for $TENANT"

  local tok; tok=$(mint_token)
  require "obtained an admin token for tenant $TENANT" '[[ -n "$tok" ]]' || return 1

  local data
  data=$(curl -s -X POST "$DIGIT_URL/mdms-v2/v2/_search" -H 'Content-Type: application/json' \
    -d "{\"RequestInfo\":{\"apiId\":\"enable-escalation\",\"authToken\":\"$tok\"},\"MdmsCriteria\":{\"tenantId\":\"$TENANT\",\"schemaCode\":\"RAINMAKER-PGR.EscalationConfig\",\"limit\":50}}")
  local count
  count=$(python3 -c "import json,sys; print(len(json.loads('''$data'''.strip()).get('mdms',[])))" 2>/dev/null || echo -1)

  if [[ "$count" -gt 0 ]]; then
    ok "EscalationConfig already present for $TENANT ($count row(s))"
    log "$(echo "$data" | python3 -m json.tool 2>/dev/null | head -20)"
    return 0
  fi

  warn "EscalationConfig missing for $TENANT"
  if [[ "$ESCALATION_SEED" != true ]]; then
    note "not seeding (ESCALATION_SEED=false) — pgr-services will fall back to its flat default SLA"
    return 0
  fi

  log "Seeding schema (if needed) + one data row: maxDepth=$MAX_DEPTH, defaultSlaByLevel=[$SLA_BY_LEVEL]"
  if [[ "$DRY_RUN" == true ]]; then
    printf '   %s[dry-run]%s would create schema + data from %s/utilities/default-data-handler/src/main/resources/schema/RAINMAKER-PGR.json\n' "${C_YEL}" "${C_RESET}" "$REPO_ROOT"
    return 0
  fi
  python3 - "$DIGIT_URL" "$TENANT" "$tok" "$REPO_ROOT" "$MAX_DEPTH" "$SLA_BY_LEVEL" <<'PYEOF'
import json, sys, urllib.request

url, tenant, tok, repo_root, max_depth, sla_by_level = sys.argv[1:7]

def post(path, body):
    req = urllib.request.Request(url + path, data=json.dumps(body).encode(),
                                  headers={"Content-Type": "application/json"})
    return urllib.request.urlopen(req, timeout=30)

ri = {"apiId": "enable-escalation", "authToken": tok}

schemas = json.load(open(f"{repo_root}/utilities/default-data-handler/src/main/resources/schema/RAINMAKER-PGR.json"))
schema = next(s for s in schemas if s["code"] == "RAINMAKER-PGR.EscalationConfig")
schema = dict(schema); schema["tenantId"] = tenant
defn = dict(schema.get("definition") or {})
if defn.get("x-ref-schema") == []:
    defn.pop("x-ref-schema", None)
    schema["definition"] = defn

try:
    post("/mdms-v2/schema/v1/_create", {"RequestInfo": ri, "SchemaDefinition": schema}).read()
    print("schema created")
except Exception as e:
    print(f"schema create skipped/failed (likely already exists): {e}")

row = {"maxDepth": int(max_depth), "defaultSlaByLevel": [int(x) for x in sla_by_level.split(",")], "overrides": {}}
body = {"RequestInfo": ri, "Mdms": {"tenantId": tenant, "schemaCode": "RAINMAKER-PGR.EscalationConfig", "data": row, "isActive": True}}
post("/mdms-v2/v2/_create/RAINMAKER-PGR.EscalationConfig", body).read()
print("data row created")
PYEOF
  ok "EscalationConfig seeded for $TENANT"
}

# =============================================================================
# STEP 3 — hrms-link: EMPLOYEE_UUID's current assignment reportingTo -> SUPERVISOR_UUID.
#   REQUIRED inputs, no defaults — this is org-chart data, not a knob.
# =============================================================================
do_hrms_link() {
  step "hrms-link" "Link EMPLOYEE_UUID -> SUPERVISOR_UUID in HRMS reportingTo"

  require "EMPLOYEE_UUID is set" '[[ -n "$EMPLOYEE_UUID" ]]' || { err "set EMPLOYEE_UUID=<uuid>"; return 1; }
  require "SUPERVISOR_UUID is set" '[[ -n "$SUPERVISOR_UUID" ]]' || { err "set SUPERVISOR_UUID=<uuid>"; return 1; }

  run "UPDATE eg_hrms_assignment.reportingto for $EMPLOYEE_UUID" \
    "db_psql \"UPDATE eg_hrms_assignment SET reportingto='$SUPERVISOR_UUID' WHERE employeeid='$EMPLOYEE_UUID' AND iscurrentassignment=true;\""

  local got
  got=$(db_psql "select reportingto from eg_hrms_assignment where employeeid='$EMPLOYEE_UUID' and iscurrentassignment=true;")
  if [[ "$got" == "$SUPERVISOR_UUID" ]]; then
    ok "verified: $EMPLOYEE_UUID now reports to $SUPERVISOR_UUID"
  else
    err "reportingTo is '$got', expected '$SUPERVISOR_UUID'"
    return 1
  fi
}

# =============================================================================
# STEP 4 — lookup-system-user: discover the tenant's INTERNAL_MICROSERVICE_ROLE uuid.
#   Read-only. Prints the uuid on success; used by `deploy` unless
#   SYSTEM_USER_UUID is already set.
# =============================================================================
do_lookup_system_user() {
  step "lookup-system-user" "Discover INTERNAL_MICROSERVICE_ROLE user uuid for $TENANT"

  local uuid
  uuid=$(db_psql "
select u.uuid from eg_user u
join eg_userrole_v1 r on r.user_id = u.id
where r.role_code='INTERNAL_MICROSERVICE_ROLE' and r.user_tenantid like '${TENANT}%' and u.type='SYSTEM' and u.active=true
limit 1;")

  if [[ -z "$uuid" ]]; then
    err "no active SYSTEM user with role INTERNAL_MICROSERVICE_ROLE found for tenant $TENANT"
    return 1
  fi
  ok "INTERNAL_MICROSERVICE_ROLE uuid for $TENANT: $uuid"
  echo "$uuid"
}

# =============================================================================
# STEP 5 — deploy: point the running compose stack at PGR_SERVICES_IMAGE with
# escalation config, and recreate pgr-services. Never builds an image.
# =============================================================================
do_deploy() {
  step "deploy" "Deploy $PGR_SERVICE_NAME with escalation config"

  require "PGR_SERVICES_IMAGE is set" '[[ -n "$PGR_SERVICES_IMAGE" ]]' || { err "set PGR_SERVICES_IMAGE=<tag> (this script does not build images)"; return 1; }

  local sys_uuid="$SYSTEM_USER_UUID"
  if [[ -z "$sys_uuid" ]]; then
    note "SYSTEM_USER_UUID not set — running lookup-system-user"
    sys_uuid=$(do_lookup_system_user | tail -n1)
    [[ -n "$sys_uuid" ]] || { err "could not resolve SYSTEM_USER_UUID; pass it explicitly"; return 1; }
  fi

  log "Setting PGR_SERVICES_IMAGE in .env…"
  if [[ "$DRY_RUN" == true ]]; then
    printf '   %s[dry-run]%s would set PGR_SERVICES_IMAGE=%s in %s/.env\n' "${C_YEL}" "${C_RESET}" "$PGR_SERVICES_IMAGE" "$DIGIT_HOME"
  else
    if sudo grep -qE '^PGR_SERVICES_IMAGE=' "$DIGIT_HOME/.env" 2>/dev/null; then
      sudo sed -i "s|^PGR_SERVICES_IMAGE=.*|PGR_SERVICES_IMAGE=${PGR_SERVICES_IMAGE}|" "$DIGIT_HOME/.env"
    else
      printf 'PGR_SERVICES_IMAGE=%s\n' "$PGR_SERVICES_IMAGE" | sudo tee -a "$DIGIT_HOME/.env" >/dev/null
    fi
  fi

  log "Ensuring PGR_ESCALATION_STATES / EGOV_INTERNAL_MICROSERVICE_USER_UUID are set in the compose file…"
  if [[ "$DRY_RUN" == true ]]; then
    printf '   %s[dry-run]%s would set PGR_ESCALATION_STATES=%s and EGOV_INTERNAL_MICROSERVICE_USER_UUID=%s in %s/docker-compose.egov-digit.yaml\n' \
      "${C_YEL}" "${C_RESET}" "$PGR_ESCALATION_STATES" "$sys_uuid" "$DIGIT_HOME"
  else
    local compose_file="$DIGIT_HOME/docker-compose.egov-digit.yaml"
    if sudo grep -qE '^\s*PGR_ESCALATION_STATES:' "$compose_file"; then
      sudo sed -i "s|^\(\s*\)PGR_ESCALATION_STATES:.*|\1PGR_ESCALATION_STATES: ${PGR_ESCALATION_STATES}|" "$compose_file"
    else
      sudo sed -i "/PGR_ESCALATION_ENABLED: 'true'/a\\      PGR_ESCALATION_STATES: ${PGR_ESCALATION_STATES}" "$compose_file"
    fi
    if sudo grep -qE '^\s*EGOV_INTERNAL_MICROSERVICE_USER_UUID:' "$compose_file"; then
      sudo sed -i "s|^\(\s*\)EGOV_INTERNAL_MICROSERVICE_USER_UUID:.*|\1EGOV_INTERNAL_MICROSERVICE_USER_UUID: ${sys_uuid}|" "$compose_file"
    else
      sudo sed -i "/PGR_ESCALATION_STATES:/a\\      EGOV_INTERNAL_MICROSERVICE_USER_UUID: ${sys_uuid}" "$compose_file"
    fi
  fi

  compose up -d --no-deps "$PGR_SERVICE_NAME"

  if [[ "$DRY_RUN" != true ]]; then
    log "Waiting for $PGR_CONTAINER to report healthy…"
    local i=0
    until [[ "$(docker inspect "$PGR_CONTAINER" --format '{{.State.Health.Status}}' 2>/dev/null)" == "healthy" ]]; do
      sleep 3; i=$((i+1))
      [[ $i -gt 40 ]] && { err "$PGR_CONTAINER did not become healthy in time"; return 1; }
    done
    ok "$PGR_CONTAINER is healthy"
  fi
}

# =============================================================================
# STEP 6 — verify: tail logs for the last escalation scan.
# =============================================================================
do_verify() {
  step "verify" "Check pgr-services logs for the latest escalation scan"
  # Right after a (re)start, the health check can pass slightly before the
  # scheduler's first @Scheduled run has logged its completion line (Kafka
  # group join + MDMS fetch take a couple seconds) — poll briefly rather than
  # checking once, same eventual-consistency shape as workflow-action's verify.
  local last i=0
  while [[ $i -lt 20 ]]; do
    last=$(docker logs "$PGR_CONTAINER" 2>&1 | grep "Escalation scan complete" | tail -n1 || true)
    [[ -n "$last" ]] && break
    sleep 3; i=$((i+1))
  done
  if [[ -z "$last" ]]; then
    warn "no completed escalation scan found after waiting $((i*3))s in $PGR_CONTAINER logs"
    return 1
  fi
  ok "$last"
}

# =============================================================================
# main — dispatcher.
# =============================================================================
ALL_STEPS=(workflow-action mdms-check hrms-link lookup-system-user deploy verify)
run_step() {
  case "$1" in
    workflow-action)   do_workflow_action ;;
    mdms-check)         do_mdms_check ;;
    hrms-link)          do_hrms_link ;;
    lookup-system-user) do_lookup_system_user ;;
    deploy)             do_deploy ;;
    verify)             do_verify ;;
    *) err "unknown step: $1"; return 1 ;;
  esac
}

usage() {
  sed -n '2,45p' "$0" | sed 's/^# \?//'
}

main() {
  init_colors
  local -a run_list=()
  local from="" to="" only=""

  while [[ $# -gt 0 ]]; do
    case "$1" in
      --dry-run) DRY_RUN=true; shift ;;
      --list) printf '%s\n' "${ALL_STEPS[@]}"; exit 0 ;;
      --help|-h) usage; exit 0 ;;
      --only) only="$2"; shift 2 ;;
      --from) from="$2"; shift 2 ;;
      --to) to="$2"; shift 2 ;;
      *) err "unknown argument: $1"; usage; exit 1 ;;
    esac
  done

  if [[ -n "$only" ]]; then
    IFS=',' read -r -a run_list <<< "$only"
  elif [[ -n "$from" || -n "$to" ]]; then
    local start=0 end=$(( ${#ALL_STEPS[@]} - 1 )) i
    for i in "${!ALL_STEPS[@]}"; do
      [[ -n "$from" && "${ALL_STEPS[$i]}" == "$from" ]] && start=$i
      [[ -n "$to" && "${ALL_STEPS[$i]}" == "$to" ]] && end=$i
    done
    run_list=("${ALL_STEPS[@]:start:end-start+1}")
  else
    run_list=("${ALL_STEPS[@]}")
  fi

  printf '%s%s enable-escalation %s%s\n' "${C_BOLD}${C_CYN}" "$([[ "$DRY_RUN" == true ]] && echo '(DRY RUN)')" "tenant=$TENANT" "${C_RESET}"
  local step_name failed=0
  for step_name in "${run_list[@]}"; do
    if ! run_step "$step_name"; then
      err "step '$step_name' failed"
      failed=1
      break
    fi
  done

  echo
  if [[ $failed -eq 0 ]]; then ok "done"; else err "stopped on failure"; exit 1; fi
}

main "$@"
