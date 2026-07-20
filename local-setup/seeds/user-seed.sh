#!/bin/bash
# User Seed Script - Creates default admin users via egov-user API
# This ensures passwords are properly encrypted via egov-enc-service.
#
# Creates ADMIN/GRO on every city tenant in SEED_TENANTS so the Postman
# tests can auth at any city tenant (pg.citya, pg.cityb) without
# extra setup. The full-dump.sql only has users on `pg`, but the demo
# tenants pg.citya and pg.cityb are real MDMS tenants — tests expect
# auth to work there too.

set -e

EGOV_USER_HOST="${EGOV_USER_HOST:-http://egov-user:8107}"
MAX_RETRIES=30
RETRY_INTERVAL=5

# Tenants to seed ADMIN/GRO into. Override via env when adding new cities.
# Each tenant gets its own ADMIN + GRO user (city-scoped). INTERNAL_USER is
# state-level (pg only) — HRMS looks it up there.
# `pg.cietee` is the throwaway tenant used by test_crs_loader_e2e.py —
# the test logs in there with ADMIN, then creates + deletes its own
# MDMS data. Cleanup nukes MDMS rows on this tenant but NOT eg_user, so
# ADMIN survives across runs.
# (Name has no digits because egov-user validates tenantId against
# `^[a-zA-Z. ]*$` on create — letters and dots only.)
SEED_TENANTS="${SEED_TENANTS:-pg pg.citya pg.cityb pg.cietee}"

echo "=== DIGIT User Seed ==="
echo "EGOV_USER_HOST: $EGOV_USER_HOST"
echo "SEED_TENANTS:   $SEED_TENANTS"

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

# Function to create user on a specific tenant.
create_user() {
  local USERNAME=$1
  local NAME=$2
  local MOBILE=$3
  local EMAIL=$4
  local TENANT=$5
  local ROLES=$6

  echo "  Creating user: $USERNAME on '$TENANT'"

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
        \"tenantId\": \"$TENANT\",
        \"password\": \"eGov@123\",
        \"roles\": $ROLES
      }
    }")

  if echo "$RESPONSE" | grep -q '"userName"'; then
    echo "    SUCCESS"
  elif echo "$RESPONSE" | grep -q 'DuplicateUserName'; then
    echo "    SKIPPED (already exists)"
  else
    echo "    ERROR — Response: $RESPONSE"
  fi
}

# Roles are tenant-scoped; build the JSON per-tenant.
# ADMIN gets EVERY role the PGR workflow gates on, so a single ADMIN
# user can drive a complaint through every state in the test suite:
#   APPLY                 → CITIZEN, CSR
#   ASSIGN, REJECT        → GRO, PGR_VIEWER
#   REASSIGN, RESOLVE     → PGR_LME, PGR_VIEWER
#   REOPEN                → CFC, CITIZEN, CSR, PGR_VIEWER
#   RATE                  → CFC, CITIZEN
#   RESOLVEBYSUPERVISOR   → SUPERVISOR
#   FORWARD/AUTO          → AUTO_ESCALATE
# Plus the generic ones (SUPERUSER, EMPLOYEE, DGRO) for completeness.
roles_admin() {
  local T=$1
  echo "[
    {\"code\": \"SUPERUSER\",    \"name\": \"Super User\",            \"tenantId\": \"$T\"},
    {\"code\": \"EMPLOYEE\",     \"name\": \"Employee\",              \"tenantId\": \"$T\"},
    {\"code\": \"CITIZEN\",      \"name\": \"Citizen\",               \"tenantId\": \"$T\"},
    {\"code\": \"CSR\",          \"name\": \"Customer Service Rep\",  \"tenantId\": \"$T\"},
    {\"code\": \"GRO\",          \"name\": \"Grievance Routing Officer\", \"tenantId\": \"$T\"},
    {\"code\": \"DGRO\",         \"name\": \"Department GRO\",        \"tenantId\": \"$T\"},
    {\"code\": \"PGR_VIEWER\",   \"name\": \"PGR Viewer\",            \"tenantId\": \"$T\"},
    {\"code\": \"PGR_LME\",      \"name\": \"PGR Last-Mile Employee\", \"tenantId\": \"$T\"},
    {\"code\": \"SUPERVISOR\",   \"name\": \"Supervisor\",            \"tenantId\": \"$T\"},
    {\"code\": \"AUTO_ESCALATE\",\"name\": \"Auto Escalate\",         \"tenantId\": \"$T\"}
  ]"
}

roles_gro() {
  local T=$1
  echo "[
    {\"code\": \"EMPLOYEE\", \"name\": \"Employee\", \"tenantId\": \"$T\"},
    {\"code\": \"GRO\", \"name\": \"Grievance Routing Officer\", \"tenantId\": \"$T\"},
    {\"code\": \"DGRO\", \"name\": \"Department GRO\", \"tenantId\": \"$T\"}
  ]"
}

# Seed ADMIN + GRO on every SEED_TENANT.
for TENANT in $SEED_TENANTS; do
  echo ""
  echo "── Seeding tenant: $TENANT ──"
  create_user "ADMIN" "System Administrator" "9999999999" "admin@digit.org" "$TENANT" "$(roles_admin "$TENANT")"
  create_user "GRO"   "Grievance Officer"    "9888888888" "gro@digit.org"   "$TENANT" "$(roles_gro "$TENANT")"
done

# INTERNAL_USER is a state-level SYSTEM user (only on the root tenant).
# HRMS searches for this user by roleCodes=INTERNAL_MICROSERVICE_ROLE on startup.
echo ""
echo "── Seeding state-level SYSTEM user: INTERNAL_USER (on pg) ──"
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
  echo "  ERROR — Response: $INTERNAL_USER_RESPONSE"
fi

echo ""
echo "=== User seed completed ==="
echo "Default credentials: ADMIN / eGov@123 (and GRO / eGov@123) on every tenant in SEED_TENANTS."
