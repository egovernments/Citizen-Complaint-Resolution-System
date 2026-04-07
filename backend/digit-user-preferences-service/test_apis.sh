#!/bin/bash

# Colors for output
GREEN='\033[0;32m'
RED='\033[0;31m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

BASE_URL="${BASE_URL:-http://localhost:8080}"
CONTEXT_PATH="/user-preference"

echo -e "${BLUE}========================================${NC}"
echo -e "${BLUE}Testing User Preferences Service${NC}"
echo -e "${BLUE}========================================${NC}"
echo ""

# Test 1: Health Check
echo -e "${BLUE}1. Testing Health Check...${NC}"
HEALTH_RESPONSE=$(curl -s -w "\n%{http_code}" "${BASE_URL}/health")
HTTP_CODE=$(echo "$HEALTH_RESPONSE" | tail -n1)
BODY=$(echo "$HEALTH_RESPONSE" | sed '$d')

if [ "$HTTP_CODE" = "200" ]; then
    echo -e "${GREEN}✓ Health check passed (HTTP $HTTP_CODE)${NC}"
    echo "$BODY" | jq . 2>/dev/null || echo "$BODY"
else
    echo -e "${RED}✗ Health check failed (HTTP $HTTP_CODE)${NC}"
    echo "$BODY"
fi
echo ""

# Test 2: Create/Upsert Preference
echo -e "${BLUE}2. Testing Upsert (Create) Preference...${NC}"
UPSERT_RESPONSE=$(curl -s -w "\n%{http_code}" -X POST "${BASE_URL}${CONTEXT_PATH}/v1/_upsert" \
  -H "Content-Type: application/json" \
  -d '{
    "requestInfo": {
      "apiId": "user-preferences",
      "ver": "1.0",
      "ts": 1707100000000,
      "action": "upsert",
      "msgId": "test-msg-001",
      "userInfo": {
        "uuid": "test-user-123",
        "tenantId": "pb.amritsar"
      }
    },
    "preference": {
      "userId": "test-user-123",
      "tenantId": "pb.amritsar",
      "preferenceCode": "USER_NOTIFICATION_PREFERENCES",
      "payload": {
        "preferredLanguage": "en_IN",
        "consent": {
          "WHATSAPP": {
            "status": "GRANTED",
            "scope": "GLOBAL"
          },
          "SMS": {
            "status": "GRANTED",
            "scope": "TENANT",
            "tenantId": "pb.amritsar"
          },
          "EMAIL": {
            "status": "REVOKED",
            "scope": "GLOBAL"
          }
        }
      }
    }
  }')

HTTP_CODE=$(echo "$UPSERT_RESPONSE" | tail -n1)
BODY=$(echo "$UPSERT_RESPONSE" | sed '$d')

if [ "$HTTP_CODE" = "200" ]; then
    echo -e "${GREEN}✓ Upsert passed (HTTP $HTTP_CODE)${NC}"
    echo "$BODY" | jq . 2>/dev/null || echo "$BODY"
else
    echo -e "${RED}✗ Upsert failed (HTTP $HTTP_CODE)${NC}"
    echo "$BODY" | jq . 2>/dev/null || echo "$BODY"
fi
echo ""

# Test 3: Search Preference
echo -e "${BLUE}3. Testing Search Preference...${NC}"
SEARCH_RESPONSE=$(curl -s -w "\n%{http_code}" -X POST "${BASE_URL}${CONTEXT_PATH}/v1/_search" \
  -H "Content-Type: application/json" \
  -d '{
    "requestInfo": {
      "apiId": "user-preferences",
      "ver": "1.0",
      "msgId": "test-msg-002"
    },
    "criteria": {
      "userId": "test-user-123",
      "tenantId": "pb.amritsar",
      "limit": 10,
      "offset": 0
    }
  }')

HTTP_CODE=$(echo "$SEARCH_RESPONSE" | tail -n1)
BODY=$(echo "$SEARCH_RESPONSE" | sed '$d')

