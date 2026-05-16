#!/usr/bin/env bash
# Seeds notification MDMS schemas + per-tenant TemplateBinding /
# ProviderDetail records into a running DIGIT.
#
# Architectural note: novu-bridge resolves templates by calling
# digit-config-service, which has its OWN postgres table
# (`eg_config_data`), NOT MDMS. Data records therefore go through
# config-service `/config/v1/_create/<schema>`, not mdms-v2 `/_create`.
# Schemas are registered ONCE in mdms-v2 (config-service validates
# data against the MDMS schema at create-time).
#
# Required env:
#   DIGIT_URL          — Kong gateway (default: http://localhost:18000)
#   DIGIT_USERNAME     — admin user (default: ADMIN)
#   DIGIT_PASSWORD     — admin password (default: eGov@123)
#   TENANT             — target tenant (e.g. ke.bomet)
#   TWILIO_ACCOUNT_SID
#   TWILIO_AUTH_TOKEN
#   TWILIO_FROM        — E.164. For SMS use a Twilio number you own.
#                        For WhatsApp prefix with `whatsapp:`, e.g.
#                        whatsapp:+14155238886 for the sandbox.
#
# Idempotent: re-runs report `successful (already exists)` for any
# record/schema that's already present.

set -euo pipefail

DIGIT_URL="${DIGIT_URL:-http://localhost:18000}"
CONFIG_SERVICE_URL="${CONFIG_SERVICE_URL:-http://digit-config-service:8080}"
DIGIT_USERNAME="${DIGIT_USERNAME:-ADMIN}"
DIGIT_PASSWORD="${DIGIT_PASSWORD:-eGov@123}"
: "${TENANT:?must set TENANT (e.g. ke.bomet)}"
: "${TWILIO_ACCOUNT_SID:?must set TWILIO_ACCOUNT_SID}"
: "${TWILIO_AUTH_TOKEN:?must set TWILIO_AUTH_TOKEN}"
: "${TWILIO_FROM:?must set TWILIO_FROM (e.g. +19789991227 for SMS, whatsapp:+14155238886 for WA sandbox)}"

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="${TENANT%%.*}"

echo "==> Seeding notif config for tenant=$TENANT (root=$ROOT)"

# ────────── 1. Auth (capture token AND userInfo) ──────────
# MDMS-v2 and config-service both require `userInfo` inside RequestInfo
# (Spring boot enrichAuditDetails throws NullCheckException otherwise).
# We pull the full /oauth/token response so we can lift the UserRequest
# block straight into USERINFO_JSON for downstream calls.
AUTH_FULL="$(curl -fsS -X POST "$DIGIT_URL/user/oauth/token" \
  -u 'egov-user-client:' \
  -H 'Content-Type: application/x-www-form-urlencoded' \
  --data-urlencode "username=$DIGIT_USERNAME" \
  --data-urlencode "password=$DIGIT_PASSWORD" \
  --data-urlencode "grant_type=password" \
  --data-urlencode "scope=read" \
  --data-urlencode "tenantId=$ROOT" \
  --data-urlencode "userType=EMPLOYEE")"

TOKEN="$(echo "$AUTH_FULL" | jq -r '.access_token')"
export USERINFO_JSON="$(echo "$AUTH_FULL" | jq -c \
  '{id:.UserRequest.id, uuid:.UserRequest.uuid, userName:.UserRequest.userName,
    name:.UserRequest.name, type:.UserRequest.type,
    tenantId:.UserRequest.tenantId, roles:.UserRequest.roles}')"

[[ -z "$TOKEN" || "$TOKEN" == "null" ]] && { echo "auth failed: $AUTH_FULL"; exit 1; }
echo "    got token: ${TOKEN:0:8}..."
echo "    got userInfo: ${USERINFO_JSON:0:60}..."

# ────────── 2. Register schemas in MDMS-v2 (idempotent) ──────────
# config-service validates against the schema registered here on
# every `_create`. The schemas are tenant-agnostic — register at
# root only.
for schema in TemplateBinding ProviderDetail; do
  echo "==> Registering schema: $schema"
  body="$(jq -cn \
    --arg code "$schema" \
    --arg tenant "$ROOT" \
    --argjson definition "$(cat "$SCRIPT_DIR/schemas/$schema.json")" \
    '{
      RequestInfo: { authToken: env.TOKEN, apiId: "Rainmaker",
                     userInfo: (env.USERINFO_JSON | fromjson) },
      SchemaDefinition: {
        tenantId: $tenant,
        code: $code,
        description: $code,
        definition: $definition,
        isActive: true
      }
    }')"
  TOKEN="$TOKEN" curl -sS -X POST \
    "$DIGIT_URL/mdms-v2/schema/v1/_create" \
    -H "Content-Type: application/json" \
    -d "$body" \
    -o /tmp/seed-resp.json -w '    %{http_code}\n' || true
  if grep -qE 'DUPLICATE|already exist' /tmp/seed-resp.json 2>/dev/null; then
    echo "    (already exists — fine)"
  fi
