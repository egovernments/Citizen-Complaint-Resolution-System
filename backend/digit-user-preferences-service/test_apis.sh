#!/usr/bin/env bash
#
# Acceptance run for the User Preferences Service against a live instance.
#
#   BASE_URL=http://localhost:8080 ./test_apis.sh
#
# Every case asserts an HTTP status and, where it matters, a field in the body,
# and the script exits non-zero if any of them fail — so it is usable as a
# post-deploy gate and not only as something to eyeball. Requires curl and jq.
#
# The expectations here are the API contract as the Go implementation defined
# it; the JUnit suite under src/test asserts the same behaviour in-process.
set -uo pipefail

GREEN='\033[0;32m'
RED='\033[0;31m'
BLUE='\033[0;34m'
NC='\033[0m'

BASE_URL="${BASE_URL:-http://localhost:8080}"
CONTEXT_PATH="${CONTEXT_PATH:-/user-preference}"
API="${BASE_URL}${CONTEXT_PATH}/v1"

# Unique per run so repeated runs against one database stay independent.
SUFFIX="${RANDOM}${RANDOM}"
USER_A="e2e-user-a-${SUFFIX}"
USER_B="e2e-user-b-${SUFFIX}"
USER_G="e2e-user-global-${SUFFIX}"
TENANT="pg.citya"
CODE="USER_NOTIFICATION_PREFERENCES"

PASSED=0
FAILED=0
BODY=""
STATUS=""

fail() {
    printf "${RED}  ✗ %s${NC}\n" "$1"
    printf "    status=%s body=%s\n" "$STATUS" "$BODY"
    FAILED=$((FAILED + 1))
}

pass() {
    printf "${GREEN}  ✓ %s${NC}\n" "$1"
    PASSED=$((PASSED + 1))
}

# call <METHOD> <URL> [BODY]
call() {
    local method="$1" url="$2" payload="${3-}" response
    if [ -n "$payload" ]; then
        response=$(curl -s -w "\n%{http_code}" -X "$method" "$url" \
            -H "Content-Type: application/json" -d "$payload")
    else
        response=$(curl -s -w "\n%{http_code}" -X "$method" "$url")
    fi
    STATUS=$(printf '%s' "$response" | tail -n1)
    BODY=$(printf '%s' "$response" | sed '$d')
}

expect_status() {
    if [ "$STATUS" = "$1" ]; then
        pass "$2"
    else
        fail "$2 (expected HTTP $1, got $STATUS)"
    fi
}

# expect_json <jq-filter> <expected> <description>
expect_json() {
    local actual
    actual=$(printf '%s' "$BODY" | jq -r "$1" 2>/dev/null)
    if [ "$actual" = "$2" ]; then
        pass "$3"
    else
        fail "$3 (expected '$2' at '$1', got '$actual')"
    fi
}

section() {
    printf "\n${BLUE}%s${NC}\n" "$1"
}

command -v jq >/dev/null || { printf "${RED}jq is required${NC}\n"; exit 2; }

printf "${BLUE}========================================${NC}\n"
printf "${BLUE}User Preferences Service — %s${NC}\n" "$API"
printf "${BLUE}========================================${NC}\n"

# ── Health ──────────────────────────────────────────────────────────────────
# Served at the container root, NOT under the context path: the compose
# healthcheck, both Kubernetes probes and both Gatus catalogues all use this.
section "1. Health"
call GET "${BASE_URL}/health"
expect_status 200 "health responds"
expect_json '.status' "UP" "health reports UP"
expect_json '.components.database.status' "UP" "health reports the database UP"

