#!/usr/bin/env bash
# =============================================================================
# enable-dashboard.sh
#
# Turn on the supervisor dashboard on a *running* DIGIT / CCRS deployment.
# This is the installer form of the "enable the supervisor dashboard" runbook
# (issue #631), which was written from two live enablements: bomet (`ke`, the
# reference deployment) and moz (`mz`, the from-scratch case, #1166).
#
# It does NOT build images and does NOT deploy the stack. It assumes DIGIT is
# already up with a dashboard-capable pgr-services and a UI bundle that embeds
# products/dashboard/, and it seeds the CONFIG layers that make the dashboard
# actually appear and render:
#
#   1. Register the three dss schemas (KpiDefinition, DashboardPack,
#      DashboardConfig) in mdms-v2
#   2. Seed the KPI catalog — 39 defs + 1 pack — with rbac roles remapped to
#      roles that exist on THIS deployment (see "ROLES" below)
#   3. Seed dss.DashboardConfig (nav/route allowedRoles, numberFormat, and the
#      departmentScoping escape hatch)
#   4. Grant the sidebar action (id 4557) to each gate-passing role
#   5. Seed localization — the 315-message rainmaker-dashboard pack per locale
#      plus the two rainmaker-common nav labels — then cache-bust
#   6. Flush the oauth token store (mandatory after ANY role grant)
#   7. Verify end-to-end (catalog/_search, /packs, /_query, all-keys-resolve)
#
# WHY A SCRIPT AND NOT tenant_bootstrap: bootstrap covers a NEW state root by
# copying dss.* from a source root (digit-mcp, since #1062). That does nothing
# for (a) deployments bootstrapped before #1062, (b) roots whose SOURCE has no
# catalog — copying zero records "successfully" is exactly how moz ended up
# with an empty dashboard, and (c) any deployment whose role taxonomy differs
# from the seed's. This script seeds from the repo files instead, so it does
# not depend on another tenant already being correct.
#
# ROLES — the one judgement call, and why the default is what it is.
#
#   The repo seed (ansible/nairobi-mdms/mdms/dss/*.json) is authored against
#   the CANONICAL CCRS role taxonomy — PGR_SUPERVISOR, PGR_ADMIN, PGR_LME,
#   GRO, DGRO, SUPERVISOR, SUPERUSER — and that is what this script uses by
#   default. It is the right default because it matches a stock CCRS install,
#   it matches the FE's own fallback gate, and it is the shape every other
#   seed file in the repo assumes.
#
#   Deployments that predate CCRS or that were onboarded with their own
#   taxonomy (moz: CMS_SUPERVISOR / CMS_CASE_MANAGER / CMS_RECEPTION_OFFICER)
#   must remap, via ROLE_MAP:
#
#     ROLE_MAP="PGR_SUPERVISOR=CMS_SUPERVISOR,PGR_LME=CMS_CASE_MANAGER"
#
#   The remap is applied to every rbac.visibleTo entry in the catalog, to the
#   pack personas, and to DASHBOARD_ALLOWED_ROLES. NEVER invent a role: a KPI
#   visible only to a role nobody holds is invisible, and a sidebar link for a
#   role that fails the FE gate is a link that bounces. Step 0 therefore
#   counts live holders for every target role and STOPS if any has none
#   (override with ALLOW_EMPTY_ROLES=true if you are seeding ahead of an HRMS
#   import).
#
# Usage:
#   ./enable-dashboard.sh                      # run all steps in order
#   ./enable-dashboard.sh --list               # print the ordered steps + exit
#   ./enable-dashboard.sh --help               # full help
#   ./enable-dashboard.sh --dry-run            # print what it WOULD do
#   ./enable-dashboard.sh --only step5         # just (re)seed localization
#   ./enable-dashboard.sh --from step4         # resume from step 4
#   ./enable-dashboard.sh --repair             # deactivate corrupt dss rows first
#   ./enable-dashboard.sh --update             # _update records that already exist
#   DASHBOARD_TENANT=mz ROLE_MAP="PGR_SUPERVISOR=CMS_SUPERVISOR" ./enable-dashboard.sh
#
# Idempotent: re-runs report existing records as skipped. By DEFAULT it does
# NOT overwrite a live record that already exists — see --update and the
# "stale catalog" note in docs/dashboard-configuration/60-operations.md §4.
#
# RUNBOOK: the full operator runbook — prerequisites, the role-remap decision,
# the data caveats that make a correct seed look broken, and a symptom -> cause
# table for every known blocker — is posted as a comment on the enablement PR
# (#1400) and graduates into docs/dashboard-configuration/ on merge. Read it
# before a first run on an unfamiliar deployment.
# =============================================================================

set -euo pipefail

# -----------------------------------------------------------------------------
# CONFIG — every tunable is an env var with a default and a "# what it is".
# -----------------------------------------------------------------------------

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="${REPO_ROOT:-$(cd "$SCRIPT_DIR/../.." && pwd)}"   # CCRS checkout holding the seed files

# Seed sources. The catalog data is read from the ansible seed dir rather than
# copied into this directory ON PURPOSE: two copies of the KPI catalog is how
# "works on bomet, empty on the repro box" happens (60-operations.md §4).
DSS_DATA_DIR="${DSS_DATA_DIR:-$REPO_ROOT/ansible/nairobi-mdms/mdms/dss}"
DSS_SCHEMA_DIR="${DSS_SCHEMA_DIR:-$REPO_ROOT/local-setup/db/dss-mdms-seed/schemas}"
DSS_L10N_DIR="${DSS_L10N_DIR:-$REPO_ROOT/local-setup/db/dss-mdms-seed/l10n}"

# Origins. ALL MDMS writes go to the mdms-v2 DIRECT port, never through Kong:
# Kong's cjson serialization turns an empty JSON array into `{}`, which
# corrupts array-valued fields on the way in (see reference: Kong cjson
# empty-array trap, #1038).
MDMS_URL="${MDMS_URL:-http://localhost:18094}"            # mdms-v2 direct — NEVER Kong
LOCALIZATION_URL="${LOCALIZATION_URL:-http://localhost:18096}"  # egov-localization direct (cache-bust needs this)
DIGIT_URL="${DIGIT_URL:-http://localhost:18000}"          # Kong gateway — oauth + the pgr-services verifies
PGR_URL="${PGR_URL:-$DIGIT_URL}"                          # origin serving /pgr-services/v2/analytics

# Tenant + admin identity. Author ALL dashboard config at the STATE ROOT:
# KpiCatalogService collapses a city tenant to its root, so city tenants
# inherit automatically and a city-level record is dead weight.
DASHBOARD_TENANT="${DASHBOARD_TENANT:-ke}"                # state-root tenant
ADMIN_USER="${ADMIN_USER:-SUPERADMIN}"                    # SUPERADMIN on a DDH-seeded box, ADMIN on an MCP-bootstrapped one
ADMIN_PASS="${ADMIN_PASS:-eGov@123}"

# Roles. See the ROLES block in the header for why the default is canonical.
ROLE_MAP="${ROLE_MAP:-}"                                  # "SRC=DST,SRC=DST" applied to catalog rbac + pack + allowedRoles
DASHBOARD_ALLOWED_ROLES="${DASHBOARD_ALLOWED_ROLES:-SUPERVISOR,PGR_SUPERVISOR,GRO,DGRO,PGR_LME,PGR_ADMIN,SUPERUSER}"
# ^ dss.DashboardConfig.allowedRoles — the route/card gate (#1258). Pre-#1258
#   bundles ignore this and use the identical hardcoded list, so keeping the
#   default aligned with the FE fallback means both eras behave the same.
ALLOW_EMPTY_ROLES="${ALLOW_EMPTY_ROLES:-false}"           # true = don't stop when a target role has no holders

# Department scoping (#1280). Employees are scoped to their HRMS department;
# where complaint facts carry no department_code, every scoped employee sees an
# empty dashboard. "disabled" widens visibility for ALL employees on the tenant
# — a deliberate, temporary trade. Leave empty to keep enforcement.
DEPARTMENT_SCOPING="${DEPARTMENT_SCOPING:-}"              # "" (enforce) | disabled

# Localization.
DASHBOARD_LOCALES="${DASHBOARD_LOCALES:-}"                # comma list; default = every locale with a pack in DSS_L10N_DIR
L10N_BATCH="${L10N_BATCH:-200}"                           # messages per _upsert call

# Sidebar action. 4557 is the dashboard action id shipped in the ACCESSCONTROL
# seed; override if your deployment renumbered actions.
DASHBOARD_ACTION_ID="${DASHBOARD_ACTION_ID:-4557}"