if [ "$HTTP_CODE" = "200" ]; then
    echo -e "${GREEN}✓ Search passed (HTTP $HTTP_CODE)${NC}"
    echo "$BODY" | jq . 2>/dev/null || echo "$BODY"
else
    echo -e "${RED}✗ Search failed (HTTP $HTTP_CODE)${NC}"
    echo "$BODY" | jq . 2>/dev/null || echo "$BODY"
fi
echo ""

# Test 4: Update Preference (Upsert with same key)
echo -e "${BLUE}4. Testing Upsert (Update) Preference...${NC}"
UPDATE_RESPONSE=$(curl -s -w "\n%{http_code}" -X POST "${BASE_URL}${CONTEXT_PATH}/v1/_upsert" \
  -H "Content-Type: application/json" \
  -d '{
    "requestInfo": {
      "apiId": "user-preferences",
      "ver": "1.0",
      "ts": 1707100001000,
      "action": "upsert",
      "msgId": "test-msg-003",
      "userInfo": {
        "uuid": "test-user-123",
        "tenantId": "pb.amritsar"
      }
    },
    "preference": {
      "userId": "test-user-123",
      "tenantId": "pb.amritsar",
      "preferenceCode": "USER_NOTIFICATION_PREFERENCES",
      "payload": {
        "preferredLanguage": "hi_IN",
        "consent": {
          "WHATSAPP": {
            "status": "GRANTED",
            "scope": "GLOBAL"
          },
          "SMS": {
            "status": "REVOKED",
            "scope": "GLOBAL"
          },
          "EMAIL": {
            "status": "GRANTED",
            "scope": "TENANT",
            "tenantId": "pb.amritsar"
          }
        }
      }
    }
  }')

HTTP_CODE=$(echo "$UPDATE_RESPONSE" | tail -n1)
BODY=$(echo "$UPDATE_RESPONSE" | sed '$d')

if [ "$HTTP_CODE" = "200" ]; then
    echo -e "${GREEN}✓ Update passed (HTTP $HTTP_CODE)${NC}"
    echo "$BODY" | jq . 2>/dev/null || echo "$BODY"
else
    echo -e "${RED}✗ Update failed (HTTP $HTTP_CODE)${NC}"
    echo "$BODY" | jq . 2>/dev/null || echo "$BODY"
fi
echo ""

# Test 5: Search after update to verify changes
echo -e "${BLUE}5. Verifying Update (Search again)...${NC}"
VERIFY_RESPONSE=$(curl -s -w "\n%{http_code}" -X POST "${BASE_URL}${CONTEXT_PATH}/v1/_search" \
  -H "Content-Type: application/json" \
  -d '{
    "requestInfo": {
      "apiId": "user-preferences",
      "ver": "1.0",
      "msgId": "test-msg-004"
    },
    "criteria": {
      "userId": "test-user-123",
      "preferenceCode": "USER_NOTIFICATION_PREFERENCES"
    }
  }')

HTTP_CODE=$(echo "$VERIFY_RESPONSE" | tail -n1)
BODY=$(echo "$VERIFY_RESPONSE" | sed '$d')

if [ "$HTTP_CODE" = "200" ]; then
    echo -e "${GREEN}✓ Verify passed (HTTP $HTTP_CODE)${NC}"
    echo "$BODY" | jq . 2>/dev/null || echo "$BODY"
else
    echo -e "${RED}✗ Verify failed (HTTP $HTTP_CODE)${NC}"
    echo "$BODY" | jq . 2>/dev/null || echo "$BODY"
fi
echo ""