# ── Upsert: create ──────────────────────────────────────────────────────────
section "2. Upsert — create"
call POST "${API}/_upsert" "$(cat <<JSON
{
  "RequestInfo": {
    "apiId": "user-preferences", "ver": "1.0", "ts": 1707100000000,
    "action": "upsert", "msgId": "e2e-001",
    "userInfo": { "uuid": "${USER_A}", "tenantId": "${TENANT}" }
  },
  "preference": {
    "userId": "${USER_A}", "tenantId": "${TENANT}", "preferenceCode": "${CODE}",
    "payload": {
      "preferredLanguage": "en_IN",
      "consent": {
        "WHATSAPP": { "status": "GRANTED", "scope": "GLOBAL" },
        "SMS": { "status": "GRANTED", "scope": "TENANT", "tenantId": "${TENANT}" },
        "EMAIL": { "status": "REVOKED", "scope": "GLOBAL" }
      }
    }
  }
}
JSON
)"
expect_status 200 "create accepted"
expect_json '.responseInfo.status' "successful" "responseInfo reports success"
expect_json '.responseInfo.apiId' "user-preferences" "responseInfo echoes apiId"
expect_json '.responseInfo.msgId' "e2e-001" "responseInfo echoes msgId"
expect_json '.responseInfo | has("resMsgId")' "false" "responseInfo omits resMsgId"
expect_json 'has("pagination")' "false" "an upsert carries no pagination block"
expect_json '.preferences | length' "1" "one preference returned"
expect_json '.preferences[0].userId' "${USER_A}" "userId round-trips"
expect_json '.preferences[0].tenantId' "${TENANT}" "tenantId round-trips"
expect_json '.preferences[0].payload.preferredLanguage' "en_IN" "language round-trips"
expect_json '.preferences[0].payload.consent.SMS.tenantId' "${TENANT}" "tenant-scoped consent round-trips"
expect_json '.preferences[0].auditDetails.createdBy' "${USER_A}" "audit records the caller"

CREATED_ID=$(printf '%s' "$BODY" | jq -r '.preferences[0].id')
CREATED_TIME=$(printf '%s' "$BODY" | jq -r '.preferences[0].auditDetails.createdTime')
if printf '%s' "$CREATED_ID" | grep -Eq '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'; then
    pass "id is a uuid"
else
    fail "id is a uuid (got '$CREATED_ID')"
fi

# ── Search ──────────────────────────────────────────────────────────────────
section "3. Search"
call POST "${API}/_search" "$(cat <<JSON
{
  "RequestInfo": { "apiId": "user-preferences", "ver": "1.0", "msgId": "e2e-002" },
  "criteria": { "userId": "${USER_A}", "tenantId": "${TENANT}", "limit": 10, "offset": 0 }
}
JSON
)"
expect_status 200 "search accepted"
expect_json '.preferences | length' "1" "the created preference is found"
expect_json '.preferences[0].id' "${CREATED_ID}" "the same row comes back"
expect_json '.pagination.limit' "10" "pagination echoes the limit"
expect_json '.pagination.totalCount' "1" "pagination counts the matches"
expect_json '.pagination | has("offset")' "false" "a zero offset is omitted"

# ── Upsert: update ──────────────────────────────────────────────────────────
section "4. Upsert — update on the same key"
call POST "${API}/_upsert" "$(cat <<JSON
{
  "RequestInfo": { "msgId": "e2e-003", "userInfo": { "uuid": "e2e-editor-${SUFFIX}" } },
  "preference": {
    "userId": "${USER_A}", "tenantId": "${TENANT}", "preferenceCode": "${CODE}",
    "payload": {
      "preferredLanguage": "hi_IN",
      "consent": { "WHATSAPP": { "status": "REVOKED", "scope": "GLOBAL" } }
    }
  }
}
JSON
)"
expect_status 200 "update accepted"
expect_json '.preferences[0].id' "${CREATED_ID}" "the upsert lands on the existing row"
expect_json '.preferences[0].payload.preferredLanguage' "hi_IN" "the payload is replaced"
expect_json '.preferences[0].payload.consent | has("SMS")' "false" "the payload is replaced, not merged"
expect_json '.preferences[0].auditDetails.createdBy' "${USER_A}" "the creation author is preserved"
expect_json '.preferences[0].auditDetails.createdTime' "${CREATED_TIME}" "the creation time is preserved"
expect_json '.preferences[0].auditDetails.lastModifiedBy' "e2e-editor-${SUFFIX}" "the editor is recorded"

call POST "${API}/_search" "{\"RequestInfo\":{},\"criteria\":{\"userId\":\"${USER_A}\",\"preferenceCode\":\"${CODE}\"}}"
expect_status 200 "search after update"
expect_json '.pagination.totalCount' "1" "the update did not create a second row"
expect_json '.preferences[0].payload.preferredLanguage' "hi_IN" "the update is durable"

