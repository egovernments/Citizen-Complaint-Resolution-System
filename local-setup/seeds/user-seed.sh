#!/bin/bash
# User Seed Script - Creates default admin users via egov-user API
# This ensures passwords are properly encrypted via egov-enc-service

set -e

EGOV_USER_HOST="${EGOV_USER_HOST:-http://egov-user:8107}"
MAX_RETRIES=30
RETRY_INTERVAL=5

echo "=== DIGIT User Seed ==="
echo "EGOV_USER_HOST: $EGOV_USER_HOST"

# Wait for egov-user to be healthy
echo "Waiting for egov-user service..."
for i in $(seq 1 $MAX_RETRIES); do
  if curl -sf "$EGOV_USER_HOST/user/health" >/dev/null 2>&1; then
    echo "egov-user is healthy!"
    break
  fi
  echo "Attempt $i/$MAX_RETRIES - egov-user not ready, waiting ${RETRY_INTERVAL}s..."
  sleep $RETRY_INTERVAL
done

# Function to create user
create_user() {
  local USERNAME=$1
  local NAME=$2
  local MOBILE=$3
  local EMAIL=$4
  local ROLES=$5

  echo ""
  echo "Creating user: $USERNAME"

  RESPONSE=$(curl -s -X POST "$EGOV_USER_HOST/user/users/_createnovalidate" \
    -H 'Content-Type: application/json' \
    -d "{
      \"RequestInfo\": {\"apiId\": \"digit\", \"ver\": \"1.0\"},
      \"User\": {
        \"userName\": \"$USERNAME\",
        \"name\": \"$NAME\",
        \"mobileNumber\": \"$MOBILE\",
        \"emailId\": \"$EMAIL\",
        \"gender\": \"MALE\",
        \"active\": true,
        \"type\": \"EMPLOYEE\",
        \"tenantId\": \"pg\",
        \"password\": \"eGov@123\",
        \"roles\": $ROLES
      }
    }")

  # Check response
  if echo "$RESPONSE" | grep -q '"userName"'; then
    echo "  SUCCESS: User $USERNAME created"
  elif echo "$RESPONSE" | grep -q 'DuplicateUserName'; then
    echo "  SKIPPED: User $USERNAME already exists"
  else
    echo "  ERROR: Failed to create $USERNAME"
    echo "  Response: $RESPONSE"
  fi
}

# Create ADMIN user with all roles
ADMIN_ROLES='[
  {"code": "SUPERUSER", "name": "Super User", "tenantId": "pg"},
  {"code": "EMPLOYEE", "name": "Employee", "tenantId": "pg"},
  {"code": "GRO", "name": "Grievance Routing Officer", "tenantId": "pg"},
  {"code": "DGRO", "name": "Department GRO", "tenantId": "pg"}
]'
create_user "ADMIN" "System Administrator" "9999999999" "admin@digit.org" "$ADMIN_ROLES"

# Create GRO user
GRO_ROLES='[
  {"code": "EMPLOYEE", "name": "Employee", "tenantId": "pg"},
  {"code": "GRO", "name": "Grievance Routing Officer", "tenantId": "pg"},
  {"code": "DGRO", "name": "Department GRO", "tenantId": "pg"}
]'
create_user "GRO" "Grievance Officer" "9888888888" "gro@digit.org" "$GRO_ROLES"

# Create Internal Microservice user (required by egov-hrms for internal operations)
# HRMS searches for this user by roleCodes=INTERNAL_MICROSERVICE_ROLE on startup
echo ""
echo "Creating SYSTEM user: INTERNAL_USER (for HRMS internal microservice)"
INTERNAL_USER_RESPONSE=$(curl -s -X POST "$EGOV_USER_HOST/user/users/_createnovalidate" \
  -H 'Content-Type: application/json' \
  -d '{
    "RequestInfo": {"apiId": "digit", "ver": "1.0"},
    "User": {
      "userName": "INTERNAL_USER",
      "name": "Internal Microservice User",
      "mobileNumber": "9999999999",
      "gender": "MALE",
      "active": true,
      "type": "SYSTEM",
      "tenantId": "pg",
      "password": "System@123",
      "roles": [{"code": "INTERNAL_MICROSERVICE_ROLE", "name": "Internal Microservice Role", "tenantId": "pg"}]
    }
  }')

if echo "$INTERNAL_USER_RESPONSE" | grep -q '"userName"'; then
  echo "  SUCCESS: Internal Microservice user created"
elif echo "$INTERNAL_USER_RESPONSE" | grep -q 'DuplicateUserName'; then
  echo "  SKIPPED: Internal Microservice user already exists"
else
  echo "  ERROR: Failed to create Internal Microservice user"
  echo "  Response: $INTERNAL_USER_RESPONSE"
fi

echo ""
echo "=== User seed completed ==="
echo "Default credentials: username/password"
echo "  ADMIN / eGov@123"
echo "  GRO / eGov@123"
