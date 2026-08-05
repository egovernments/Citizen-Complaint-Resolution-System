#!/usr/bin/env bash
# Registers the common-masters.AnalyticsProvider MDMS schema on a running DIGIT.
#
# WHY THIS SCRIPT EXISTS
# ----------------------
# The schema definition lives in
#   utilities/default-data-handler/src/main/resources/schema/common-masters.json
# and default-data-handler (DDH) registers it automatically for tenants created
# AFTER that image is rebuilt. But DDH is no longer part of the compose stack on
# develop/master (removed in 03f32d5b), and no already-running environment gets a
# new schema from a repo file alone. This script is the only path that reaches an
# environment that is already up.
#
# It reads the definition straight out of the DDH resource file, so there is
# exactly ONE copy of the schema in the repo.
#
# DESIGN NOTES (each of these is a real, previously-observed failure mode)
#   * Schema codes are IMMUTABLE: mdms-v2 schema/v1/_update returns HTTP 501 and
#     there is no delete. A wrong create is permanent. Hence: search first, and
#     refuse anything suspicious rather than "trying it".
#   * A schema registered at a CITY tenant (anything containing a dot) becomes
#     permanently invisible to the search API and cannot be repaired. We hard-
#     refuse it. Schemas belong at the state root; DATA rows may live at any
#     tenant beneath it.
#   * Schema creation is ASYNCHRONOUS. Creating and immediately writing data
#     fails intermittently on a loaded box, so we poll until the definition is
#     actually readable before declaring success.
#   * schema/v1/_search answers HTTP 202, not 200. Never test for == 200.
#   * Old MDMS images silently drop schema creates whose description contains
#     non-ASCII, and the moz migration runner truncates descriptions at 500
#     chars. We cap at 500 and REFUSE non-ASCII rather than stripping it: the
#     obvious jq gsub for that is broken on jq 1.6 (see the check below).
#   * Talking to the service DIRECTLY (default :18094) sidesteps the Kong
#     auth-enrichment pre-function, which re-encodes the POST body with plain
#     lua-cjson and cannot distinguish [] from {} — the documented cause of
#     corrupted stored definitions. Direct calls must supply RequestInfo.userInfo
#     themselves or audit enrichment throws.
#
# USAGE
#   TENANT=mz ./local-setup/scripts/seed-analytics-schema.sh
#   TENANT=mz MDMS_URL=http://localhost:18094 ./local-setup/scripts/seed-analytics-schema.sh
#
# Idempotent: a second run reports "already present" and exits 0.

set -euo pipefail

MDMS_URL="${MDMS_URL:-http://localhost:18094}"
SCHEMA_CODE="common-masters.AnalyticsProvider"
POLL_TIMEOUT_SECS="${POLL_TIMEOUT_SECS:-30}"

: "${TENANT:?must set TENANT (state root only, e.g. mz — no dots)}"

# ---------- guard: state roots only ----------
case "$TENANT" in
  *.*)
    echo "REFUSING: TENANT='$TENANT' contains a dot." >&2
    echo "  A schema registered at a city tenant is permanently invisible to the" >&2
    echo "  search API and cannot be updated or deleted. Register at the state" >&2
    echo "  root (e.g. '${TENANT%%.*}'); city DATA rows work against it fine." >&2
    exit 2
    ;;
esac

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DEF_FILE="$SCRIPT_DIR/../../utilities/default-data-handler/src/main/resources/schema/common-masters.json"
[ -f "$DEF_FILE" ] || { echo "FATAL: schema source not found at $DEF_FILE" >&2; exit 1; }

command -v jq >/dev/null   || { echo "FATAL: jq is required" >&2; exit 1; }
command -v curl >/dev/null || { echo "FATAL: curl is required" >&2; exit 1; }

# Refuse to proceed if the source description is not pure ASCII. We deliberately
# do NOT strip non-ASCII here: jq 1.6's Oniguruma does not understand \uXXXX
# inside a character class, so the obvious `gsub("[^\u0020-\u007E]";"")` silently
# deletes ordinary ASCII (spaces, '/', '.', letters) and would store a mangled
# description that no API can ever repair — schema/v1/_update returns 501.
# Failing loudly and letting a human fix the source file is the safe direction.
if jq -r --arg c "$SCHEMA_CODE" 'map(select(.code == $c)) | .[0].description // ""' "$DEF_FILE" \
     | LC_ALL=C grep -q '[^ -~]'; then
  echo "FATAL: the schema description in $DEF_FILE contains non-ASCII characters." >&2
  echo "  Old mdms-v2 images silently drop such schema creates. Fix the source text" >&2
  echo "  (plain ASCII, <=500 chars) and re-run." >&2
  exit 1