# ── Global (untenanted) preferences ─────────────────────────────────────────
section "5. Global preferences"
call POST "${API}/_upsert" "$(cat <<JSON
{
  "RequestInfo": { "userInfo": { "uuid": "${USER_G}" } },
  "preference": {
    "userId": "${USER_G}", "preferenceCode": "${CODE}",
    "payload": { "preferredLanguage": "fr_IN" }
  }
}
JSON
)"
expect_status 200 "a preference with no tenant is accepted"
expect_json '.preferences[0] | has("tenantId")' "false" "an absent tenant is omitted from the response"
GLOBAL_ID=$(printf '%s' "$BODY" | jq -r '.preferences[0].id')

call POST "${API}/_upsert" "$(cat <<JSON
{
  "RequestInfo": { "userInfo": { "uuid": "${USER_G}" } },
  "preference": {
    "userId": "${USER_G}", "preferenceCode": "${CODE}",
    "payload": { "preferredLanguage": "pt_IN" }
  }
}
JSON
)"
expect_json '.preferences[0].id' "${GLOBAL_ID}" "a second global upsert reuses the global row"

call POST "${API}/_upsert" "$(cat <<JSON
{
  "RequestInfo": { "userInfo": { "uuid": "${USER_G}" } },
  "preference": {
    "userId": "${USER_G}", "tenantId": "${TENANT}", "preferenceCode": "${CODE}",
    "payload": { "preferredLanguage": "en_IN" }
  }
}
JSON
)"
expect_status 200 "the same user can also hold a tenant-scoped preference"
TENANTED_ID=$(printf '%s' "$BODY" | jq -r '.preferences[0].id')
if [ "$TENANTED_ID" != "$GLOBAL_ID" ]; then
    pass "tenant-scoped and global preferences are distinct rows"
else
    fail "tenant-scoped and global preferences are distinct rows"
fi

# ── Paging and ordering ─────────────────────────────────────────────────────
section "6. Paging and ordering"
call POST "${API}/_upsert" "$(cat <<JSON
{
  "RequestInfo": {},
  "preference": {
    "userId": "${USER_B}", "tenantId": "${TENANT}", "preferenceCode": "${CODE}",
    "payload": { "preferredLanguage": "en_IN" }
  }
}
JSON
)"
expect_status 200 "a second tenant preference is created"

call POST "${API}/_search" "{\"RequestInfo\":{},\"criteria\":{\"tenantId\":\"${TENANT}\",\"limit\":1,\"offset\":0}}"
expect_status 200 "a one-row page is returned"
expect_json '.preferences | length' "1" "the page holds one row"
expect_json '.pagination.limit' "1" "the page size is echoed"
PAGE_TOTAL=$(printf '%s' "$BODY" | jq -r '.pagination.totalCount')
if [ "$PAGE_TOTAL" -ge 3 ]; then
    pass "totalCount counts every match, not just the page ($PAGE_TOTAL)"
else
    fail "totalCount counts every match, not just the page (got $PAGE_TOTAL)"
fi

call POST "${API}/_search" "{\"RequestInfo\":{},\"criteria\":{\"tenantId\":\"${TENANT}\",\"limit\":1,\"offset\":1}}"
expect_json '.pagination.offset' "1" "a non-zero offset is echoed"
expect_json '.preferences | length' "1" "the second page holds one row"

call POST "${API}/_search" "{\"RequestInfo\":{},\"criteria\":{\"tenantId\":\"${TENANT}\",\"limit\":9999}}"
expect_json '.pagination.limit' "100" "an oversized page is clamped to 100"

call POST "${API}/_search" "{\"RequestInfo\":{},\"criteria\":{\"userId\":\"${USER_A}\"}}"
expect_json '.pagination.limit' "10" "an absent limit defaults to 10"