# Postgres — used ONLY for read-only preflight facts (role holders, fact
# departments, corrupt-row detection). Every write goes through an API.
DB_CONTAINER="${DB_CONTAINER:-docker-postgres}"
DB_USER="${DB_USER:-egov}"
DB_NAME="${DB_NAME:-egov}"
REDIS_CONTAINER="${REDIS_CONTAINER:-digit-redis}"
SUDO="${SUDO:-sudo}"                                      # set SUDO="" if docker needs no sudo here

# Behaviour flags.
DRY_RUN="${DRY_RUN:-false}"
DO_REPAIR="${DO_REPAIR:-false}"                           # --repair: deactivate schema-as-data rows before seeding
DO_UPDATE="${DO_UPDATE:-false}"                           # --update: _update records that already exist
SKIP_TOKEN_FLUSH="${SKIP_TOKEN_FLUSH:-false}"             # true = leave sessions alone (grants stay invisible!)

BASIC_OAUTH="Basic ZWdvdi11c2VyLWNsaWVudDo="              # egov-user-client: (empty secret)

ALL_STEPS=(step0 step1 step2 step3 step4 step5 step6 step7)
STEP_TITLES=(
  "Preflight — capability, roles, data"
  "Register the dss schemas"
  "Seed the KPI catalog (defs + pack)"
  "Seed dss.DashboardConfig (nav gate + formats)"
  "Grant the sidebar action per role"
  "Seed localization + cache-bust"
  "Flush the oauth token store"
  "Verify end-to-end"
)

# =============================================================================
# Presentation helpers — same conventions as enable-notifications.sh.
# =============================================================================
C_RESET=""; C_BOLD=""; C_RED=""; C_GRN=""; C_YEL=""; C_CYN=""; C_DIM=""
init_colors() {
  if [[ -n "${NO_COLOR:-}" ]] || [[ ! -t 1 ]]; then return; fi
  C_RESET=$'\033[0m'; C_BOLD=$'\033[1m'; C_RED=$'\033[31m'; C_GRN=$'\033[32m'
  C_YEL=$'\033[33m'; C_CYN=$'\033[36m'; C_DIM=$'\033[2m'
}
step_index() { local i=0; for s in "${ALL_STEPS[@]}"; do i=$((i+1)); [[ "$s" == "$1" ]] && { echo "$i"; return; }; done; echo '?'; }
step()  { printf '\n%s==> [%s/%s] %s%s\n' "${C_BOLD}${C_CYN}" "$(step_index "$1")" "${#ALL_STEPS[@]}" "$2" "${C_RESET}"; }
log()   { printf '   %s%s%s\n' "${C_DIM}" "$*" "${C_RESET}"; }
ok()    { printf '   %s[ OK ]%s %s\n' "${C_GRN}" "${C_RESET}" "$*"; }
warn()  { printf '   %s[WARN]%s %s\n' "${C_YEL}" "${C_RESET}" "$*"; }
err()   { printf '   %s[FAIL]%s %s\n' "${C_RED}" "${C_RESET}" "$*" >&2; }
note()  { printf '   %sℹ  %s%s\n' "${C_DIM}" "$*" "${C_RESET}"; }

psql_q() { $SUDO docker exec "$DB_CONTAINER" psql -U "$DB_USER" -d "$DB_NAME" -tAc "$1" 2>/dev/null; }
http_code() { curl -s -o /dev/null -w '%{http_code}' --max-time 15 "$@" 2>/dev/null || echo 000; }

# =============================================================================
# Auth. mdms-v2 needs the FULL UserRequest as RequestInfo.userInfo — Spring's
# enrichAuditDetails throws NullCheckException on a bare authToken, and a
# partial userInfo yields a null uuid in auditDetails (reference: boundary
# UserInfo-null == expired token, #984).
# =============================================================================
REQUEST_INFO=""
mint_request_info() {
  local resp
  resp="$(curl -fsS -X POST "$DIGIT_URL/user/oauth/token" \
    -H "Authorization: $BASIC_OAUTH" \
    -H 'Content-Type: application/x-www-form-urlencoded' \
    --data-urlencode "username=$ADMIN_USER" \
    --data-urlencode "password=$ADMIN_PASS" \
    --data-urlencode "grant_type=password" \
    --data-urlencode "scope=read" \
    --data-urlencode "tenantId=$DASHBOARD_TENANT" \
    --data-urlencode "userType=EMPLOYEE")" || {
      err "oauth token mint failed for $ADMIN_USER@$DASHBOARD_TENANT at $DIGIT_URL"
      note "On a DDH-seeded box the admin is SUPERADMIN; on an MCP-bootstrapped one it is ADMIN."
      return 1
    }
  REQUEST_INFO="$(printf '%s' "$resp" | jq -c '{apiId:"Rainmaker", ver:".01", msgId:"dashboard-enable",
    authToken:.access_token, userInfo:.UserRequest}')"
  AUTH_TOKEN="$(printf '%s' "$resp" | jq -r '.access_token')"
}

# mdms_post <path> <json-body-file> — POST to mdms-v2 direct, echo the body.
mdms_post() {
  curl -s -X POST "$MDMS_URL$1" -H 'Content-Type: application/json' --max-time 60 --data-binary "@$2"
}

# mdms_search <schemaCode> [uid] — search records, echo the response.
#
# The schemaCode goes in the CRITERIA, not the path: `POST /mdms-v2/v2/_search/
# <schema>` is not a route and 400/404s with "No static resource". Only the
# WRITE endpoints (_create/_update) take the schema as a path suffix. Same
# convention the integration tests document at
# tests/integration-tests/tests/utils/probes.ts:423.
mdms_search() {
  local code="$1" uid="${2:-}" criteria
  criteria="$(jq -nc --arg t "$DASHBOARD_TENANT" --arg c "$code" --arg u "$uid" \
    '{tenantId:$t, schemaCode:$c, limit:500} + (if $u == "" then {} else {uniqueIdentifiers:[$u]} end)')"
  curl -s -X POST "$MDMS_URL/mdms-v2/v2/_search" -H 'Content-Type: application/json' --max-time 30 \
    -d "$(jq -nc --argjson ri "$REQUEST_INFO" --argjson mc "$criteria" '{RequestInfo:$ri, MdmsCriteria:$mc}')"
}

# mdms_first_record <schemaCode> [uid] — echo the first FULL record object, or
# nothing. Returning empty on a failed//empty search matters: callers merge onto
# this, and `null + {isActive:false}` is a valid jq expression that exits 0 —
# so a broken search would otherwise sail through as a bodyless update.
mdms_first_record() {
  local resp; resp="$(mdms_search "$1" "${2:-}")"
  printf '%s' "$resp" | jq -ce '.mdms[0] // empty' 2>/dev/null
}

# mdms_create <schemaCode> <data-json> — create one record, echo the response.
#
# Schema creation goes through Kafka, so for a few seconds after step 1 a data
# create can still come back SCHEMA_DEFINITION_NOT_FOUND_ERR (and, while the
# uid computation lags, "Values defined against unique fields cannot be
# empty"). Both are races, not failures — retry with backoff. Same fix
# tenant_bootstrap carries.
mdms_create() {
  local code="$1" data="$2" body resp
  for attempt in 0 1 2 3; do
    body="$(mktemp)"
    jq -n --argjson ri "$REQUEST_INFO" --arg t "$DASHBOARD_TENANT" --arg c "$code" \
       --argjson d "$data" \
       '{RequestInfo:$ri, Mdms:{tenantId:$t, schemaCode:$c, data:$d, isActive:true}}' > "$body"
    resp="$(mdms_post "/mdms-v2/v2/_create/$code" "$body")"
    rm -f "$body"
    if printf '%s' "$resp" | grep -qiE 'SCHEMA_DEFINITION_NOT_FOUND|unique fields cannot be empty'; then
      sleep $(( 1 << attempt ))
      continue
    fi
    break
  done
  printf '%s' "$resp"
}

