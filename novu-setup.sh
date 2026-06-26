#!/bin/bash

# ============================================
# COMPLETE NOVU NOTIFICATION SETUP SCRIPT
# ============================================
# This script sets up Novu notifications end-to-end
# including creating schemas and loading all config data

set -e  # Exit on error

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Configuration
CONFIG_SERVICE_URL="${CONFIG_SERVICE_URL:-http://localhost:18000}"
NOVU_API_URL="${NOVU_API_URL:-http://localhost:14002}"
TENANT_ID="${TENANT_ID:-be.bomet}"

# API Keys and Credentials (update these with your actual values)
NOVU_API_KEY="${NOVU_API_KEY:-your-novu-api-key-here}"
TWILIO_ACCOUNT_SID="${TWILIO_ACCOUNT_SID:-your-twilio-account-sid-here}"
TWILIO_AUTH_TOKEN="${TWILIO_AUTH_TOKEN:-your-twilio-auth-token-here}"
TWILIO_WHATSAPP_FROM="${TWILIO_WHATSAPP_FROM:-whatsapp:+91XXXXXXXXXX}"

echo -e "${BLUE}================================================${NC}"
echo -e "${BLUE}    NOVU NOTIFICATION SETUP FOR DIGIT${NC}"
echo -e "${BLUE}================================================${NC}"
echo ""

# ============================================
# STEP 1: Verify Novu API Key
# ============================================
echo -e "${YELLOW}Step 1: Verifying Novu API Key...${NC}"
NOVU_CHECK=$(curl -s "$NOVU_API_URL/v1/environments/api-keys" \
  -H "Authorization: ApiKey $NOVU_API_KEY" | grep -c "$NOVU_API_KEY" || true)

if [ "$NOVU_CHECK" -eq 0 ]; then
  echo -e "${RED}✗ Invalid Novu API Key! Please update NOVU_API_KEY in this script${NC}"
  echo -e "${YELLOW}  Get your API key from Novu Dashboard: $NOVU_API_URL${NC}"
  exit 1
fi
echo -e "${GREEN}✓ Novu API Key is valid${NC}"

# ============================================
# STEP 2: Create Config Schemas
# ============================================
echo ""
echo -e "${YELLOW}Step 2: Creating Config Schemas...${NC}"

# Create TemplateBinding Schema
create_schema() {
  local schema_code=$1
  local schema_desc=$2
  
  echo -e "  Creating schema: ${BLUE}$schema_code${NC}"
  
  RESPONSE=$(curl -s -X POST "$CONFIG_SERVICE_URL/config-service/schema/v1/_create" \
    -H "Content-Type: application/json" \
    -d "{
      \"RequestInfo\": {
        \"apiId\": \"setup-script\",
        \"ver\": \"1.0\",
        \"ts\": $(date +%s)000,
        \"msgId\": \"setup-$(date +%s)\"
      },
      \"schema\": {
        \"code\": \"$schema_code\",
        \"description\": \"$schema_desc\",
        \"definition\": {
          \"type\": \"object\",
          \"title\": \"$schema_code\"
        },
        \"isActive\": true
      }
    }" 2>/dev/null || echo "{}")
    
  if echo "$RESPONSE" | grep -q "\"status\":\"successful\""; then
    echo -e "  ${GREEN}✓ Schema $schema_code created${NC}"
  else
    echo -e "  ${YELLOW}! Schema $schema_code might already exist${NC}"
  fi
}

create_schema "TemplateBinding" "Event to notification template mapping"
create_schema "ProviderDetail" "Notification provider configuration"
create_schema "NotificationChannel" "Notification channel configuration"

# ============================================
# STEP 3: Load ProviderDetail Configuration
# ============================================
echo ""
echo -e "${YELLOW}Step 3: Loading ProviderDetail Configuration...${NC}"

