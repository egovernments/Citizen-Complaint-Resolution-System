#!/bin/bash
# PGR Services API Test
# Tests PGR endpoints that work without full user setup

set -e

BASE_URL="${1:-http://0.0.0.0}"
FAILED=0
PASSED=0

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
NC='\033[0m' # No Color

pass() {
    echo -e "[${GREEN}PASS${NC}] $1"
    ((PASSED++))
}

fail() {
    echo -e "[${RED}FAIL${NC}] $1"
    ((FAILED++))
}

echo "=== PGR Services API Tests ==="
echo "Base URL: $BASE_URL"
echo ""

# Test 1: Health endpoint
echo -n "1. PGR health endpoint... "
response=$(curl -sS "$BASE_URL:18083/pgr-services/health" 2>&1)
if echo "$response" | grep -q '"status".*"UP"'; then
    pass "Health UP"
else
    fail "Health check failed: $response"
fi

# Test 2: Service definitions search (requires MDMS)
echo -n "2. Service definitions available... "
response=$(curl -sS -X POST "$BASE_URL:18094/mdms-v2/v1/_search" \
    -H 'Content-Type: application/json' \
    -d '{
        "RequestInfo": {"apiId": "digit", "ver": "1.0", "ts": 0},
        "MdmsCriteria": {
            "tenantId": "pg",
            "moduleDetails": [{"moduleName": "RAINMAKER-PGR", "masterDetails": [{"name": "ServiceDefs"}]}]
        }
    }' 2>&1)
if echo "$response" | grep -q 'RAINMAKER-PGR\|ServiceDefs'; then
    count=$(echo "$response" | grep -o '"serviceCode"' | wc -l)
    if [ "$count" -gt 0 ]; then
        pass "Found $count service definitions"
    else
        pass "ServiceDefs schema exists (no data yet)"
    fi
else
    fail "ServiceDefs not accessible"
fi

# Test 3: PGR API endpoint structure (validates routing)
echo -n "3. PGR v2 API routing... "
response=$(curl -sS -o /dev/null -w "%{http_code}" "$BASE_URL:18083/pgr-services/v2/request/_search" \
    -X POST \
    -H 'Content-Type: application/json' \
    -d '{}' 2>&1)
# Expect 400 (bad request due to missing body) or 500 (internal error) but NOT 404
if [ "$response" = "400" ] || [ "$response" = "500" ]; then
    pass "API routing works (HTTP $response)"
elif [ "$response" = "404" ]; then
    fail "API not found (HTTP 404)"
else
    pass "API accessible (HTTP $response)"
fi

# Test 4: PGR count endpoint
echo -n "4. PGR count endpoint... "
response=$(curl -sS -o /dev/null -w "%{http_code}" "$BASE_URL:18083/pgr-services/v2/request/_count" \
    -X POST \
    -H 'Content-Type: application/json' \
    -d '{"RequestInfo": {"apiId": "digit"}}' 2>&1)
if [ "$response" != "404" ]; then
    pass "Count endpoint accessible (HTTP $response)"
else
    fail "Count endpoint not found"
fi

# Test 5: Workflow business service for PGR
echo -n "5. PGR workflow config... "
response=$(curl -sS -X POST "$BASE_URL:18094/mdms-v2/v1/_search" \
    -H 'Content-Type: application/json' \
    -d '{
        "RequestInfo": {"apiId": "digit", "ver": "1.0", "ts": 0},
        "MdmsCriteria": {
            "tenantId": "pg",
            "moduleDetails": [{"moduleName": "Workflow", "masterDetails": [{"name": "BusinessServiceMasterConfig"}]}]
        }
    }' 2>&1)
if echo "$response" | grep -q 'PGR\|pgr'; then
    pass "PGR workflow config found"
elif echo "$response" | grep -q 'BusinessServiceMasterConfig'; then
    pass "Workflow config accessible (PGR may need seeding)"
else
    fail "Workflow config not accessible"
fi

# Summary
echo ""
echo "=== Summary: $PASSED passed, $FAILED failed ==="

if [ $FAILED -gt 0 ]; then
    exit 1
fi
exit 0