# =============================================================================
# STEP 0 — Preflight.
#
# Every check here maps to a precondition in the runbook. They are checks and
# not assumptions because each one has actually been the reason a live
# enablement produced a blank dashboard.
# =============================================================================
step0() {
  step step0 "${STEP_TITLES[0]}"
  local fatal=0

  # -- seed files present --------------------------------------------------
  for f in "$DSS_DATA_DIR/KpiDefinition.json" "$DSS_DATA_DIR/DashboardPack.json" \
           "$DSS_SCHEMA_DIR/dss.KpiDefinition.json"; do
    [[ -f "$f" ]] || { err "missing seed file: $f"; fatal=1; }
  done
  [[ $fatal -eq 0 ]] || { note "Run from a CCRS checkout, or set REPO_ROOT=/path/to/CCRS"; return 1; }
  KPI_COUNT="$(jq 'length' "$DSS_DATA_DIR/KpiDefinition.json")"
  ok "seed files present (${KPI_COUNT} KPI defs, $(jq 'length' "$DSS_DATA_DIR/DashboardPack.json") pack)"

  # -- tooling -------------------------------------------------------------
  for c in jq python3 curl; do command -v "$c" >/dev/null || { err "$c not on PATH"; fatal=1; }; done

  # -- the seed data must satisfy the schema this script registers ---------
  #
  # Step 1 registers the schema files and step 2 seeds the catalog data; the
  # two are separate files that drift. When they disagree, every failing
  # record is rejected at create time — but ONLY on a tenant where step 1
  # actually registered something. On a tenant that already has an older,
  # broader schema, step 1 logs "already registered" and the mismatch stays
  # invisible. That asymmetry means the from-scratch path (the one this
  # script exists for) is the one that breaks, so check it offline, here.
  local schema_check
  schema_check="$(python3 - "$DSS_SCHEMA_DIR" "$DSS_DATA_DIR" <<'PY'
import json,sys,os
sd, dd = sys.argv[1], sys.argv[2]
try:
    from jsonschema import Draft7Validator
except ImportError:
    print("SKIP python3 jsonschema not installed — cannot pre-validate seed data"); raise SystemExit
bad_total = 0
for code, f in (('dss.KpiDefinition','KpiDefinition'), ('dss.DashboardPack','DashboardPack'),
                ('dss.DashboardConfig','DashboardConfig')):
    sp, dp = os.path.join(sd, code + '.json'), os.path.join(dd, f + '.json')
    if not (os.path.exists(sp) and os.path.exists(dp)): continue
    schema = json.load(open(sp))
    if not schema.get('x-unique'):
        print(f"FAIL {code}: schema declares no x-unique — mdms-v2 derives the record "
              f"uniqueIdentifier from it; without it creates fail and re-runs duplicate")
        bad_total += 1
    v = Draft7Validator(schema)
    recs = [r.get('data', r) for r in json.load(open(dp))]
    bad = [(r.get('id'), next(iter(v.iter_errors(r))).message) for r in recs if list(v.iter_errors(r))]
    if bad:
        bad_total += len(bad)
        print(f"FAIL {code}: {len(bad)}/{len(recs)} seed records violate the schema this script registers")
        for rid, msg in bad[:3]:
            print(f"FAIL   {rid}: {msg[:110]}")
        if len(bad) > 3: print(f"FAIL   … and {len(bad)-3} more")
if bad_total == 0: print("OK schema and seed data agree")
PY
)"
  while IFS= read -r line; do
    case "$line" in
      OK\ *)   ok "${line#OK }" ;;
      SKIP\ *) warn "${line#SKIP }" ;;
      FAIL\ *) err "${line#FAIL }"; fatal=1 ;;
    esac
  done <<< "$schema_check"
  [[ "$schema_check" == FAIL* ]] && note "Reconcile local-setup/db/dss-mdms-seed/schemas/ with ansible/nairobi-mdms/mdms/dss/ before seeding."

  # -- postgres reachable --------------------------------------------------
  # Without this, a wrong DB_CONTAINER makes every read return empty, and the
  # role/facts/corruption checks below report a confident "0 holders",
  # "0 matviews", "no corruption" — advice that is wrong rather than absent.
  if $SUDO docker exec "$DB_CONTAINER" pg_isready -U "$DB_USER" -d "$DB_NAME" >/dev/null 2>&1; then
    ok "postgres reachable ($DB_CONTAINER, db=$DB_NAME)"
  else
    err "cannot reach postgres in container '$DB_CONTAINER' as user '$DB_USER'"
    note "Set DB_CONTAINER / DB_USER / DB_NAME. Every check below reads from it,"
    note "and would otherwise report empty results as clean."
    fatal=1
  fi

  # -- mdms-v2 reachable on the DIRECT port --------------------------------
  if [[ "$(http_code "$MDMS_URL/mdms-v2/health")" =~ ^[23] ]]; then
    ok "mdms-v2 reachable at $MDMS_URL (direct, not Kong)"
  else
    err "mdms-v2 not reachable at $MDMS_URL/mdms-v2/health"
    note "Seeding through Kong corrupts array fields (cjson [] -> {}); fix the direct port instead."
    fatal=1
  fi

  # -- pgr-services actually serves the analytics tier ---------------------
  # An old image has no analytics routes at all, and every downstream step
  # would still "succeed" while the dashboard stayed blank.
  local acat
  acat="$(http_code -X POST "$PGR_URL/pgr-services/v2/analytics/catalog/_search" \
    -H 'Content-Type: application/json' -d "{\"RequestInfo\":{},\"tenantId\":\"$DASHBOARD_TENANT\"}")"
  if [[ "$acat" =~ ^[23] ]]; then
    ok "pgr-services serves /v2/analytics (HTTP $acat)"
  else
    # Don't assert the cause. A missing route can surface as 404 OR as 400 —
    # tracer's catch-all @ControllerAdvice remaps NoResourceFoundException —
    # and a genuine 400 from a rejected body looks identical from here.
    err "pgr-services /v2/analytics/catalog/_search -> HTTP $acat (expected 2xx)"
    note "Most often the image predates the analytics tier; confirm with:"
    note "  docker exec <pgr> sh -c 'unzip -l /opt/egov/*.jar | grep -c analytics'"
    note "Zero means upgrade the image. Non-zero means the route exists and the request was rejected."
    fatal=1
  fi

  # -- materialized views + the refresh scheduler --------------------------
  local mvs; mvs="$(psql_q "select count(*) from pg_matviews where matviewname like 'pgr_mv%'")"
  if [[ "${mvs:-0}" -ge 4 ]]; then ok "dashboard materialized views present (${mvs})"
  else warn "expected 4 pgr_mv_* materialized views, found ${mvs:-0} — tiles will read empty"; fi

  # -- corrupt rows: a JSON Schema document stored AS a data record --------
  # Posting a schema body to /v2/_create/<schema> instead of /schema/v1/_create
  # yields a row whose data has "$schema"/"properties" and none of the master's
  # own fields. It occupies the uid, so a later good seed is skipped as
  # "already exists" and the catalog stays broken forever. Found live on moz.
  # Type-check both markers, matching isSchemaDocument() in
  # digit-mcp/src/tools/mdms-tenant.ts — key presence alone would flag a record
  # that legitimately carries a field named `properties`.
  CORRUPT_UIDS="$(psql_q "select schemacode||'/'||uniqueidentifier from eg_mdms_data
      where tenantid='$DASHBOARD_TENANT' and schemacode like 'dss.%'
        and jsonb_typeof(data->'\$schema') = 'string'
        and jsonb_typeof(data->'properties') = 'object'")"
  if [[ -n "$CORRUPT_UIDS" ]]; then
    warn "schema-as-data rows detected (a JSON Schema stored as a record):"
    printf '        %s\n' $CORRUPT_UIDS
    if [[ "$DO_REPAIR" == true ]]; then
      note "--repair given: step 2 will deactivate these before seeding."
    else
      err "these rows will shadow the real records — re-run with --repair"
      fatal=1
    fi
  else
    ok "no schema-as-data corruption in dss.* at $DASHBOARD_TENANT"
  fi

  # -- roles: does every KPI have a live audience, and can anyone reach it? --
  #
  # The naive check ("every referenced role must have holders") is too blunt to
  # be useful: even the reference deployment has catalog roles nobody holds
  # (PGR_ADMIN and PGR_SUPERVISOR are empty on bomet), and a KPI with one
  # unused role among several live ones is perfectly visible. What actually
  # breaks a deployment is narrower, so check for exactly that:
  #   ERROR — a KPI whose ENTIRE audience is roles nobody holds (invisible)
  #   ERROR — no gate role has any holders at all (nobody can open the page)
  #   WARN  — an unused role that leaves every KPI covered (harmless, but it
  #           is usually the first sign you meant to pass a ROLE_MAP)
  build_role_map
  local roles
  roles="$(target_roles)"
  log "target roles after remap: ${roles//$'\n'/, }"
  local holders_json="{}"
  for r in $roles; do
    local n; n="$(psql_q "select count(*) from eg_userrole_v1 where role_code='$r'")"
    # eg_userrole_v1 is the live table on current deployments; older ones still
    # carry eg_userrole. An empty result from the first is not "zero holders".
    [[ -z "$n" ]] && n="$(psql_q "select count(*) from eg_userrole where role_code='$r'")"
    holders_json="$(printf '%s' "$holders_json" | jq -c --arg r "$r" --argjson n "${n:-0}" '. + {($r): $n}')"
  done
  printf '%s' "$holders_json" | jq -r 'to_entries|sort_by(-.value)[]|"     \(.key): \(.value) holders"'

  local role_report
  role_report="$(python3 - "$DSS_DATA_DIR" "$ROLE_MAP_JSON" "$DASHBOARD_ALLOWED_ROLES" "$holders_json" <<'PY'