# Test 6: Validation Error - Missing userId
echo -e "${BLUE}6. Testing Validation Error (Missing userId)...${NC}"
VALIDATION_RESPONSE=$(curl -s -w "\n%{http_code}" -X POST "${BASE_URL}${CONTEXT_PATH}/v1/_upsert" \
  -H "Content-Type: application/json" \
  -d '{
    "requestInfo": {
      "apiId": "user-preferences",
      "ver": "1.0",
      "msgId": "test-msg-005"
    },
    "preference": {
      "preferenceCode": "USER_NOTIFICATION_PREFERENCES",
      "payload": {"test": "data"}
    }
  }')

HTTP_CODE=$(echo "$VALIDATION_RESPONSE" | tail -n1)
BODY=$(echo "$VALIDATION_RESPONSE" | sed '$d')

if [ "$HTTP_CODE" = "400" ]; then
    echo -e "${GREEN}✓ Validation error correctly returned (HTTP $HTTP_CODE)${NC}"
    echo "$BODY" | jq . 2>/dev/null || echo "$BODY"
else
    echo -e "${RED}✗ Expected 400, got HTTP $HTTP_CODE${NC}"
    echo "$BODY" | jq . 2>/dev/null || echo "$BODY"
fi
echo ""

# Test 7: Create preference for different user
echo -e "${BLUE}7. Testing Create Preference for Different User...${NC}"
DIFF_USER_RESPONSE=$(curl -s -w "\n%{http_code}" -X POST "${BASE_URL}${CONTEXT_PATH}/v1/_upsert" \
  -H "Content-Type: application/json" \
  -d '{
    "requestInfo": {
      "apiId": "user-preferences",
      "ver": "1.0",
      "msgId": "test-msg-006",
      "userInfo": {
        "uuid": "another-user-456"
      }
    },
    "preference": {
      "userId": "another-user-456",
      "preferenceCode": "USER_NOTIFICATION_PREFERENCES",
      "payload": {
        "preferredLanguage": "ta_IN",
        "consent": {
          "WHATSAPP": {
            "status": "REVOKED",
            "scope": "GLOBAL"
          }
        }
      }
    }
  }')

HTTP_CODE=$(echo "$DIFF_USER_RESPONSE" | tail -n1)
BODY=$(echo "$DIFF_USER_RESPONSE" | sed '$d')

if [ "$HTTP_CODE" = "200" ]; then
    echo -e "${GREEN}✓ Create for different user passed (HTTP $HTTP_CODE)${NC}"
    echo "$BODY" | jq . 2>/dev/null || echo "$BODY"
else
    echo -e "${RED}✗ Create for different user failed (HTTP $HTTP_CODE)${NC}"
    echo "$BODY" | jq . 2>/dev/null || echo "$BODY"
fi
echo ""

# Test 8: Search by preferenceCode only
echo -e "${BLUE}8. Testing Search by PreferenceCode...${NC}"
SEARCH_CODE_RESPONSE=$(curl -s -w "\n%{http_code}" -X POST "${BASE_URL}${CONTEXT_PATH}/v1/_search" \
  -H "Content-Type: application/json" \
  -d '{
    "requestInfo": {
      "apiId": "user-preferences",
      "ver": "1.0",
      "msgId": "test-msg-007"
    },
    "criteria": {
      "preferenceCode": "USER_NOTIFICATION_PREFERENCES",
      "limit": 10
    }
  }')

HTTP_CODE=$(echo "$SEARCH_CODE_RESPONSE" | tail -n1)
BODY=$(echo "$SEARCH_CODE_RESPONSE" | sed '$d')

if [ "$HTTP_CODE" = "200" ]; then
    echo -e "${GREEN}✓ Search by code passed (HTTP $HTTP_CODE)${NC}"
    echo "$BODY" | jq . 2>/dev/null || echo "$BODY"
else
    echo -e "${RED}✗ Search by code failed (HTTP $HTTP_CODE)${NC}"
    echo "$BODY" | jq . 2>/dev/null || echo "$BODY"
fi
echo ""

echo -e "${BLUE}========================================${NC}"
echo -e "${BLUE}All tests completed!${NC}"
echo -e "${BLUE}========================================${NC}"