fi

echo "==> Seeding $SCHEMA_CODE at tenant=$TENANT via $MDMS_URL"

# ---------- RequestInfo (direct-to-service needs userInfo for audit enrichment) ----------
request_info() {
  jq -n --arg t "$TENANT" '{
    apiId: "Rainmaker",
    ver: ".01",
    action: "_create",
    msgId: "seed-analytics-schema|en_IN",
    userInfo: { id: 1, uuid: "seed-analytics-schema", type: "SYSTEM", tenantId: $t, roles: [] }
  }'
}

# ---------- 1. does it already exist? ----------
# `limit` must sit INSIDE SchemaDefCriteria; a Pagination.limit is ignored.
search_body="$(jq -n --argjson ri "$(request_info)" --arg t "$TENANT" --arg c "$SCHEMA_CODE" \
  '{RequestInfo: $ri, SchemaDefCriteria: {tenantId: $t, codes: [$c], limit: 50}}')"

schema_present() {
  local out
  out="$(curl -s --max-time 20 -X POST "$MDMS_URL/mdms-v2/schema/v1/_search" \
          -H 'Content-Type: application/json' -d "$search_body" || true)"
  # SchemaDefinitions[] carrying our code === present. Any other shape === absent.
  echo "$out" | jq -e --arg c "$SCHEMA_CODE" \
    '[(.SchemaDefinitions // [])[] | select(.code == $c)] | length > 0' >/dev/null 2>&1
}

if schema_present; then
  echo "    already present — nothing to do."
  exit 0
fi

# ---------- 2. create ----------
# Description capped at 500 chars so the DDH loader, this script and the moz
# unified runner all store byte-identical text. ASCII purity was already enforced
# above, loudly, rather than by silently rewriting the text.
create_body="$(jq -n \
  --argjson ri "$(request_info)" \
  --arg t "$TENANT" \
  --arg c "$SCHEMA_CODE" \
  --slurpfile all "$DEF_FILE" '
  ($all[0] | map(select(.code == $c)) | .[0]) as $e
  | if $e == null then error("schema \($c) not found in source file") else . end
  | {
      RequestInfo: $ri,
      SchemaDefinition: {
        tenantId: $t,
        code: $c,
        definition: $e.definition,
        description: ($e.description // "" | .[0:500]),
        isActive: (if $e.isActive == false then false else true end)
      }
    }')"

set +e
http_code="$(curl -s -o /tmp/seed-analytics-create.out -w '%{http_code}' --max-time 30 \
  -X POST "$MDMS_URL/mdms-v2/schema/v1/_create" \
  -H 'Content-Type: application/json' -d "$create_body")"
curl_rc=$?
set -e
if [ "$curl_rc" -ne 0 ] || ! printf '%s' "$http_code" | grep -Eq '^[0-9]{3}$'; then
  http_code="000"
fi
body="$(cat /tmp/seed-analytics-create.out 2>/dev/null || true)"

if [ "$http_code" -ge 200 ] && [ "$http_code" -lt 300 ]; then
  echo "    create accepted (HTTP $http_code)"
elif echo "$body" | grep -qiE 'DUPLICATE|ALREADY|already exists'; then
  echo "    create reported duplicate (HTTP $http_code) — treating as present"
else
  echo "FATAL: schema create failed (HTTP $http_code)" >&2
  echo "$body" >&2
  exit 1
fi

# ---------- 3. poll until readable ----------
# Creation is async. Do not sleep-and-hope: poll, then fail with a named code so
# callers can distinguish "not persisted" from "call rejected".
elapsed=0
delay=1
while [ "$elapsed" -lt "$POLL_TIMEOUT_SECS" ]; do
  if schema_present; then
    echo "==> OK: $SCHEMA_CODE readable at tenant=$TENANT after ${elapsed}s"
    echo "    No records are created. Every environment stays analytics-OFF until"
    echo "    an admin enables a destination in the Configurator."
    exit 0
  fi
  sleep "$delay"
  elapsed=$((elapsed + delay))
  [ "$delay" -lt 5 ] && delay=$((delay + 1))
done

echo "SCHEMA_NOT_PERSISTED: created but not readable after ${POLL_TIMEOUT_SECS}s." >&2
echo "  Re-run this script; if it keeps failing, check mdms-v2 logs and the" >&2
echo "  eg_mdms_schema_definition table for tenantid='$TENANT'." >&2
exit 3