import json,os,sys
d, rmap, allowed, holders = sys.argv[1], json.loads(sys.argv[2]), sys.argv[3], json.loads(sys.argv[4])
live = lambda r: holders.get(rmap.get(r, r), 0) > 0
unwrap = lambda r: r['data'] if isinstance(r.get('data'), dict) else r
kpis = [unwrap(k) for k in json.load(open(os.path.join(d, 'KpiDefinition.json')))]
orphans = []
for k in kpis:
    vis = ((k.get('rbac') or {}).get('visibleTo')) or []
    # Mirror KpiDefinition.isVisibleTo exactly. PUBLIC is an ADDITIVE audience
    # marker for authenticated callers, not a ceiling — strip it, and an empty
    # remaining ceiling means "visible to every authenticated role". So only a
    # NON-EMPTY ceiling of entirely unheld roles makes a KPI unreachable.
    ceiling = [r for r in vis if r != 'PUBLIC']
    if ceiling and not any(live(r) for r in ceiling):
        orphans.append(k.get('id', '<no id>'))
# Report gate roles by their POST-remap name. Printing the source name for a
# remapped role claims holders for a role that has none — the report has to
# name the role the seed actually writes.
gate = [rmap.get(r.strip(), r.strip()) for r in allowed.split(',') if r.strip()]
gate = list(dict.fromkeys(gate))
gate_live = [r for r in gate if live(r)]
dead = sorted({rmap.get(r, r) for k in kpis
               for r in (((k.get('rbac') or {}).get('visibleTo')) or [])
               if r != 'PUBLIC' and not live(r)})
print(json.dumps({'orphans': orphans, 'gate_live': gate_live,
                  'gate_dead': [r for r in gate if not live(r)], 'dead': dead}))
PY
)"
  local orphans gate_live gate_dead dead
  orphans="$(printf '%s' "$role_report" | jq -r '.orphans | join(", ")')"
  gate_live="$(printf '%s' "$role_report" | jq -r '.gate_live | join(", ")')"
  gate_dead="$(printf '%s' "$role_report" | jq -r '.gate_dead | join(", ")')"
  dead="$(printf '%s' "$role_report" | jq -r '.dead | join(", ")')"

  if [[ -n "$orphans" ]]; then
    if [[ "$ALLOW_EMPTY_ROLES" == true ]]; then
      warn "KPIs visible to nobody (ALLOW_EMPTY_ROLES=true): $orphans"
    else
      err "these KPIs would be visible to NO ONE — every role in their rbac.visibleTo is unheld:"
      err "  $orphans"
      note "Remap with ROLE_MAP=\"PGR_SUPERVISOR=<your-role>,...\", or ALLOW_EMPTY_ROLES=true"
      note "if you are seeding ahead of an HRMS import."
      fatal=1
    fi
  else
    ok "every KPI has at least one role with live holders"
  fi

  if [[ -z "$gate_live" ]]; then
    err "no role in DASHBOARD_ALLOWED_ROLES has any holders — nobody could open the dashboard"
    note "Set DASHBOARD_ALLOWED_ROLES to roles this deployment actually uses."
    fatal=1
  else
    ok "gate roles with holders: $gate_live"
    [[ -n "$gate_dead" ]] && warn "gate roles with no holders (harmless, but check the taxonomy): $gate_dead"
  fi
  [[ -n "$dead" ]] && note "catalog references these unheld roles: $dead"

  # -- department scope: the #1280 trap ------------------------------------
  local facts empty
  facts="$(psql_q "select count(*) from complaint_facts")"
  empty="$(psql_q "select count(*) from complaint_facts where coalesce(department_code,'')=''")"
  if [[ "${facts:-0}" -eq 0 ]]; then
    warn "complaint_facts is empty — the dashboard will render with no data"
  elif [[ "${empty:-0}" -gt $(( facts / 2 )) ]]; then
    warn "${empty}/${facts} complaint facts have no department_code (#1280)"
    if [[ "$DEPARTMENT_SCOPING" == "disabled" ]]; then
      note "DEPARTMENT_SCOPING=disabled — step 3 will widen visibility for ALL employees."
    else
      note "Employees WITH an HRMS department will see empty tiles. Either fix department"
      note "enrichment (#1280) or re-run with DEPARTMENT_SCOPING=disabled (temporary)."
    fi
  else
    ok "complaint facts carry department codes (${facts} facts, ${empty} unscoped)"
  fi

  [[ $fatal -eq 0 ]] || { err "preflight failed — nothing was written"; return 1; }
  mint_request_info && ok "authenticated as $ADMIN_USER@$DASHBOARD_TENANT"
}

# build_role_map / target_roles — parse ROLE_MAP once, and enumerate every role
# the seed will reference AFTER remapping, so preflight can validate them.
build_role_map() {
  ROLE_MAP_JSON='{}'
  if [[ -n "$ROLE_MAP" ]]; then
    ROLE_MAP_JSON="$(python3 - "$ROLE_MAP" <<'PY'
import json,sys
pairs = [p for p in sys.argv[1].split(',') if p.strip()]
out = {}
for p in pairs:
    if '=' not in p: raise SystemExit(f"bad ROLE_MAP entry {p!r} — expected SRC=DST")
    src, dst = p.split('=', 1)
    out[src.strip()] = dst.strip()
print(json.dumps(out))
PY
)"
  fi
}
target_roles() {
  python3 - "$DSS_DATA_DIR" "$ROLE_MAP_JSON" "$DASHBOARD_ALLOWED_ROLES" <<'PY'
import json,sys,os
d, rmap, allowed = sys.argv[1], json.loads(sys.argv[2]), sys.argv[3]
roles=set()
def walk(o):
    if isinstance(o,dict):
        for k,v in o.items():
            # 'roles' inside a wrapped record is the pack persona list; walking
            # the whole tree catches it at any depth, wrapped or flat.
            if k in ('visibleTo','roles') and isinstance(v,list):
                roles.update(x for x in v if isinstance(x,str))
            else: walk(v)
    elif isinstance(o,list):
        for x in o: walk(x)
for f in ('KpiDefinition.json','DashboardPack.json'):
    p=os.path.join(d,f)
    if os.path.exists(p): walk(json.load(open(p)))
roles.update(r.strip() for r in allowed.split(',') if r.strip())
# PUBLIC is the anonymous floor, not a grantable role. Dedupe AFTER the remap —
# several source roles commonly collapse onto one target role.
print('\n'.join(sorted({rmap.get(r, r) for r in roles if r != 'PUBLIC'})))
PY
}

# =============================================================================
# STEP 1 — Register the dss schemas.
#
# mdms-v2 validates data against the registered schema at create time, so the
# schemas must land (and propagate through Kafka) before step 2. The schema
# files hold the bare JSON Schema; the SchemaDefinition envelope is built here.
# =============================================================================
step1() {
  step step1 "${STEP_TITLES[1]}"
  for code in dss.KpiDefinition dss.DashboardPack dss.DashboardConfig; do
    local f="$DSS_SCHEMA_DIR/${code}.json"
    [[ -f "$f" ]] || { err "missing schema file $f"; return 1; }
    if [[ "$DRY_RUN" == true ]]; then log "[dry-run] register schema $code at $DASHBOARD_TENANT"; continue; fi
    local body; body="$(mktemp)"
    jq -n --arg t "$DASHBOARD_TENANT" --arg c "$code" \
       --argjson ri "$REQUEST_INFO" --slurpfile def "$f" \
       '{RequestInfo:$ri, SchemaDefinition:{tenantId:$t, code:$c, description:$c,
          definition:$def[0], isActive:true}}' > "$body"
    local resp; resp="$(mdms_post /mdms-v2/schema/v1/_create "$body")"; rm -f "$body"
    if printf '%s' "$resp" | grep -qiE 'DUPLICATE|already exists'; then log "  $code — already registered"
    elif printf '%s' "$resp" | grep -qi 'SchemaDefinitions'; then ok "$code registered"
    else warn "$code — unexpected response: $(printf '%s' "$resp" | head -c 200)"; fi
  done
  # Schema creation is async (Kafka). Wait for readback before seeding data,
  # rather than leaning on step 2's per-record retry for all 39 records.
  [[ "$DRY_RUN" == true ]] && return 0
  local n=0
  for _ in $(seq 1 20); do
    n="$(psql_q "select count(*) from eg_mdms_schema_definition
          where tenantid='$DASHBOARD_TENANT' and code like 'dss.%'")"
    [[ "${n:-0}" -ge 3 ]] && break
    sleep 2
  done
  [[ "${n:-0}" -ge 3 ]] && ok "all 3 dss schemas readable at $DASHBOARD_TENANT" \
    || warn "only ${n:-0}/3 dss schemas readable — step 2 will retry per record"
}