done

# ────────── 3. Seed data records via CONFIG-SERVICE (UPSERT) ──────────
# Going through config-service directly (NOT mdms-v2 `_create`)
# because the bridge reads from config-service's own postgres table.
#
# This is an UPSERT, not create-only. A create-only seed cannot apply
# corrections to an already-deployed tenant: config-service rejects a
# second `_create` for the same x-unique tuple with DUPLICATE_RECORD,
# so a stale row (wrong channel / missing contentSid / placeholder
# credentials) would silently survive a re-run. On DUPLICATE we look
# up the existing record by its x-unique tuple and `_update` it.
#
# Routing reality (observed on real deployments): Kong typically routes
# config-service `_create` and `_resolve` but NOT `_search` / `_update`.
# `_update` (needed for the upsert) and `_search` (needed to find the
# existing record's `id`, which `_update` requires) therefore only work
# against config-service directly. We probe for a base that can `_search`
# and use it for the whole upsert; if none is reachable we fall back to
# create-only and warn loudly that corrections were skipped.
RI_JSON="{\"authToken\":\"$TOKEN\",\"apiId\":\"Rainmaker\",\"userInfo\":$USERINFO_JSON}"

# A base supports the upsert iff `_search` returns a config-service
# response (not Kong's "no Route matched" 404).
cfg_supports_search() {
  local base="$1" code
  code="$(curl -sS -o /tmp/cfg-probe.json -w '%{http_code}' -X POST \
    "$base/config/v1/_search" -H 'Content-Type: application/json' \
    -d "{\"RequestInfo\":$RI_JSON,\"criteria\":{\"tenantId\":\"$TENANT\",\"schemaCode\":\"TemplateBinding\"}}" \
    2>/dev/null)" || return 1
  grep -q 'no Route matched' /tmp/cfg-probe.json 2>/dev/null && return 1
  [ "$code" = "200" ]
}

# Direct config-service supports full CRUD; Kong usually only create+resolve.
# Prefer direct (the ansible/in-cluster path), fall back to Kong.
CRUD_BASE=""
for cand in "$CONFIG_SERVICE_URL/config-service" "$DIGIT_URL/config-service"; do
  if cfg_supports_search "$cand"; then CRUD_BASE="$cand"; break; fi
done
CREATE_BASE="$DIGIT_URL/config-service"
if [ -n "$CRUD_BASE" ]; then
  CREATE_BASE="$CRUD_BASE"
  echo "    config-service base (full upsert): $CRUD_BASE"
else
  echo "    WARNING: no config-service base can _search/_update from here"
  echo "    WARNING: running CREATE-ONLY via $CREATE_BASE — existing rows"
  echo "    WARNING: will NOT be corrected. Re-run in-cluster (set"
  echo "    WARNING: CONFIG_SERVICE_URL) to apply updates to a live tenant."
fi

# Extract the x-unique signature of a record's data, per schema.
uniq_sig() {
  jq -r --arg s "$1" '
    if $s == "TemplateBinding"
    then [.eventName, .channel, .locale] | @tsv
    else [.providerName, .channel]      | @tsv end'
}