call POST "${API}/_search" "{\"RequestInfo\":{},\"criteria\":{\"userId\":\"no-such-user-${SUFFIX}\"}}"
expect_status 200 "a search that matches nothing still succeeds"
expect_json '.preferences | length' "0" "an empty array is returned, not null"
expect_json '.preferences | type' "array" "preferences is always an array"
expect_json '.pagination | has("totalCount")' "false" "a zero totalCount is omitted"

# ── Payload handling ────────────────────────────────────────────────────────
section "7. Payload handling"
call POST "${API}/_upsert" "$(cat <<JSON
{
  "RequestInfo": {},
  "preference": {
    "userId": "e2e-opaque-${SUFFIX}", "preferenceCode": "UI_DASHBOARD_LAYOUT",
    "payload": { "preferredLanguage": "kl_XX", "widgets": [ { "id": "open", "span": 2 } ] }
  }
}
JSON
)"
expect_status 200 "any other preferenceCode stores an unvalidated document"
expect_json '.preferences[0].payload.widgets[0].span' "2" "a nested payload round-trips"

call POST "${API}/_upsert" "$(cat <<JSON
{
  "RequestInfo": {},
  "preference": {
    "userId": "e2e-verbatim-${SUFFIX}", "preferenceCode": "${CODE}",
    "payload": {
      "preferredLanguage": "en_IN",
      "quietHours": { "from": "22:00" },
      "consent": { "whatsapp": { "status": "GRANTED", "scope": "GLOBAL" } }
    }
  }
}
JSON
)"
expect_status 200 "an unknown payload key is accepted"
expect_json '.preferences[0].payload.quietHours.from' "22:00" "unknown payload keys are stored verbatim"
expect_json '.preferences[0].payload.consent.whatsapp.status' "GRANTED" "the caller's key casing is preserved"
expect_json '.preferences[0].payload.consent | has("WHATSAPP")' "false" "keys are not rewritten"

# ── Validation ──────────────────────────────────────────────────────────────
section "8. Validation"
call POST "${API}/_upsert" '{"preference":{"userId":"u","preferenceCode":"CODE","payload":{}}}'
expect_status 400 "an upsert with no RequestInfo is rejected"
expect_json '.Errors[0].code' "INVALID_REQUEST_INFO" "  INVALID_REQUEST_INFO"
expect_json 'has("responseInfo")' "false" "  no responseInfo when the envelope never parsed"

call POST "${API}/_upsert" '{"RequestInfo":{"msgId":"e2e-v1"}}'
expect_status 400 "an upsert with no preference is rejected"
expect_json '.Errors[0].code' "INVALID_REQUEST" "  INVALID_REQUEST"
expect_json '.responseInfo.status' "failed" "  responseInfo reports failure"
expect_json '.responseInfo.msgId' "e2e-v1" "  responseInfo echoes msgId on failure"

call POST "${API}/_upsert" "{\"RequestInfo\":{},\"preference\":{\"preferenceCode\":\"${CODE}\",\"payload\":{}}}"
expect_status 400 "a missing userId is rejected"
expect_json '.Errors[0].code' "INVALID_USER_ID" "  INVALID_USER_ID"
expect_json '.Errors[0].message' "userId is required" "  message wording"

call POST "${API}/_upsert" '{"RequestInfo":{},"preference":{"userId":"u","payload":{}}}'
expect_status 400 "a missing preferenceCode is rejected"
expect_json '.Errors | length' "2" "  both the missing and out-of-range errors are returned"
expect_json '.Errors[0].message' "preferenceCode is required" "  first error"
expect_json '.Errors[1].message' "preferenceCode must be between 2 and 128 characters" "  second error"

call POST "${API}/_upsert" '{"RequestInfo":{},"preference":{"userId":"u","preferenceCode":"CODE"}}'
expect_status 400 "a missing payload is rejected"
expect_json '.Errors[0].code' "INVALID_PAYLOAD" "  INVALID_PAYLOAD"

call POST "${API}/_upsert" "{\"RequestInfo\":{},\"preference\":{\"userId\":\"$(printf 'u%.0s' $(seq 1 65))\",\"preferenceCode\":\"CODE\",\"payload\":{}}}"
expect_status 400 "an over-long userId is rejected"
expect_json '.Errors[0].message' "userId must not exceed 64 characters" "  message wording"