create_or_update_config() {
  local schema_code=$1
  local unique_id=$2
  local data=$3
  
  # First try to create
  RESPONSE=$(curl -s -X POST "$CONFIG_SERVICE_URL/config-service/config/v1/_create/$schema_code" \
    -H "Content-Type: application/json" \
    -d "{
      \"RequestInfo\": {
        \"apiId\": \"config-service\",
        \"ver\": \"1.0\",
        \"ts\": $(date +%s)000,
        \"msgId\": \"test\",
        \"userInfo\": {
          \"uuid\": \"setup-script\",
          \"userName\": \"admin\"
        }
      },
      \"configData\": {
        \"tenantId\": \"$TENANT_ID\",
        \"schemaCode\": \"$schema_code\",
        \"uniqueIdentifier\": \"$unique_id\",
        \"data\": $data,
        \"isActive\": true
      }
    }" 2>/dev/null)
  
  if echo "$RESPONSE" | grep -q "successful"; then
    echo -e "  ${GREEN}✓ Created $schema_code: $unique_id${NC}"
  else
    # If create fails, try update
    RESPONSE=$(curl -s -X POST "$CONFIG_SERVICE_URL/config-service/config/v1/_update/$schema_code" \
      -H "Content-Type: application/json" \
      -d "{
        \"RequestInfo\": {
          \"apiId\": \"config-service\",
          \"ver\": \"1.0\",
          \"ts\": $(date +%s)000,
          \"msgId\": \"test\",
          \"userInfo\": {
            \"uuid\": \"setup-script\",
            \"userName\": \"admin\"
          }
        },
        \"configData\": {
          \"tenantId\": \"$TENANT_ID\",
          \"schemaCode\": \"$schema_code\",
          \"uniqueIdentifier\": \"$unique_id\",
          \"data\": $data,
          \"isActive\": true
        }
      }" 2>/dev/null)
    
    if echo "$RESPONSE" | grep -q "successful"; then
      echo -e "  ${GREEN}✓ Updated $schema_code: $unique_id${NC}"
    else
      echo -e "  ${RED}✗ Failed to create/update $schema_code: $unique_id${NC}"
    fi
  fi
}

# Load ProviderDetail for WhatsApp
PROVIDER_DATA=$(cat <<EOF
{
  "apiUrl": "https://api.twilio.com/2010-04-01",
  "channel": "WHATSAPP",
  "priority": 1,
  "tenantId": "$TENANT_ID",
  "novuApiKey": "$NOVU_API_KEY",
  "credentials": {
    "from": "$TWILIO_WHATSAPP_FROM",
    "authToken": "$TWILIO_AUTH_TOKEN",
    "accountSid": "$TWILIO_ACCOUNT_SID"
  },
  "providerName": "Twilio",
  "senderNumber": "$TWILIO_WHATSAPP_FROM"
}
EOF
)

create_or_update_config "ProviderDetail" "Twilio.whatsapp.1" "$PROVIDER_DATA"

# ============================================
# STEP 4: Load NotificationChannel Configuration
# ============================================
echo ""
echo -e "${YELLOW}Step 4: Loading NotificationChannel Configuration...${NC}"

CHANNEL_DATA=$(cat <<EOF
{
  "code": "WHATSAPP",
  "name": "WhatsApp",
  "enabled": true,
  "providerName": "Twilio",
  "priority": 1
}
EOF
)

create_or_update_config "NotificationChannel" "NotificationChannel.WHATSAPP.$TENANT_ID" "$CHANNEL_DATA"

# ============================================
# STEP 5: Load TemplateBinding Configurations
# ============================================
echo ""
echo -e "${YELLOW}Step 5: Loading TemplateBinding Configurations...${NC}"

# Template for COMPLAINTS.WORKFLOW.APPLY
TEMPLATE_APPLY=$(cat <<EOF
{
  "locale": "en_IN",
  "channel": "WHATSAPP",
  "tenantId": "$TENANT_ID",
  "eventName": "COMPLAINTS.WORKFLOW.APPLY",
  "contentSid": "HX350aa0b139780ea87f554276b1f68d6c",
  "novuApiKey": "$NOVU_API_KEY",
  "paramOrder": ["serviceName", "complaintNo", "submittedDate"],
  "templateId": "complaints-workflow-apply",
  "requiredVars": ["complaintNo", "serviceName", "submittedDate"]
}
EOF
)