# =============================================================================
# STEP 2 — Seed the KPI catalog.
#
# Roles are remapped here (see the ROLES block at the top). Records are created
# one POST each; mdms-v2 derives the uid from the schema's x-unique field.
# =============================================================================
step2() {
  step step2 "${STEP_TITLES[2]}"

  # Repair first: a schema-as-data row occupies the uid a real record needs.
  # We deactivate rather than delete — mdms-v2 has no delete, and an inactive
  # row is skipped by the catalog reader while staying auditable.
  if [[ "$DO_REPAIR" == true && -n "${CORRUPT_UIDS:-}" ]]; then
    for entry in $CORRUPT_UIDS; do
      local sc="${entry%%/*}" uid="${entry##*/}"
      if [[ "$DRY_RUN" == true ]]; then log "[dry-run] deactivate $sc/$uid"; continue; fi
      local cur body resp
      # Read the whole record back before mutating it. An empty read is a hard
      # stop, not a warning: repair is the reason --repair was passed, and a
      # bodyless update that "succeeds" would leave the corruption in place
      # while the run reports the catalog seeded.
      cur="$(mdms_first_record "$sc" "$uid")"
      if [[ -z "$cur" ]]; then
        err "could not read $sc/$uid back for repair — refusing to send a bodyless update"
        note "Deactivate it by hand (mdms-v2 _update with isActive:false), then re-run."
        return 1
      fi
      body="$(mktemp)"
      jq -n --argjson ri "$REQUEST_INFO" --argjson cur "$cur" \
        '{RequestInfo:$ri, Mdms:($cur + {isActive:false})}' > "$body"
      resp="$(mdms_post "/mdms-v2/v2/_update/$sc" "$body")"; rm -f "$body"
      if printf '%s' "$resp" | grep -qi '"mdms"'; then
        ok "deactivated corrupt $sc/$uid"
      else
        err "repair of $sc/$uid failed: $(printf '%s' "$resp" | head -c 200)"
        return 1
      fi
    done
  fi

  seed_records dss.KpiDefinition "$DSS_DATA_DIR/KpiDefinition.json"
  seed_records dss.DashboardPack "$DSS_DATA_DIR/DashboardPack.json"
}

# seed_records <schemaCode> <file> — remap roles, retag tenantId, POST each record.
seed_records() {
  local code="$1" file="$2"
  local records; records="$(python3 - "$file" "$ROLE_MAP_JSON" <<'PY'
import json,sys
recs = json.load(open(sys.argv[1]))
rmap = json.loads(sys.argv[2])
def remap(o):
    if isinstance(o,dict):
        return {k: ([rmap.get(x,x) if isinstance(x,str) else remap(x) for x in v]
                    if k in ('visibleTo','roles') and isinstance(v,list) else remap(v))
                for k,v in o.items()}
    if isinstance(o,list): return [remap(x) for x in o]
    return o
for r in recs:
    # The seed files are MDMS-v2 WRAPPED — {"tenantId": …, "data": {…}} — but
    # the create call takes the inner record as `data` and the tenant from the
    # envelope we build. Posting the wrapper stores a record whose only fields
    # are tenantId+data, which passes schema validation nowhere and reads back
    # as a KPI with no id. Tolerate the v1-flat shape too: both exist in this
    # repo for other masters (see docs/dashboard-rbac-design/20-…, B-3).
    inner = r['data'] if isinstance(r, dict) and isinstance(r.get('data'), dict) else r
    print(json.dumps(remap(inner)))
PY
)"
  local total=0 created=0 skipped=0 updated=0 failed=0
  while IFS= read -r rec; do
    [[ -z "$rec" ]] && continue
    total=$((total+1))
    if [[ "$DRY_RUN" == true ]]; then continue; fi
    local resp; resp="$(mdms_create "$code" "$rec")"
    if printf '%s' "$resp" | grep -qiE 'DUPLICATE|Duplicate record|already exists'; then
      if [[ "$DO_UPDATE" == true ]]; then
        update_record "$code" "$rec" && updated=$((updated+1)) || failed=$((failed+1))
      else
        skipped=$((skipped+1))
      fi
    elif printf '%s' "$resp" | grep -qi '"mdms"'; then
      created=$((created+1))
    else
      failed=$((failed+1))
      warn "$code: $(printf '%s' "$resp" | head -c 180)"
    fi
  done <<< "$records"

  if [[ "$DRY_RUN" == true ]]; then log "[dry-run] would seed $total $code records"; return 0; fi
  log "$code — created $created, existing $skipped, updated $updated, failed $failed (of $total)"
  # The stale-catalog trap (#1026): _create is a no-op against an existing
  # record, so an edited seed file silently never reaches a live tenant.
  if [[ $skipped -gt 0 && "$DO_UPDATE" != true ]]; then
    note "$skipped $code record(s) already existed and were NOT overwritten."
    note "If the seed file has changed since they were written, re-run with --update."
  fi
  [[ $failed -eq 0 ]] || { err "$failed $code record(s) failed"; return 1; }
}

# update_record <schemaCode> <data-json> — read-merge-write an existing record.
# mdms-v2 _update needs the row's `id`, so read it back by uid first.
update_record() {
  local code="$1" rec="$2"
  local uid cur body resp
  uid="$(printf '%s' "$rec" | jq -r '.id // empty')"
  [[ -n "$uid" ]] || return 1
  # mdms-v2 _update needs the row's own `id` (a uuid) from a readback — the
  # record's business key is not enough. No readback, no update.
  cur="$(mdms_first_record "$code" "$uid")"
  [[ -n "$cur" ]] || { warn "$code/$uid: could not read the existing record back for update"; return 1; }
  body="$(mktemp)"
  jq -n --argjson ri "$REQUEST_INFO" --argjson cur "$cur" --argjson d "$rec" \
    '{RequestInfo:$ri, Mdms:($cur + {data:$d, isActive:true})}' > "$body"
  resp="$(mdms_post "/mdms-v2/v2/_update/$code" "$body")"; rm -f "$body"
  printf '%s' "$resp" | grep -qi '"mdms"'
}

# =============================================================================
# STEP 3 — dss.DashboardConfig: the nav/route gate + number format + scoping.
#
# One record, id "default", at the state root. Pre-#1258 FE bundles ignore it
# and use their hardcoded gate; seeding it anyway means the deployment is
# already correct the moment the bundle is rebuilt.
# =============================================================================
step3() {
  step step3 "${STEP_TITLES[3]}"
  local rec
  rec="$(python3 - "$DSS_DATA_DIR/DashboardConfig.json" "$ROLE_MAP_JSON" \
                   "$DASHBOARD_ALLOWED_ROLES" "$DEPARTMENT_SCOPING" <<'PY'
import json,os,sys
path, rmap, allowed, scoping = sys.argv[1], json.loads(sys.argv[2]), sys.argv[3], sys.argv[4]
base = json.load(open(path))[0] if os.path.exists(path) else {"id": "default"}
# Seed files are MDMS-v2 wrapped; the record we write is the inner object.
if isinstance(base.get("data"), dict): base = base["data"]
base["id"] = "default"
# Dedupe AFTER the remap, preserving order: several canonical roles routinely
# collapse onto one target (PGR_SUPERVISOR and PGR_ADMIN -> SUPERVISOR and
# SUPERUSER on a stock box), and a role listed twice in the written record is
# noise the operator has to reason about later.
base["allowedRoles"] = list(dict.fromkeys(
    rmap.get(r.strip(), r.strip()) for r in allowed.split(',') if r.strip()))
if scoping: base["departmentScoping"] = scoping
else: base.pop("departmentScoping", None)
print(json.dumps(base))
PY
)"
  log "allowedRoles: $(printf '%s' "$rec" | jq -r '.allowedRoles | join(", ")')"
  [[ -n "$DEPARTMENT_SCOPING" ]] && warn "departmentScoping=$DEPARTMENT_SCOPING — widens visibility for ALL employees on $DASHBOARD_TENANT"
  if [[ "$DRY_RUN" == true ]]; then log "[dry-run] would seed dss.DashboardConfig/default"; return 0; fi
  local body resp; body="$(mktemp)"
  jq -n --argjson ri "$REQUEST_INFO" --arg t "$DASHBOARD_TENANT" --argjson d "$rec" \
    '{RequestInfo:$ri, Mdms:{tenantId:$t, schemaCode:"dss.DashboardConfig", data:$d, isActive:true}}' > "$body"
  resp="$(mdms_post /mdms-v2/v2/_create/dss.DashboardConfig "$body")"; rm -f "$body"
  if printf '%s' "$resp" | grep -qiE 'DUPLICATE|Duplicate record'; then
    # This record is the one an operator most often needs to CHANGE (roles,
    # scoping), so unlike the catalog we update it in place by default.
    update_record dss.DashboardConfig "$rec" && ok "dss.DashboardConfig/default updated" \
      || { err "dss.DashboardConfig exists but update failed"; return 1; }
  elif printf '%s' "$resp" | grep -qi '"mdms"'; then ok "dss.DashboardConfig/default created"
  else err "dss.DashboardConfig: $(printf '%s' "$resp" | head -c 200)"; return 1; fi
}