call POST "${API}/_upsert" '{"RequestInfo":{},"preference":{"userId":"u","tenantId":"p","preferenceCode":"CODE","payload":{}}}'
expect_status 400 "a one-character tenantId is rejected"
expect_json '.Errors[0].code' "INVALID_TENANT_ID" "  INVALID_TENANT_ID"

call POST "${API}/_upsert" "{\"RequestInfo\":{},\"preference\":{\"userId\":\"u\",\"preferenceCode\":\"${CODE}\",\"payload\":{\"preferredLanguage\":\"ta_IN\"}}}"
expect_status 400 "an unsupported language is rejected"
expect_json '.Errors[0].code' "INVALID_LANGUAGE" "  INVALID_LANGUAGE"
expect_json '.Errors[0].message' "preferredLanguage must be one of: en_IN, hi_IN, fr_IN, pt_IN; got: ta_IN" "  the value is echoed back"

call POST "${API}/_upsert" "{\"RequestInfo\":{},\"preference\":{\"userId\":\"u\",\"preferenceCode\":\"${CODE}\",\"payload\":{\"consent\":{\"WHATSAPP\":{\"status\":\"MAYBE\"}}}}}"
expect_status 400 "an unknown consent status is rejected"
expect_json '.Errors[0].message' "WHATSAPP consent status must be GRANTED or REVOKED; got: MAYBE" "  INVALID_CONSENT_STATUS wording"

call POST "${API}/_upsert" "{\"RequestInfo\":{},\"preference\":{\"userId\":\"u\",\"preferenceCode\":\"${CODE}\",\"payload\":{\"consent\":{\"SMS\":{\"scope\":\"REGIONAL\"}}}}}"
expect_status 400 "an unknown consent scope is rejected"
expect_json '.Errors[0].message' "SMS consent scope must be GLOBAL or TENANT; got: REGIONAL" "  INVALID_CONSENT_SCOPE wording"

call POST "${API}/_upsert" "{\"RequestInfo\":{},\"preference\":{\"userId\":\"u\",\"preferenceCode\":\"${CODE}\",\"payload\":{\"consent\":{\"EMAIL\":{\"status\":\"GRANTED\",\"scope\":\"TENANT\"}}}}}"
expect_status 400 "tenant-scoped consent without a tenantId is rejected"
expect_json '.Errors[0].code' "MISSING_TENANT_ID" "  MISSING_TENANT_ID"

call POST "${API}/_upsert" "{\"RequestInfo\":{},\"preference\":{\"userId\":\"u\",\"preferenceCode\":\"${CODE}\",\"payload\":[\"en_IN\"]}}"
expect_status 400 "a notification payload that is not an object is rejected"
expect_json '.Errors[0].code' "INVALID_PAYLOAD_FORMAT" "  INVALID_PAYLOAD_FORMAT"

call POST "${API}/_upsert" "{\"RequestInfo\":{},\"preference\":{\"userId\":\"u\",\"preferenceCode\":\"${CODE}\",\"payload\":{\"consent\":{\"WHATSAPP\":{\"status\":5}}}}}"
expect_status 400 "a numeric consent status is rejected rather than coerced"
expect_json '.Errors[0].code' "INVALID_PAYLOAD_FORMAT" "  INVALID_PAYLOAD_FORMAT"

call POST "${API}/_search" '{"criteria":{"userId":"u"}}'
expect_status 400 "a search with no RequestInfo is rejected"
expect_json '.Errors[0].code' "INVALID_REQUEST_INFO" "  INVALID_REQUEST_INFO"

call POST "${API}/_search" '{"RequestInfo":{}}'
expect_status 400 "a search with no criteria is rejected"
expect_json '.Errors[0].code' "INVALID_REQUEST" "  INVALID_REQUEST"

call POST "${API}/_search" '{"RequestInfo":{},"criteria":{"limit":10}}'
expect_status 400 "an unbounded search is rejected"
expect_json '.Errors[0].code' "INVALID_CRITERIA" "  INVALID_CRITERIA"