create_or_update_config "TemplateBinding" "COMPLAINTS.WORKFLOW.APPLY.WHATSAPP.en_IN" "$TEMPLATE_APPLY"

# Template for COMPLAINTS.WORKFLOW.ASSIGN
TEMPLATE_ASSIGN=$(cat <<EOF
{
  "locale": "en_IN",
  "channel": "WHATSAPP",
  "tenantId": "$TENANT_ID",
  "eventName": "COMPLAINTS.WORKFLOW.ASSIGN",
  "contentSid": "HX158f8edc7079e2c2b76d9c8f68e87791",
  "novuApiKey": "$NOVU_API_KEY",
  "paramOrder": ["serviceName", "complaintNo", "submittedDate", "assigneeName", "assigneeDesignation", "departmentName"],
  "templateId": "complaints-workflow-assign",
  "requiredVars": ["complaintNo", "status", "serviceName", "departmentName", "submittedDate"]
}
EOF
)

create_or_update_config "TemplateBinding" "COMPLAINTS.WORKFLOW.ASSIGN.WHATSAPP.en_IN" "$TEMPLATE_ASSIGN"

# Template for COMPLAINTS.WORKFLOW.RESOLVE
TEMPLATE_RESOLVE=$(cat <<EOF
{
  "locale": "en_IN",
  "channel": "WHATSAPP",
  "tenantId": "$TENANT_ID",
  "eventName": "COMPLAINTS.WORKFLOW.RESOLVE",
  "contentSid": "HX065a203bccd1c6485050624fafcb6890",
  "novuApiKey": "$NOVU_API_KEY",
  "paramOrder": ["serviceName", "complaintNo", "submittedDate", "assigneeName"],
  "templateId": "complaints-workflow-resolve",
  "requiredVars": ["serviceName", "complaintNo", "submittedDate", "assigneeName"]
}
EOF
)

create_or_update_config "TemplateBinding" "COMPLAINTS.WORKFLOW.RESOLVE.WHATSAPP.en_IN" "$TEMPLATE_RESOLVE"

# Template for COMPLAINTS.WORKFLOW.REJECT
TEMPLATE_REJECT=$(cat <<EOF
{
  "locale": "en_IN",
  "channel": "WHATSAPP",
  "tenantId": "$TENANT_ID",
  "eventName": "COMPLAINTS.WORKFLOW.REJECT",
  "contentSid": "HX5cf9ba4ee941ea005268bef804094dff",
  "novuApiKey": "$NOVU_API_KEY",
  "paramOrder": ["serviceName", "complaintNo", "submittedDate", "comment"],
  "templateId": "complaints-workflow-reject",
  "requiredVars": ["complaintNo", "serviceName", "submittedDate", "comment"]
}
EOF
)

create_or_update_config "TemplateBinding" "COMPLAINTS.WORKFLOW.REJECT.WHATSAPP.en_IN" "$TEMPLATE_REJECT"

# ============================================
# STEP 6: Restart Services
# ============================================
echo ""
echo -e "${YELLOW}Step 6: Restarting Services...${NC}"

echo -e "  Restarting config-service to clear cache..."
docker restart digit-config-service >/dev/null 2>&1 && echo -e "  ${GREEN}✓ config-service restarted${NC}" || echo -e "  ${YELLOW}! Could not restart config-service${NC}"

echo -e "  Restarting novu-bridge..."
docker restart novu-bridge >/dev/null 2>&1 && echo -e "  ${GREEN}✓ novu-bridge restarted${NC}" || echo -e "  ${YELLOW}! Could not restart novu-bridge${NC}"

# ============================================
# STEP 7: Check Novu Workflows
# ============================================
echo ""
echo -e "${YELLOW}Step 7: Checking Novu Workflows...${NC}"