TWILIO_FROM_JSON="$TWILIO_FROM"
for f in "$SCRIPT_DIR/data/template-bindings.json" "$SCRIPT_DIR/data/provider-details.json"; do
  echo "==> Seeding $(basename "$f")"
  rendered="$(sed \
    -e "s|{{TENANT}}|$TENANT|g" \
    -e "s|{{ROOT_TENANT}}|$ROOT|g" \
    -e "s|{{TWILIO_ACCOUNT_SID}}|$TWILIO_ACCOUNT_SID|g" \
    -e "s|{{TWILIO_AUTH_TOKEN}}|$TWILIO_AUTH_TOKEN|g" \
    -e "s|{{TWILIO_FROM}}|$TWILIO_FROM_JSON|g" \
    "$f")"

  echo "$rendered" | jq -c '.[] | select(has("schemaCode"))' | while read -r record; do
    schema="$(echo "$record" | jq -r '.schemaCode')"
    data="$(echo "$record" | jq -c '.data')"
    # uniqueIdentifier is config-service's opaque key. We compute a
    # deterministic one for the create; on update we KEEP whatever the
    # existing row already has (it may differ — e.g. a legacy '.sms.'
    # id whose data was later flipped to whatsapp; matching on the
    # x-unique data tuple, not this string, is what's correct).
    uid="$(echo "$data" | jq -r --arg s "$schema" '
      if $s == "TemplateBinding" then
        "\(.tenantId).\(.eventName).\(.channel).\(.locale)"
      else
        "\(.tenantId).\(.providerName).\(.channel)"
      end')"
    sig="$(echo "$data" | uniq_sig "$schema")"
    mk_body() { # $1=id (optional), $2=uniqueIdentifier
      jq -cn --arg tenant "$TENANT" --arg schema "$schema" \
        --arg uid "$2" --arg id "$1" --argjson data "$data" '
        { RequestInfo: { authToken: env.TOKEN, apiId: "Rainmaker",
                         userInfo: (env.USERINFO_JSON | fromjson) },
          configData: ({ tenantId: $tenant, uniqueIdentifier: $uid,
                         schemaCode: $schema, isActive: true, data: $data }
                       + (if $id == "" then {} else { id: $id } end)) }'
    }

    code="$(TOKEN="$TOKEN" curl -sS -o /tmp/seed-resp.json -w '%{http_code}' \
      -X POST "$CREATE_BASE/config/v1/_create/$schema" \
      -H "Content-Type: application/json" -d "$(mk_body '' "$uid")" 2>/dev/null || echo 000)"

    if [ "$code" = "200" ] || [ "$code" = "201" ] || [ "$code" = "202" ]; then
      echo "    created  $schema  $sig"
      continue
    fi
    if ! grep -qE 'DUPLICATE|already exist|unique' /tmp/seed-resp.json 2>/dev/null; then
      echo "    FAILED   $schema  $sig  (http $code)"
      head -c 200 /tmp/seed-resp.json; echo
      continue
    fi

    # Duplicate → reconcile via update.
    if [ -z "$CRUD_BASE" ]; then
      echo "    SKIPPED  $schema  $sig  (exists; _update unreachable here)"
      continue
    fi
    existing="$(TOKEN="$TOKEN" curl -sS -X POST \
      "$CRUD_BASE/config/v1/_search" -H 'Content-Type: application/json' \
      -d "{\"RequestInfo\":$RI_JSON,\"criteria\":{\"tenantId\":\"$TENANT\",\"schemaCode\":\"$schema\"}}" \
      2>/dev/null)"
    match="$(echo "$existing" | jq -c --arg s "$schema" --arg sig "$sig" '
      (.configData // []) | map(select(
        ((.data | if $s == "TemplateBinding"
                  then [.eventName,.channel,.locale]
                  else [.providerName,.channel] end) | @tsv) == $sig
      )) | .[0] // empty')"
    if [ -z "$match" ]; then
      echo "    FAILED   $schema  $sig  (duplicate but no match found to update)"
      continue
    fi
    eid="$(echo "$match" | jq -r '.id')"
    euid="$(echo "$match" | jq -r '.uniqueIdentifier // empty')"
    [ -z "$euid" ] && euid="$uid"
    ucode="$(TOKEN="$TOKEN" curl -sS -o /tmp/seed-resp.json -w '%{http_code}' \
      -X POST "$CRUD_BASE/config/v1/_update/$schema" \
      -H "Content-Type: application/json" -d "$(mk_body "$eid" "$euid")" 2>/dev/null || echo 000)"
    if [ "$ucode" = "200" ] || [ "$ucode" = "201" ]; then
      echo "    updated  $schema  $sig"
    else
      echo "    FAILED   $schema  $sig  (update http $ucode)"
      head -c 200 /tmp/seed-resp.json; echo
    fi
  done
done

echo
echo "Seed complete. Verify (run in-cluster — Kong usually won't route _search):"
echo "  curl -X POST '\$CONFIG_SERVICE_URL/config-service/config/v1/_search' \\"
echo "    -H 'Content-Type: application/json' \\"
echo "    -d '{\"RequestInfo\":{\"apiId\":\"Rainmaker\"},\"criteria\":{\"tenantId\":\"$TENANT\",\"schemaCode\":\"TemplateBinding\"}}'"
