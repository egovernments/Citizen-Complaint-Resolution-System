
#!/bin/bash

# TL Flow Test Script for tenant: statec
# Run this script to test the complete TL workflow

TENANT_ID="statec"
CITY_TENANT="statec.citya"

echo "=============================================="
echo "TL FLOW TEST SCRIPT"
echo "Tenant: $TENANT_ID"
echo "=============================================="

# Step 1: Check MDMS Data
echo ""
echo "[1/5] Checking MDMS TL TradeType data..."
MDMS_RESULT=$(curl -s -X POST 'http://localhost:8081/egov-mdms-service/v2/_search' \
  -H 'Content-Type: application/json' \
  -d '{
    "RequestInfo": {"apiId": "Rainmaker", "ver": ".01", "msgId": "test"},
    "MdmsCriteria": {"tenantId": "'$TENANT_ID'", "schemaCode": "TradeLicense.TradeType"}
  }')

if echo "$MDMS_RESULT" | grep -q "RETAIL.ELEC.ELST"; then
  echo "   [OK] TradeType data loaded"
else
  echo "   [FAIL] TradeType data NOT found. Load MDMS data first."
  echo "   Response: $MDMS_RESULT"
fi

# Step 2: Check Workflow
echo ""
echo "[2/5] Checking TL Workflow..."
WF_RESULT=$(curl -s -X POST "http://localhost:8082/egov-workflow-v2/egov-wf/businessservice/_search?tenantId=$TENANT_ID&businessServices=NewTL" \
  -H 'Content-Type: application/json' \
  -d '{"RequestInfo": {"apiId": "Rainmaker", "ver": ".01", "msgId": "test"}}')

if echo "$WF_RESULT" | grep -q "NewTL"; then
  echo "   [OK] NewTL workflow exists"
else
  echo "   [FAIL] NewTL workflow NOT found"
  echo "   Response: $WF_RESULT"
fi

# Step 3: Check Employees
echo ""
echo "[3/5] Checking TL Employees..."
EMP_RESULT=$(curl -s -X POST "http://localhost:8084/egov-hrms/employees/_search?tenantId=$CITY_TENANT" \
  -H 'Content-Type: application/json' \
  -d '{"RequestInfo": {"apiId": "Rainmaker", "ver": ".01", "msgId": "test"}}')

if echo "$EMP_RESULT" | grep -q "TL_DOC_VERIFIER"; then
  echo "   [OK] TL Employees found"
else
  echo "   [WARN] TL Employees NOT found - need to create them"
fi

# Step 4: Try login as TL_CEMP
echo ""
echo "[4/5] Testing TL_CEMP Login (9999999405)..."
LOGIN_RESULT=$(curl -s -X POST 'http://localhost:8083/user/oauth/token' \
  -H 'Authorization: Basic ZWdvdi11c2VyLWNsaWVudDo=' \
  -H 'Content-Type: application/x-www-form-urlencoded' \
  -d "grant_type=password&scope=read&username=9999999405&password=eGov@123&tenantId=$CITY_TENANT&userType=EMPLOYEE")

if echo "$LOGIN_RESULT" | grep -q "access_token"; then
  echo "   [OK] Login successful"
  ACCESS_TOKEN=$(echo "$LOGIN_RESULT" | grep -o '"access_token":"[^"]*' | cut -d'"' -f4)
  echo "   Token: ${ACCESS_TOKEN:0:50}..."
else
  echo "   [FAIL] Login failed - employees may not be created"
  echo "   Response: $LOGIN_RESULT"
  echo ""
  echo "   To create employees, run the data handler or manually create:"
  echo "   - TL_DOC_VERIFIER (9999999401)"
  echo "   - TL_APPROVER (9999999403)"
  echo "   - TL_FIELD_INSPECTOR (9999999404)"
  echo "   - TL_CEMP (9999999405)"
fi

echo ""
echo "=============================================="
echo "SUMMARY"
echo "=============================================="
echo "Workflow: NewTL created for $TENANT_ID"
echo ""
echo "To complete setup, ensure:"
echo "1. MDMS data loaded for $TENANT_ID"
echo "2. TL Employees created for $CITY_TENANT"
echo "3. Boundaries configured"
echo ""
echo "Then test TL creation with the payload in docs/TL_TEST_FLOW.md"
echo "=============================================="