call POST "${API}/_search" '{"RequestInfo":{},"criteria":{"userId":"u","limit":-1,"offset":-2}}'
expect_status 400 "negative paging is rejected"
expect_json '.Errors | length' "2" "  both paging errors are returned"
expect_json '.Errors[0].code' "INVALID_LIMIT" "  INVALID_LIMIT"
expect_json '.Errors[1].code' "INVALID_OFFSET" "  INVALID_OFFSET"

call POST "${API}/_upsert" '{"RequestInfo":{},'
expect_status 400 "a malformed body is rejected"
expect_json '.Errors[0].code' "INVALID_JSON" "  INVALID_JSON"

call POST "${API}/_upsert" ''
expect_status 400 "an empty body is rejected"
expect_json '.Errors[0].code' "INVALID_JSON" "  INVALID_JSON"

# ── Caller compatibility ────────────────────────────────────────────────────
# novu-bridge's PreferenceServiceClient posts a lower-camel "requestInfo";
# local-setup/scripts/seed-test-account-preferences.py posts "RequestInfo".
# Go matched keys case-insensitively, so both spellings are in production.
section "9. Caller compatibility"
call POST "${API}/_search" "$(cat <<JSON
{
  "requestInfo": {},
  "criteria": {
    "userId": "${USER_A}", "tenantId": "${TENANT}",
    "preferenceCode": "${CODE}", "limit": 1, "offset": 0
  }
}
JSON
)"
expect_status 200 "the lower-camel requestInfo novu-bridge sends is accepted"
expect_json '.preferences | length' "1" "  and returns the preference"
expect_json '.preferences[0].payload.consent.WHATSAPP.status' "REVOKED" "  consent is reachable at payload.consent.<CHANNEL>.status"

call POST "${API}/_upsert" "$(cat <<JSON
{
  "REQUESTINFO": {},
  "PREFERENCE": {
    "USERID": "e2e-casing-${SUFFIX}", "PreferenceCode": "USER_PROFILE", "Payload": { "k": "v" }
  }
}
JSON
)"
expect_status 200 "arbitrary key casing is accepted, as Go's encoding/json did"
expect_json '.preferences[0].userId' "e2e-casing-${SUFFIX}" "  the value lands on the right field"

call POST "${API}/_upsert" "$(cat <<JSON
{
  "RequestInfo": { "apiId": "seed", "plainAccessRequest": { "recordId": "r" }, "brandNew": 1 },
  "preference": { "userId": "e2e-extra-${SUFFIX}", "preferenceCode": "USER_PROFILE", "payload": { "k": "v" }, "extra": 1 }
}
JSON
)"
expect_status 200 "unknown fields are ignored rather than rejected"

call POST "${API}/_upsert" "$(cat <<JSON
{
  "RequestInfo": { "userInfo": { "id": 4242 } },
  "preference": { "userId": "e2e-numeric-${SUFFIX}", "preferenceCode": "USER_PROFILE", "payload": { "k": "v" } }
}
JSON
)"
expect_status 200 "a numeric userInfo.id is accepted"
expect_json '.preferences[0].auditDetails.createdBy' "4242" "  and is recorded as the audit author"

call POST "${API}/_upsert" "$(cat <<JSON
{
  "RequestInfo": {},
  "preference": { "userId": "e2e-anon-${SUFFIX}", "preferenceCode": "USER_PROFILE", "payload": { "k": "v" } }
}
JSON
)"
expect_json '.preferences[0].auditDetails.createdBy' "system" "an unidentified caller is attributed to system"

# ── Routing ─────────────────────────────────────────────────────────────────
section "10. Routing"
call POST "${API}/_nope" '{}'
expect_status 404 "an unknown path is a 404, not a 500"
call GET "${API}/_upsert"
expect_status 405 "a GET on _upsert is a 405"

# ── Summary ─────────────────────────────────────────────────────────────────
printf "\n${BLUE}========================================${NC}\n"
if [ "$FAILED" -eq 0 ]; then
    printf "${GREEN}All %d assertions passed.${NC}\n" "$PASSED"
else
    printf "${RED}%d of %d assertions FAILED.${NC}\n" "$FAILED" "$((PASSED + FAILED))"
fi
printf "${BLUE}========================================${NC}\n"

[ "$FAILED" -eq 0 ] || exit 1