# =============================================================================
# STEP 4 — Sidebar action grants.
#
# The sidebar is actions-driven: the dashboard action must be granted per role
# via ACCESSCONTROL-ROLEACTIONS. Grant it ONLY to roles that also pass the
# route gate (step 3) — a visible link that bounces is worse than no link.
# =============================================================================
step4() {
  step step4 "${STEP_TITLES[4]}"
  local gate_roles; gate_roles="$(python3 -c "
import json,sys
rmap=json.loads('''$ROLE_MAP_JSON''')
roles=[rmap.get(r.strip(),r.strip()) for r in '''$DASHBOARD_ALLOWED_ROLES'''.split(',') if r.strip()]
print(' '.join(dict.fromkeys(roles)))")"

  # The action itself must exist before it can be granted. mdms-v2 enforces the
  # reference and rejects the grant with REFERENCE_VALIDATION_ERR — which the
  # loop below would otherwise report as a per-role warning while the run went
  # on to declare the dashboard enabled with no sidebar entry for anyone.
  # A stock tenant genuinely may not have it: on the box this was found, `pg`
  # had 368 roleactions rows and 246 actions, and no action id 4557 at all.
  if [[ "$DRY_RUN" != true ]]; then
    local action_rows
    action_rows="$(psql_q "select count(*) from eg_mdms_data
        where schemacode like 'ACCESSCONTROL-ACTIONS%' and tenantid='$DASHBOARD_TENANT'
          and data->>'id' = '$DASHBOARD_ACTION_ID' and isactive")"
    if [[ "${action_rows:-0}" -eq 0 ]]; then
      err "action id $DASHBOARD_ACTION_ID does not exist at $DASHBOARD_TENANT — cannot grant it"
      note "The dashboard's sidebar action must be seeded first, in BOTH masters"
      note "(ACCESSCONTROL-ACTIONS.actions and ACCESSCONTROL-ACTIONS-TEST.actions-test —"
      note "the bridge in 30-view-access.md §5 explains why both). A reference deployment"
      note "carries it as: {\"id\": $DASHBOARD_ACTION_ID, \"name\": \"Dashboard\", …}."
      note "Then re-run: --only step4"
      return 1
    fi
    ok "action id $DASHBOARD_ACTION_ID exists at $DASHBOARD_TENANT (${action_rows} master row(s))"

    # mdms-v2 validates roleactions' x-ref fields by comparing the field VALUE
    # against the referenced record's uniqueIdentifier. That only works where
    # ACCESSCONTROL-ROLES rows carry their code as the uid. Where the master
    # was seeded through the schema-driven path instead, the uid is a hash of
    # the code, `rolecode:"GRO"` matches nothing, and EVERY roleactions create
    # is rejected with REFERENCE_VALIDATION_ERR — including pairs that already
    # exist as rows. Nothing this script can send will succeed there, so say
    # that plainly instead of emitting one opaque rejection per role.
    local hashed_roles
    hashed_roles="$(psql_q "select count(*) from eg_mdms_data
        where schemacode='ACCESSCONTROL-ROLES.roles' and tenantid='$DASHBOARD_TENANT'
          and isactive and uniqueidentifier <> data->>'code'")"
    if [[ "${hashed_roles:-0}" -gt 0 ]]; then
      err "ACCESSCONTROL-ROLES uses schema-derived (hashed) uniqueIdentifiers at $DASHBOARD_TENANT"
      note "mdms-v2 resolves the roleactions rolecode reference against that uid, so every"
      note "grant is rejected with REFERENCE_VALIDATION_ERR — verified true even for role/action"
      note "pairs that already exist as rows. This is a property of how the ACCESSCONTROL"
      note "masters were seeded here, not of the grant payload."
      note "Seed the grants through the platform path (DDH / dataloader) instead, or re-seed"
      note "ACCESSCONTROL-ROLES with code-valued uniqueIdentifiers, then re-run --only step4."
      note "Deployments seeded the reference way (uid == role code) are unaffected."
      return 1
    fi
  fi

  # Mirror an existing roleactions row's shape rather than inventing fields —
  # the master's columns vary by deployment vintage.
  local template=""
  if [[ "$DRY_RUN" != true ]]; then
    template="$(mdms_first_record ACCESSCONTROL-ROLEACTIONS.roleactions | jq -c '.data // empty')"
  fi
  if [[ -z "$template" && "$DRY_RUN" != true ]]; then
    # Distinguish "this deployment has no roleactions" from "we failed to read
    # them". Guessing wrong here sends the operator to seed a master that is
    # already populated — which is exactly what the broken _search path did.
    local live_rows
    live_rows="$(psql_q "select count(*) from eg_mdms_data
        where schemacode='ACCESSCONTROL-ROLEACTIONS.roleactions'
          and tenantid='$DASHBOARD_TENANT' and isactive")"
    if [[ "${live_rows:-0}" -gt 0 ]]; then
      err "could not read ACCESSCONTROL-ROLEACTIONS via mdms-v2, but ${live_rows} active rows exist at $DASHBOARD_TENANT"
      note "The search call failed — not a missing master. Check $MDMS_URL before granting."
      return 1
    fi
    warn "no existing roleactions row to mirror — skipping sidebar grants"
    note "Seed ACCESSCONTROL-ROLEACTIONS first, then re-run with --only step4."
    return 0
  fi

  local maxid; maxid="$(psql_q "select coalesce(max((data->>'id')::bigint),0) from eg_mdms_data
      where schemacode='ACCESSCONTROL-ROLEACTIONS.roleactions' and tenantid='$DASHBOARD_TENANT'")"
  maxid="${maxid:-0}"
  for role in $gate_roles; do
    local uid="${role}.${DASHBOARD_ACTION_ID}"
    if [[ "$DRY_RUN" == true ]]; then log "[dry-run] grant $uid"; continue; fi
    maxid=$((maxid+1))
    local rec body resp
    rec="$(jq -nc --argjson t "$template" --arg r "$role" --argjson a "$DASHBOARD_ACTION_ID" \
      --argjson i "$maxid" '$t + {id:$i, actionid:$a, rolecode:$r}')"
    body="$(mktemp)"
    jq -n --argjson ri "$REQUEST_INFO" --arg t "$DASHBOARD_TENANT" --arg u "$uid" --argjson d "$rec" \
      '{RequestInfo:$ri, Mdms:{tenantId:$t, schemaCode:"ACCESSCONTROL-ROLEACTIONS.roleactions",
        uniqueIdentifier:$u, data:$d, isActive:true}}' > "$body"
    resp="$(mdms_post /mdms-v2/v2/_create/ACCESSCONTROL-ROLEACTIONS.roleactions "$body")"; rm -f "$body"
    if printf '%s' "$resp" | grep -qiE 'DUPLICATE|Duplicate record'; then log "  $uid — already granted"
    elif printf '%s' "$resp" | grep -qi '"mdms"'; then ok "granted $uid"
    else
      # A failed grant is not cosmetic: that role gets no sidebar entry. Fail
      # the step rather than warning and reporting the dashboard enabled.
      err "$uid: $(printf '%s' "$resp" | head -c 200)"
      grant_failed=1
    fi
  done
  [[ ${grant_failed:-0} -eq 0 ]] || { err "one or more sidebar grants failed"; return 1; }
  note "accesscontrol reads MDMS live, but clients cache actions — users must re-login (step 6)."
}

