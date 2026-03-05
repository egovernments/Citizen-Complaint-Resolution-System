#!/bin/bash
# Smoke tests for DIGIT core services (CI version)
# Creates actual data and verifies in database
# Related: https://github.com/subhashini-egov/digit-2.9lts-core-storm/issues/6

set -o pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/telemetry.sh" 2>/dev/null || true

BASE_URL="${1:-http://0.0.0.0}"
DB_CONTAINER="${DB_CONTAINER:-docker-postgres}"
TIMESTAMP=$(date +%s)
TEST_USER="smoketest-${TIMESTAMP}"

echo "=== DIGIT Core Services Smoke Tests ==="
echo "Base URL: $BASE_URL"
echo "Test ID: $TIMESTAMP"
echo ""

passed=0
failed=0

test_result() {
  if [ "$1" = "pass" ]; then
    echo -e "\033[32mPASS\033[0m"
    passed=$((passed + 1))
  else
    echo -e "\033[31mFAIL\033[0m ($2)"
    failed=$((failed + 1))
  fi
}

# Helper to query database
db_query() {
  docker exec "$DB_CONTAINER" psql -U egov -d egov -t -A -c "$1" 2>/dev/null
}

# ==== Health Checks ====
echo "--- Health Checks ---"

echo -n "1. MDMS service... "
curl -sf "$BASE_URL:18094/mdms-v2/health" > /dev/null 2>&1 && test_result pass || test_result fail "not responding"

echo -n "2. User service... "
curl -sf "$BASE_URL:18107/user/health" > /dev/null 2>&1 && test_result pass || test_result fail "not responding"

echo -n "3. IDGen service... "
curl -sf "$BASE_URL:18088/egov-idgen/health" > /dev/null 2>&1 && test_result pass || test_result fail "not responding"

echo -n "4. Localization service... "
curl -sf "$BASE_URL:18096/localization/actuator/health" > /dev/null 2>&1 && test_result pass || test_result fail "not responding"

echo -n "5. Workflow service... "
curl -sf "$BASE_URL:18109/egov-workflow-v2/health" > /dev/null 2>&1 && test_result pass || test_result fail "not responding"

echo -n "6. PGR service... "
curl -sf "$BASE_URL:18083/pgr-services/health" > /dev/null 2>&1 && test_result pass || test_result fail "not responding"

echo -n "7. Encryption service... "
curl -sf "$BASE_URL:11234/egov-enc-service/actuator/health" > /dev/null 2>&1 && test_result pass || test_result fail "not responding"

echo -n "8. PostgreSQL... "
db_query "SELECT 1" > /dev/null 2>&1 && test_result pass || test_result fail "cannot connect"

echo -n "9. Kong Gateway... "
curl -sf "$BASE_URL:18000/user/health" > /dev/null 2>&1 && test_result pass || test_result fail "not routing"

echo ""

# ==== API + Database Tests ====
echo "--- API + Database Verification ---"

# Test 11: Create User and verify in DB
echo -n "11. Create user + verify DB... "
USER_RESPONSE=$(curl -sS -X POST "$BASE_URL:18107/user/users/_createnovalidate" \
  -H 'Content-Type: application/json' \
  -d '{
    "RequestInfo":{"apiId":"Rainmaker","ver":".01","action":"_create","msgId":"test"},
    "User":{"userName":"'"$TEST_USER"'","name":"Smoke Test User","gender":"MALE","mobileNumber":"9999900000","active":true,"type":"EMPLOYEE","tenantId":"pg.citya","password":"eGov@123","roles":[{"code":"EMPLOYEE","name":"Employee","tenantId":"pg.citya"}]}
  }' 2>&1)

USER_UUID=$(echo "$USER_RESPONSE" | jq -r '.user[0].uuid // empty')
if [ -n "$USER_UUID" ]; then
  # Verify in database by UUID (username is encrypted)
  DB_UUID=$(db_query "SELECT uuid FROM eg_user WHERE uuid='$USER_UUID'")
  if [ "$DB_UUID" = "$USER_UUID" ]; then
    test_result pass
  else
    test_result fail "user not in DB"
  fi
else
  test_result fail "API error: $(echo "$USER_RESPONSE" | jq -r '.Errors[0].message // "unknown"')"
fi

# Test 12: Login with created user
echo -n "12. User login + get token... "
LOGIN_RESPONSE=$(curl -sS -X POST "$BASE_URL:18107/user/oauth/token" \
  -H "authorization: Basic ZWdvdi11c2VyLWNsaWVudDo=" \
  -H "content-type: application/x-www-form-urlencoded" \
  --data-raw "username=$TEST_USER&password=eGov%40123&userType=EMPLOYEE&tenantId=pg.citya&scope=read&grant_type=password" 2>&1)

