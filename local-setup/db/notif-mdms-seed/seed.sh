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

# ────────── 3. Seed data records via CONFIG-SERVICE ──────────
# Going through config-service directly (NOT mdms-v2 `_create`)
# because the bridge reads from config-service's own postgres table.
# Writing to mdms-v2 produces records the bridge can't find.
#
# Reachability:
#   If $DIGIT_URL routes /config-service to digit-config-service,
#   we use that. Otherwise (default), use $CONFIG_SERVICE_URL directly
#   (assumes this script runs in-cluster, e.g. via `docker exec`).
TARGET="$DIGIT_URL/config-service"
if ! curl -sf -o /dev/null "$TARGET/config/v1/_resolve" -X POST \
     -H 'Content-Type: application/json' -d '{}' \
     -w '%{http_code}' 2>/dev/null | grep -qE '^(4[0-9]{2})$'; then
  TARGET="$CONFIG_SERVICE_URL/config-service"
  echo "    using direct config-service URL: $TARGET"
fi

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

  echo "$rendered" | jq -c '.[]' | while read -r record; do
    schema="$(echo "$record" | jq -r '.schemaCode')"
    data="$(echo "$record" | jq -c '.data')"
    # Deterministic uniqueIdentifier so re-runs detect duplicates cleanly.
    # Convention matches what MDMS-v2 derives from x-unique fields:
    #   <tenantId>.<eventName>.<channel>.<locale>   (TemplateBinding)
    #   <tenantId>.<providerName>.<channel>         (ProviderDetail)
    uid="$(echo "$data" | jq -r --arg s "$schema" '
      if $s == "TemplateBinding" then
        "\(.tenantId).\(.eventName).\(.channel).\(.locale)"
      else
        "\(.tenantId).\(.providerName).\(.channel)"
      end')"
    body="$(jq -cn \
      --arg tenant "$TENANT" \
      --arg schema "$schema" \
      --arg uid "$uid" \
      --argjson data "$data" \
      '{
        RequestInfo: { authToken: env.TOKEN, apiId: "Rainmaker",
                       userInfo: (env.USERINFO_JSON | fromjson) },
        configData: {
          tenantId: $tenant,
          uniqueIdentifier: $uid,
          schemaCode: $schema,
          isActive: true,
          data: $data
        }
      }')"
    TOKEN="$TOKEN" curl -sS -X POST \
      "$TARGET/config/v1/_create/$schema" \
      -H "Content-Type: application/json" \
      -d "$body" \
      -o /tmp/seed-resp.json -w "    create %{http_code} $uid\n" || true
    if grep -qE 'DUPLICATE|already exist|unique' /tmp/seed-resp.json 2>/dev/null; then
      echo "      (already exists — fine)"
    fi
  done
done

echo
echo "Seed complete. Verify with:"
echo "  curl -X POST '$DIGIT_URL/config-service/config/v1/_search' \\"
echo "    -H 'Content-Type: application/json' \\"
echo "    -d '{\"RequestInfo\":{\"apiId\":\"Rainmaker\"},\"criteria\":{\"tenantId\":\"$TENANT\",\"schemaCode\":\"TemplateBinding\"}}'"