# =============================================================================
# STEP 5 — Localization.
#
# Two modules, and the split is not obvious: the dashboard's own strings live
# in `rainmaker-dashboard`, but the two NAV labels live in `rainmaker-common`
# (that is where the sidebar/home-card renderer looks them up).
# =============================================================================
step5() {
  step step5 "${STEP_TITLES[5]}"
  local locales
  if [[ -n "$DASHBOARD_LOCALES" ]]; then
    locales="${DASHBOARD_LOCALES//,/ }"
  else
    locales="$(cd "$DSS_L10N_DIR" 2>/dev/null && ls *.json 2>/dev/null | sed 's/\.json$//' | tr '\n' ' ')"
  fi
  [[ -n "$locales" ]] || { err "no locale packs in $DSS_L10N_DIR"; return 1; }
  log "locales: $locales"

  # The language menu must list a locale or nobody can select it, however well
  # seeded it is. StateInfo.languages on the state root is the ONLY source.
  local declared
  declared="$(psql_q "select string_agg(l->>'value', ',') from eg_mdms_data d,
      lateral jsonb_array_elements(d.data->'languages') l
      where d.schemacode='common-masters.StateInfo' and d.tenantid='$DASHBOARD_TENANT'")"
  for loc in $locales; do
    [[ ",${declared}," == *",${loc},"* ]] || \
      warn "$loc is not in common-masters.StateInfo.languages — seeded but unselectable in the UI"
  done

  for loc in $locales; do
    local pack="$DSS_L10N_DIR/${loc}.json"
    [[ -f "$pack" ]] || { warn "no pack for $loc — skipping"; continue; }
    local n; n="$(jq 'length' "$pack")"
    if [[ "$DRY_RUN" == true ]]; then log "[dry-run] upsert $n messages for $loc"; continue; fi
    local sent=0
    while read -r batch; do
      local body resp; body="$(mktemp)"
      jq -n --argjson ri "$REQUEST_INFO" --arg t "$DASHBOARD_TENANT" --arg l "$loc" \
        --argjson m "$batch" '{RequestInfo:$ri, tenantId:$t,
          messages:[$m[] | {code:.code, message:.message, module:.module, locale:$l}]}' > "$body"
      resp="$(curl -s -X POST "$LOCALIZATION_URL/localization/messages/v1/_upsert" \
        -H 'Content-Type: application/json' --data-binary "@$body")"; rm -f "$body"
      printf '%s' "$resp" | grep -qi 'messages' && sent=$((sent + $(printf '%s' "$batch" | jq 'length'))) \
        || warn "$loc batch failed: $(printf '%s' "$resp" | head -c 160)"
    done < <(jq -c "[_nwise($L10N_BATCH)][]" "$pack" 2>/dev/null || jq -c "[.] | .[]" "$pack")
    ok "$loc — upserted $sent/$n rainmaker-dashboard messages"

    # The two nav labels: module rainmaker-common, NOT rainmaker-dashboard.
    local body resp; body="$(mktemp)"
    jq -n --argjson ri "$REQUEST_INFO" --arg t "$DASHBOARD_TENANT" --arg l "$loc" \
      '{RequestInfo:$ri, tenantId:$t, messages:[
        {code:"ACTION_TEST_DASHBOARD", message:"Dashboard", module:"rainmaker-common", locale:$l},
        {code:"DASHBOARD_CARD_HEADER",  message:"Dashboard", module:"rainmaker-common", locale:$l}]}' > "$body"
    resp="$(curl -s -X POST "$LOCALIZATION_URL/localization/messages/v1/_upsert" \
      -H 'Content-Type: application/json' --data-binary "@$body")"; rm -f "$body"
    printf '%s' "$resp" | grep -qi 'messages' && ok "$loc — nav labels seeded (rainmaker-common)" \
      || warn "$loc nav labels: $(printf '%s' "$resp" | head -c 160)"
    note "$loc nav labels are seeded in English — translate them for non-English locales."
  done

  # Cache-bust. The redis DEL alone is NOT enough; the service holds its own
  # cache and only the endpoint clears it.
  if [[ "$DRY_RUN" != true ]]; then
    $SUDO docker exec "$REDIS_CONTAINER" redis-cli del messages >/dev/null 2>&1 || \
      warn "could not DEL the redis 'messages' hash"
    local cb; cb="$(http_code -X POST "$LOCALIZATION_URL/localization/messages/cache-bust")"
    [[ "$cb" =~ ^[23] ]] && ok "localization cache busted (HTTP $cb)" || warn "cache-bust -> HTTP $cb"
    note "Browsers also cache Digit.Locale.* in localStorage (~24h) — clear site data to see changes."
  fi
}

# =============================================================================
# STEP 6 — Flush the oauth token store.
#
# egov-user's Spring OAuth redis token store replays the FROZEN authentication
# from a user's first login: role grants do not reach existing sessions, and a
# service restart does not help. This invalidates EVERY session on the box.
# =============================================================================
step6() {
  step step6 "${STEP_TITLES[6]}"
  if [[ "$SKIP_TOKEN_FLUSH" == true ]]; then
    warn "SKIP_TOKEN_FLUSH=true — role grants stay invisible to existing sessions"
    return 0
  fi
  warn "this invalidates every active session on this deployment"
  if [[ "$DRY_RUN" == true ]]; then log "[dry-run] flush oauth token keys"; return 0; fi
  $SUDO docker exec "$REDIS_CONTAINER" sh -c \
    'for p in "auth:*" "auth_to_access:*" "access:*" "refresh*" "uname_to_access:*"; do
       redis-cli --scan --pattern "$p" | xargs -r redis-cli del >/dev/null; done' \
    && ok "oauth token store flushed — users must log in again" \
    || warn "token flush failed; grants will not take effect until it succeeds"
}