echo -e "  Checking if workflows exist in Novu..."
WORKFLOW_CHECK=$(curl -s "$NOVU_API_URL/v1/workflows" \
  -H "Authorization: ApiKey $NOVU_API_KEY" \
  -H "Content-Type: application/json")

echo "$WORKFLOW_CHECK" | grep -q "complaints-workflow-apply" && echo -e "  ${GREEN}✓ complaints-workflow-apply found${NC}" || echo -e "  ${RED}✗ complaints-workflow-apply NOT FOUND - Create in Novu Dashboard${NC}"
echo "$WORKFLOW_CHECK" | grep -q "complaints-workflow-assign" && echo -e "  ${GREEN}✓ complaints-workflow-assign found${NC}" || echo -e "  ${RED}✗ complaints-workflow-assign NOT FOUND - Create in Novu Dashboard${NC}"
echo "$WORKFLOW_CHECK" | grep -q "complaints-workflow-resolve" && echo -e "  ${GREEN}✓ complaints-workflow-resolve found${NC}" || echo -e "  ${RED}✗ complaints-workflow-resolve NOT FOUND - Create in Novu Dashboard${NC}"
echo "$WORKFLOW_CHECK" | grep -q "complaints-workflow-reject" && echo -e "  ${GREEN}✓ complaints-workflow-reject found${NC}" || echo -e "  ${RED}✗ complaints-workflow-reject NOT FOUND - Create in Novu Dashboard${NC}"

# ============================================
# STEP 8: Verify Setup
# ============================================
echo ""
echo -e "${YELLOW}Step 8: Verifying Config Service Setup...${NC}"

# Check if configs are loaded
echo -e "  Checking TemplateBinding..."
TEMPLATE_CHECK=$(curl -s "$CONFIG_SERVICE_URL/config-service/config/v1/_search" \
  -H "Content-Type: application/json" \
  -d "{
    \"RequestInfo\": {\"apiId\": \"test\"},
    \"criteria\": {
      \"tenantId\": \"$TENANT_ID\",
      \"schemaCode\": \"TemplateBinding\"
    }
  }" | grep -c "COMPLAINTS.WORKFLOW" || true)

if [ "$TEMPLATE_CHECK" -gt 0 ]; then
  echo -e "  ${GREEN}✓ TemplateBinding configurations loaded${NC}"
else
  echo -e "  ${RED}✗ TemplateBinding configurations not found${NC}"
fi

echo -e "  Checking ProviderDetail..."
PROVIDER_CHECK=$(curl -s "$CONFIG_SERVICE_URL/config-service/config/v1/_search" \
  -H "Content-Type: application/json" \
  -d "{
    \"RequestInfo\": {\"apiId\": \"test\"},
    \"criteria\": {
      \"tenantId\": \"$TENANT_ID\",
      \"schemaCode\": \"ProviderDetail\"
    }
  }" | grep -c "Twilio" || true)

if [ "$PROVIDER_CHECK" -gt 0 ]; then
  echo -e "  ${GREEN}✓ ProviderDetail configuration loaded${NC}"
else
  echo -e "  ${RED}✗ ProviderDetail configuration not found${NC}"
fi

# ============================================
# SUMMARY
# ============================================
echo ""
echo -e "${BLUE}================================================${NC}"
echo -e "${GREEN}✓ NOVU NOTIFICATION SETUP COMPLETE!${NC}"
echo -e "${BLUE}================================================${NC}"
echo ""
echo -e "${YELLOW}Next Steps:${NC}"
echo "1. Create a test complaint to verify notifications"
echo "2. Check novu-bridge logs: docker logs -f novu-bridge"
echo "3. Monitor Novu dashboard: $NOVU_API_URL"
echo ""
echo -e "${YELLOW}Configuration Summary:${NC}"
echo "  Tenant: $TENANT_ID"
echo "  Novu API: $NOVU_API_URL"
echo "  Config Service: $CONFIG_SERVICE_URL"
echo "  WhatsApp From: $TWILIO_WHATSAPP_FROM"
echo ""
echo -e "${GREEN}All configurations have been loaded successfully!${NC}"