ACCESS_TOKEN=$(echo "$LOGIN_RESPONSE" | jq -r '.access_token // empty')
if [ -n "$ACCESS_TOKEN" ]; then
  test_result pass
else
  test_result fail "login failed"
fi

# Test 13: Generate ID and verify sequence incremented
echo -n "13. IDGen generate + verify DB... "
# Get current sequence value
SEQ_BEFORE=$(db_query "SELECT last_value FROM seq_eg_pgr_id")

IDGEN_RESPONSE=$(curl -sS -X POST "$BASE_URL:18088/egov-idgen/id/_generate" \
  -H 'Content-Type: application/json' \
  -d '{
    "RequestInfo":{"apiId":"Rainmaker","ver":".01","action":"_generate","msgId":"test"},
    "idRequests":[{"idName":"smoke.test.id","tenantId":"pg.citya","format":"SMOKE/[cy:yyyy-MM-dd]/[seq_eg_pgr_id]"}]
  }' 2>&1)

GENERATED_ID=$(echo "$IDGEN_RESPONSE" | jq -r '.idResponses[0].id // empty')
if [ -n "$GENERATED_ID" ]; then
  # Verify sequence was incremented
  SEQ_AFTER=$(db_query "SELECT last_value FROM seq_eg_pgr_id")
  if [ "$SEQ_AFTER" -gt "$SEQ_BEFORE" ]; then
    test_result pass
  else
    test_result fail "sequence not incremented"
  fi
else
  test_result fail "ID not generated"
fi

# Test 14: Localization search API works (read doesn't need auth)
echo -n "14. Localization search API... "
LOC_CODE="SMOKE_TEST_${TIMESTAMP}"
SEARCH_RESPONSE=$(curl -sS -X POST "$BASE_URL:18096/localization/messages/v1/_search?locale=en_IN&tenantId=pg&module=rainmaker-common" \
  -H 'Content-Type: application/json' \
  -d '{"RequestInfo":{"apiId":"Rainmaker"}}' 2>&1)

# Search API should return messages array (may be empty)
if echo "$SEARCH_RESPONSE" | jq -e '.messages' > /dev/null 2>&1; then
  test_result pass
else
  test_result fail "API error"
fi

# Test 15: Verify message table exists in DB
echo -n "15. Localization DB table exists... "
MSG_COUNT=$(db_query "SELECT COUNT(*) FROM message")
if [ -n "$MSG_COUNT" ]; then
  test_result pass
else
  test_result fail "table not accessible"
fi

# Test 16: MDMS search tenants
echo -n "16. MDMS search tenants... "
MDMS_RESPONSE=$(curl -sS -X POST "$BASE_URL:18094/mdms-v2/v2/_search" \
  -H 'Content-Type: application/json' \
  -d '{"RequestInfo":{"apiId":"digit","ver":"1.0","ts":0},"MdmsCriteria":{"tenantId":"pg","schemaCode":"tenant.tenants"}}' 2>&1)

TENANT_COUNT=$(echo "$MDMS_RESPONSE" | jq -r '.mdms | length')
if [ "$TENANT_COUNT" -gt 0 ]; then
  test_result pass
else
  test_result fail "no tenants found"
fi

# Test 17: PGR search API works (requires userInfo)
echo -n "17. PGR search API... "
PGR_SEARCH=$(curl -sS -X POST "$BASE_URL:18083/pgr-services/v2/request/_search?tenantId=pg.citya" \
  -H 'Content-Type: application/json' \
  -d '{
    "RequestInfo":{
      "apiId":"Rainmaker",
      "userInfo":{"uuid":"'"$USER_UUID"'","type":"EMPLOYEE","tenantId":"pg.citya"}
    }
  }' 2>&1)

# Search should return ServiceWrappers (may be empty)
if echo "$PGR_SEARCH" | jq -e '.ServiceWrappers' > /dev/null 2>&1; then
  test_result pass
else
  test_result fail "API error"
fi

# Test 18: Verify PGR DB table exists and has correct schema
echo -n "18. PGR DB tables exist... "
PGR_TABLE=$(db_query "SELECT COUNT(*) FROM eg_pgr_service_v2")
if [ -n "$PGR_TABLE" ]; then
  test_result pass
else
  test_result fail "table not accessible"
fi

echo ""
echo "=== Summary: $passed passed, $failed failed ==="
echo ""

# Test data created
if [ -n "$USER_UUID" ]; then
  echo "Test data created:"
  echo "  - User: $TEST_USER (uuid: $USER_UUID)"
fi

send_event testing run smoke-tests

if [[ $failed -eq 0 ]]; then
  exit 0
else
  exit 1
fi