# =============================================================================
# STEP 7 — Verify.
#
# Each check is one an operator would otherwise have to remember. The
# all-keys-resolve check is the one that catches the failure nobody notices in
# an API response: a tile whose title renders as a raw DASHBOARD_* key.
# =============================================================================
step7() {
  step step7 "${STEP_TITLES[7]}"
  [[ "$DRY_RUN" == true ]] && { log "[dry-run] skipping verification"; return 0; }
  local rc=0

  local rows; rows="$(psql_q "select count(*) from eg_mdms_data
      where tenantid='$DASHBOARD_TENANT' and schemacode='dss.KpiDefinition' and isactive")"
  [[ "${rows:-0}" -ge "$KPI_COUNT" ]] && ok "dss.KpiDefinition: ${rows} active records" \
    || { err "dss.KpiDefinition: ${rows:-0} active, expected >= $KPI_COUNT"; rc=1; }

  # The catalog is principal-scoped: anonymous sees the PUBLIC floor, an admin
  # token sees more. Both being non-zero is the real signal.
  local anon admin
  anon="$(curl -s -X POST "$PGR_URL/pgr-services/v2/analytics/catalog/_search" \
    -H 'Content-Type: application/json' -d "{\"RequestInfo\":{},\"tenantId\":\"$DASHBOARD_TENANT\"}" \
    | jq -r '.total // (.kpis | length) // 0')"
  admin="$(curl -s -X POST "$PGR_URL/pgr-services/v2/analytics/catalog/_search" \
    -H 'Content-Type: application/json' \
    -d "{\"RequestInfo\":{\"authToken\":\"$AUTH_TOKEN\"},\"tenantId\":\"$DASHBOARD_TENANT\"}" \
    | jq -r '.total // (.kpis | length) // 0')"
  log "catalog/_search — anonymous ${anon}, admin ${admin}"
  [[ "${admin:-0}" -gt 0 ]] && ok "catalog serves KPIs to an authenticated admin" \
    || { err "catalog is empty for the admin principal"; rc=1; }

  # Sidebar grants. Step 7 previously verified the data plane only, so a run
  # in which every grant failed still ended with "Dashboard enabled" — the
  # user would reach the page by URL and never see a link to it.
  local granted expected
  # Match on the actionid FIELD, not on a `%.<id>` uniqueIdentifier pattern:
  # the uid is `ROLE.ACTION` only where the master was seeded with explicit
  # uids. Schema-derived uids are hashes, and the pattern would report zero
  # grants on a correctly granted deployment.
  granted="$(psql_q "select count(*) from eg_mdms_data
      where schemacode='ACCESSCONTROL-ROLEACTIONS.roleactions' and tenantid='$DASHBOARD_TENANT'
        and data->>'actionid' = '${DASHBOARD_ACTION_ID}' and isactive")"
  expected="$(python3 -c "
import json
rmap=json.loads('''$ROLE_MAP_JSON''')
roles=[rmap.get(r.strip(),r.strip()) for r in '''$DASHBOARD_ALLOWED_ROLES'''.split(',') if r.strip()]
print(len(dict.fromkeys(roles)))")"
  if [[ "${granted:-0}" -ge "${expected:-1}" ]]; then
    ok "sidebar action granted to ${granted} role(s)"
  else
    err "sidebar action granted to only ${granted:-0} of ${expected} gate role(s) — the link will be missing for the rest"
    rc=1
  fi

  local tiles; tiles="$(curl -s -X POST "$PGR_URL/pgr-services/v2/analytics/packs" \
    -H 'Content-Type: application/json' \
    -d "{\"RequestInfo\":{\"authToken\":\"$AUTH_TOKEN\"},\"tenantId\":\"$DASHBOARD_TENANT\"}" \
    | jq -r '.tiles | length // 0')"
  [[ "${tiles:-0}" -gt 0 ]] && ok "/packs returns ${tiles} tiles for the admin's role" \
    || { err "/packs returned no tiles — check the pack's personas against your roles"; rc=1; }

  # A tile that renders but queries nothing is the #1280 department-scope trap.
  local q
  q="$(curl -s -X POST "$PGR_URL/pgr-services/v2/analytics/_query" -H 'Content-Type: application/json' \
    -d "{\"RequestInfo\":{\"authToken\":\"$AUTH_TOKEN\"},\"tenantId\":\"$DASHBOARD_TENANT\",
         \"query\":{\"kpiId\":\"cl_new_created_count\"}}")"
  local scope; scope="$(printf '%s' "$q" | jq -c '.scope // empty')"
  [[ -n "$scope" ]] && log "_query scope: $scope"
  printf '%s' "$q" | jq -e '.rows' >/dev/null 2>&1 && ok "_query returns rows" \
    || warn "_query returned no rows: $(printf '%s' "$q" | head -c 160)"

  # All-keys-resolve: every title/subtitle/label key in the LIVE catalog must
  # exist in EVERY enabled locale. Exact match — the CMS-DASHBOARD. prefix is
  # part of the code, not a module.
  #
  # Verify against the locales the deployment actually OFFERS (StateInfo
  # .languages), not just the ones we ship packs for. A locale a user can pick
  # from the language menu but that we never seeded is precisely the gap that
  # renders raw DASHBOARD_* keys — checking only our own packs would call that
  # deployment clean. (Live example: bomet offers fr_FR, which has no repo pack.)
  local locales="${DASHBOARD_LOCALES//,/ }"
  if [[ -z "$locales" ]]; then
    locales="$(psql_q "select string_agg(distinct l->>'value', ' ') from eg_mdms_data d,
        lateral jsonb_array_elements(d.data->'languages') l
        where d.schemacode='common-masters.StateInfo' and d.tenantid='$DASHBOARD_TENANT'")"
    [[ -n "$locales" ]] || locales="$(cd "$DSS_L10N_DIR" && ls ./*.json | sed 's|.*/||; s/\.json$//' | tr '\n' ' ')"
  fi
  log "verifying locales: $locales"
  for loc in $locales; do
    local missing
    # A locale the deployment offers but for which this repo ships no pack is
    # a real gap, but not one this run introduced or can close — the pack has
    # to be authored first. Report it, do not fail the enablement on it.
    if [[ ! -f "$DSS_L10N_DIR/${loc}.json" ]]; then
      warn "$loc is offered in StateInfo.languages but this repo ships no pack — tiles will show raw keys"
      note "Author a $loc pack in digit-mcp/src/tools/dashboard-l10n-seed.ts, then re-run --only step5."
      continue
    fi
    missing="$(psql_q "
      with keys as (
        select distinct k from eg_mdms_data d,
          lateral jsonb_path_query(d.data, '\$.**.titleKey') k
        where d.schemacode='dss.KpiDefinition' and d.tenantid='$DASHBOARD_TENANT' and d.isactive
      )
      select count(*) from keys
      where trim(both '\"' from k::text) not in
        (select code from message where locale='$loc' and tenantid like '${DASHBOARD_TENANT}%')")"
    [[ "${missing:-0}" -eq 0 ]] && ok "$loc — every catalog titleKey resolves" \
      || { err "$loc — ${missing} catalog titleKey(s) have no message (tiles show raw keys)"; rc=1; }
  done

  if [[ $rc -eq 0 ]]; then
    printf '\n   %s%sDashboard enabled at %s.%s\n' "${C_BOLD}" "${C_GRN}" "$DASHBOARD_TENANT" "${C_RESET}"
    note "Log in as a user holding one of: ${DASHBOARD_ALLOWED_ROLES}"
    note "Home card + sidebar entry, then /employee/dashboard."
  else
    err "verification found problems — see above"
  fi
  return $rc
}

# =============================================================================
# CLI.
# =============================================================================
# Print the header block: every line from line 2 up to the closing banner,
# so the help never truncates when the header grows.
usage() {
  awk 'NR>1 { if ($0 !~ /^#/) exit; sub(/^# ?/, ""); print }' "${BASH_SOURCE[0]}"
}

# require_arg <flag> <value> — a flag that takes an argument must get one.
# Without this, `--only` with nothing after it dies on `$2: unbound variable`
# under `set -u`.
require_arg() {
  [[ -n "${2:-}" && "${2:-}" != --* ]] || { err "$1 needs an argument"; exit 2; }
}

# valid_step <name> — is this one of the known step ids?
valid_step() {
  local s
  for s in "${ALL_STEPS[@]}"; do [[ "$s" == "$1" ]] && return 0; done
  return 1
}

RUN_STEPS=("${ALL_STEPS[@]}")
main() {
  local only="" from="" to=""
  while [[ $# -gt 0 ]]; do
    case "$1" in
      --help|-h) usage; exit 0 ;;
      --list) local i=0; for s in "${ALL_STEPS[@]}"; do printf '%s  %s\n' "$s" "${STEP_TITLES[$i]}"; i=$((i+1)); done; exit 0 ;;
      --dry-run) DRY_RUN=true ;;
      --repair) DO_REPAIR=true ;;
      --update) DO_UPDATE=true ;;
      --no-color) NO_COLOR=1 ;;
      --only) require_arg --only "${2:-}"; only="$2"; shift ;;
      --from) require_arg --from "${2:-}"; from="$2"; shift ;;
      --to)   require_arg --to   "${2:-}"; to="$2";   shift ;;
      *) err "unknown argument: $1"; usage; exit 2 ;;
    esac
    shift
  done
  init_colors

  # Validate step names up front. A typo used to select nothing and exit 0,
  # which reads exactly like a successful run that had nothing to do.
  local s
  for s in ${only//,/ } $from $to; do
    valid_step "$s" || { err "unknown step: $s"; note "Known steps: ${ALL_STEPS[*]}"; exit 2; }
  done

  if [[ -n "$only" ]]; then
    IFS=',' read -r -a RUN_STEPS <<< "$only"
  else
    local sel=() started=false
    for s in "${ALL_STEPS[@]}"; do
      [[ -n "$from" && "$s" != "$from" && "$started" == false ]] && continue
      started=true; sel+=("$s")
      [[ -n "$to" && "$s" == "$to" ]] && break
    done
    RUN_STEPS=("${sel[@]}")
  fi
  [[ ${#RUN_STEPS[@]} -gt 0 ]] || { err "no steps selected"; exit 2; }

  printf '%s%s enable-dashboard.sh — tenant=%s, mdms=%s%s\n' \
    "${C_BOLD}" "${C_CYN}" "$DASHBOARD_TENANT" "$MDMS_URL" "${C_RESET}"
  [[ "$DRY_RUN" == true ]] && warn "DRY RUN — nothing will be written"

  # Steps other than step0 still need auth + the role map when run standalone.
  if [[ " ${RUN_STEPS[*]} " != *" step0 "* ]]; then
    build_role_map
    KPI_COUNT="$(jq 'length' "$DSS_DATA_DIR/KpiDefinition.json" 2>/dev/null || echo 0)"
    [[ "$DRY_RUN" == true ]] || mint_request_info
  fi

  # Call each step DIRECTLY rather than as `"$s" || { … }`. A function invoked
  # on the left of `||` runs with errexit suppressed for its whole body, so an
  # unchecked failing command mid-step would be ignored — `set -euo pipefail`
  # would be decorative. The ERR trap gives the same friendly message without
  # disarming it.
  local CURRENT_STEP
  trap 'err "step ${CURRENT_STEP:-?} failed — stopping"; exit 1' ERR
  for s in "${RUN_STEPS[@]}"; do
    CURRENT_STEP="$s"
    "$s"
  done
  trap - ERR
}

main "$@"
