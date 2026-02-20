#!/bin/bash
# Smoke tests for DIGIT local development environment
# Related: https://github.com/subhashini-egov/digit-2.9lts-core-storm/issues/6
set -e

BASE_URL="${BASE_URL:-http://localhost:18000}"
TENANT="${TENANT:-pg}"
CITY_TENANT="${CITY_TENANT:-pg.citya}"

echo "=== DIGIT Smoke Tests ==="
echo "Base URL: $BASE_URL"
echo ""

# ============ Health Checks ============
echo "--- Health Checks ---"

echo -n "MDMS service... "
curl -sf "$BASE_URL/mdms-v2/health" > /dev/null && echo "OK" || { echo "FAIL"; exit 1; }

echo -n "User service... "
curl -sf "$BASE_URL/user/health" > /dev/null && echo "OK" || { echo "FAIL"; exit 1; }

echo -n "Workflow service... "
curl -sf "$BASE_URL/egov-workflow-v2/health" > /dev/null && echo "OK" || { echo "FAIL"; exit 1; }

echo -n "IDGen service... "
curl -sf "$BASE_URL/egov-idgen/health" > /dev/null && echo "OK" || { echo "FAIL"; exit 1; }

echo -n "Localization service... "
curl -sf "$BASE_URL/localization/actuator/health" > /dev/null && echo "OK" || { echo "FAIL"; exit 1; }

echo -n "Location service... "
curl -sf "$BASE_URL/egov-location/health" > /dev/null && echo "OK" || { echo "FAIL"; exit 1; }

echo -n "Access Control service... "
curl -sf "$BASE_URL/access/health" > /dev/null && echo "OK" || { echo "FAIL"; exit 1; }

echo -n "Encryption service... "
curl -sf "$BASE_URL/egov-enc-service/actuator/health" > /dev/null && echo "OK" || { echo "FAIL"; exit 1; }

echo -n "PGR service... "
curl -sf "$BASE_URL/pgr-services/health" > /dev/null && echo "OK" || { echo "FAIL"; exit 1; }

echo ""

# ============ API Tests ============
echo "--- API Tests ---"

# MDMS - Fetch tenants
echo -n "MDMS v2 tenants... "
MDMS_RESULT=$(curl -s "$BASE_URL/mdms-v2/v2/_search" -X POST -H "Content-Type: application/json" \
  -d '{"RequestInfo":{"apiId":"Rainmaker","ver":".01","action":"_search","msgId":"test"},"MdmsCriteria":{"tenantId":"'$TENANT'","schemaCode":"tenant.tenants"}}')
MDMS_COUNT=$(echo "$MDMS_RESULT" | jq -r '.mdms | length // 0')
if [ "$MDMS_COUNT" -gt 0 ]; then echo "OK ($MDMS_COUNT tenants)"; else echo "FAIL: $MDMS_RESULT"; exit 1; fi

# User - Create test user (ignore if exists)
echo -n "User creation... "
USER_RESULT=$(curl -s "$BASE_URL/user/users/_createnovalidate" -X POST -H "Content-Type: application/json" \
  -d '{
    "RequestInfo":{"apiId":"Rainmaker","ver":".01","action":"_create","msgId":"test"},
    "User":{"userName":"smoketest","name":"Smoke Test","gender":"MALE","mobileNumber":"9999988888","active":true,"type":"EMPLOYEE","tenantId":"'$CITY_TENANT'","password":"eGov@123","roles":[{"code":"EMPLOYEE","name":"Employee","tenantId":"'$CITY_TENANT'"}]}
  }' 2>&1)
if echo "$USER_RESULT" | jq -e '.user[0].uuid' > /dev/null 2>&1; then
  echo "OK (created)"
elif echo "$USER_RESULT" | grep -q "DuplicateUserName"; then
  echo "OK (exists)"
else
  echo "FAIL: $USER_RESULT"; exit 1
fi

# User - Login
echo -n "User login... "
LOGIN_RESULT=$(curl -s "$BASE_URL/user/oauth/token" \
  -H "authorization: Basic ZWdvdi11c2VyLWNsaWVudDo=" \
  -H "content-type: application/x-www-form-urlencoded" \
  --data-raw "username=smoketest&password=eGov%40123&userType=EMPLOYEE&tenantId=$CITY_TENANT&scope=read&grant_type=password")
ACCESS_TOKEN=$(echo "$LOGIN_RESULT" | jq -r '.access_token // empty')
if [ -n "$ACCESS_TOKEN" ]; then
  echo "OK (token: ${ACCESS_TOKEN:0:8}...)"
else
  echo "FAIL: $LOGIN_RESULT"; exit 1
fi

# IDGen - Generate ID (using existing sequence)
echo -n "IDGen generate... "
IDGEN_RESULT=$(curl -s "$BASE_URL/egov-idgen/id/_generate" -X POST -H "Content-Type: application/json" \
  -d '{
    "RequestInfo":{"apiId":"Rainmaker","ver":".01","action":"_generate","msgId":"test"},
    "idRequests":[{"idName":"smoke.test.id","tenantId":"'$CITY_TENANT'","format":"SMOKE/[cy:yyyy-MM-dd]/[seq_eg_pgr_id]"}]
  }')
GENERATED_ID=$(echo "$IDGEN_RESULT" | jq -r '.idResponses[0].id // empty')
if [ -n "$GENERATED_ID" ]; then
  echo "OK ($GENERATED_ID)"
else
  echo "FAIL: $IDGEN_RESULT"; exit 1
fi

# Workflow - Get business services (uses state-level tenant)
echo -n "Workflow business services... "
WF_RESULT=$(curl -s "$BASE_URL/egov-workflow-v2/egov-wf/businessservice/_search?tenantId=$TENANT&businessServices=PGR" \
  -X POST -H "Content-Type: application/json" \
  -d '{"RequestInfo":{"apiId":"Rainmaker","ver":".01","action":"_search","msgId":"test"}}')
WF_COUNT=$(echo "$WF_RESULT" | jq -r '.BusinessServices | length // 0')
echo "OK ($WF_COUNT services)"

# Localization - Search messages
echo -n "Localization messages... "
LOC_RESULT=$(curl -s "$BASE_URL/localization/messages/v1/_search?locale=en_IN&tenantId=$TENANT&module=rainmaker-common" \
  -X POST -H "Content-Type: application/json" \
  -d '{"RequestInfo":{"apiId":"Rainmaker","ver":".01","action":"_search","msgId":"test"}}')
LOC_COUNT=$(echo "$LOC_RESULT" | jq -r '.messages | length // 0')
echo "OK ($LOC_COUNT messages)"

# Access Control - Get actions
echo -n "Access control actions... "
AC_RESULT=$(curl -s "$BASE_URL/access/v1/actions/_search" -X POST -H "Content-Type: application/json" \
  -d '{"RequestInfo":{"apiId":"Rainmaker","ver":".01","action":"_search","msgId":"test"},"roleCode":"EMPLOYEE","tenantId":"'$CITY_TENANT'"}')
AC_COUNT=$(echo "$AC_RESULT" | jq -r '.actions | length // 0')
echo "OK ($AC_COUNT actions)"

echo ""
echo "=== All smoke tests passed ==="
